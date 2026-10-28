import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { StoreContext } from "../store-context.js";
import type { RelationService } from "./relations.js";
import type { Actor } from "../types.js";
import { issueSchema, versionSchema } from "../response-schemas.js";
import { DomainError } from "../domain-error.js";
import {
  issueQuerySchema,
  matchesIssue,
  sortIssues,
  type IssueQuery,
} from "../contracts/issue-query.js";
import {
  savedViewSchema,
  viewCreateSchema,
  viewUpdateSchema,
  viewDeleteSchema,
  viewPreferenceInputSchema,
  type SavedView,
  type ViewPreferences,
  type QueryWarning,
} from "../contracts/views.js";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(400, "INVALID_INPUT", "뷰 조건을 확인하세요.");
  return result.data;
}
export class ViewService {
  constructor(
    private readonly ctx: StoreContext,
    private readonly relations: RelationService,
  ) {}
  private decode(row: Record<string, unknown>): SavedView {
    if (typeof row.query !== "string") throw new Error("Invalid saved query");
    const query: unknown = JSON.parse(row.query);
    return savedViewSchema.parse({ ...row, query });
  }
  private revision(actual: number, expected: number) {
    if (actual !== expected)
      throw new DomainError(
        409,
        "REVISION_CONFLICT",
        "뷰가 변경되었습니다. 최신 상태를 확인하세요.",
      );
  }
  private warnings(actor: Actor, query: IssueQuery): QueryWarning[] {
    const warnings: QueryWarning[] = [];
    if (query.projectId) {
      this.ctx.scope(actor, query.projectId);
      if (
        !this.ctx.db
          .prepare("SELECT id FROM projects WHERE id=?")
          .get(query.projectId)
      )
        return [
          {
            code: "PROJECT_MISSING",
            field: "projectId",
            message: "프로젝트를 찾을 수 없습니다.",
          },
        ];
    }
    for (const field of [
      "targetVersionId",
      "foundVersionId",
      "fixedVersionId",
    ] as const) {
      const id = query[field];
      if (!id) continue;
      const row = this.ctx.db
        .prepare("SELECT * FROM versions WHERE id=?")
        .get(id);
      if (!row) {
        warnings.push({
          code: "VERSION_MISSING",
          field,
          message: "저장된 버전을 찾을 수 없습니다.",
        });
        continue;
      }
      const version = versionSchema.parse(row);
      this.ctx.scope(actor, version.projectId);
      if (query.projectId && version.projectId !== query.projectId)
        warnings.push({
          code: "VERSION_PROJECT_MISMATCH",
          field,
          message: "프로젝트와 버전이 일치하지 않습니다.",
        });
    }
    return warnings;
  }
  query(actor: Actor, input: unknown) {
    const query = parse(issueQuerySchema, input),
      warnings = this.warnings(actor, query);
    if (warnings.length) return { issues: [], warnings };
    const rows = this.ctx.db.prepare("SELECT * FROM issues").all();
    const issues = rows
      .filter(
        (row) =>
          (!query.projectId || row.projectId === query.projectId) &&
          (actor.role === "owner" ||
            actor.projectIds === null ||
            (typeof row.projectId === "string" &&
              actor.projectIds.includes(row.projectId))),
      )
      .map((row) => {
        if (typeof row.labels !== "string") throw new Error("Invalid labels");
        const labels: unknown = JSON.parse(row.labels);
        return issueSchema.parse({ ...row, labels });
      });
    const blocked = new Set(
      Object.entries(this.relations.summaries(actor, query.projectId))
        .filter(([, s]) => s.blocked)
        .map(([id]) => id),
    );
    const requests = this.ctx.db
      .prepare(
        "SELECT s.issueId,s.projectId,s.agentId FROM session_requests r JOIN agent_sessions s ON r.sessionId=s.id WHERE r.kind='input' AND r.status='pending' AND s.issueId IS NOT NULL",
      )
      .all();
    const inputRequested = new Set(
      requests
        .filter((r) => actor.role === "owner" || r.agentId === actor.id)
        .flatMap((r) => (typeof r.issueId === "string" ? [r.issueId] : [])),
    );
    return {
      issues: sortIssues(
        issues.filter((issue) =>
          matchesIssue(issue, query, { blocked, inputRequested }),
        ),
        query.sort,
      ),
      warnings,
    };
  }
  list(actor: Actor, projectId?: string): SavedView[] {
    if (projectId) this.ctx.project(actor, projectId);
    return this.ctx.db
      .prepare("SELECT * FROM saved_views WHERE actorId=? ORDER BY name,id")
      .all(actor.id)
      .map((row) => this.decode(row))
      .filter(
        (view) =>
          (!projectId || view.projectId === projectId) &&
          (actor.role === "owner" ||
            actor.projectIds === null ||
            actor.projectIds.includes(view.projectId)),
      );
  }
  get(actor: Actor, id: string): SavedView {
    const row = this.ctx.db
      .prepare("SELECT * FROM saved_views WHERE id=? AND actorId=?")
      .get(id, actor.id);
    if (!row) throw new DomainError(404, "NOT_FOUND", "뷰를 찾을 수 없습니다.");
    const view = this.decode(row);
    this.ctx.scope(actor, view.projectId);
    return view;
  }
  private valid(actor: Actor, query: IssueQuery) {
    const warnings = this.warnings(actor, query);
    if (warnings.length)
      throw new DomainError(400, "INVALID_REFERENCE", warnings[0].message);
  }
  private unique(actor: Actor, projectId: string, name: string, except = "") {
    if (
      this.ctx.db
        .prepare(
          "SELECT id FROM saved_views WHERE actorId=? AND projectId=? AND name=? COLLATE NOCASE AND id!=?",
        )
        .get(actor.id, projectId, name, except)
    )
      throw new DomainError(
        409,
        "VIEW_NAME_EXISTS",
        "같은 이름의 뷰가 있습니다.",
      );
  }
  create(actor: Actor, input: unknown): SavedView {
    this.ctx.write(actor);
    const data = parse(viewCreateSchema, input);
    return this.ctx.tx(() => {
      this.valid(actor, data.query);
      this.unique(actor, data.query.projectId, data.name);
      const id = randomUUID(),
        stamp = this.ctx.now();
      this.ctx.db
        .prepare("INSERT INTO saved_views VALUES (?,?,?,?,?,?,?,?)")
        .run(
          id,
          actor.id,
          data.query.projectId,
          data.name,
          JSON.stringify(data.query),
          1,
          stamp,
          stamp,
        );
      return this.get(actor, id);
    });
  }
  update(actor: Actor, id: string, input: unknown): SavedView {
    this.ctx.write(actor);
    const data = parse(viewUpdateSchema, input);
    return this.ctx.tx(() => {
      const view = this.get(actor, id);
      this.revision(view.revision, data.revision);
      if (data.query.projectId !== view.projectId)
        throw new DomainError(
          400,
          "PROJECT_MISMATCH",
          "뷰의 프로젝트는 변경할 수 없습니다.",
        );
      this.valid(actor, data.query);
      this.unique(actor, view.projectId, data.name, id);
      this.ctx.db
        .prepare(
          "UPDATE saved_views SET name=?,query=?,revision=revision+1,updatedAt=? WHERE id=?",
        )
        .run(data.name, JSON.stringify(data.query), this.ctx.now(), id);
      return this.get(actor, id);
    });
  }
  preferences(actor: Actor, projectId: string): ViewPreferences {
    this.ctx.project(actor, projectId);
    const row = this.ctx.db
      .prepare("SELECT * FROM view_preferences WHERE actorId=? AND projectId=?")
      .get(actor.id, projectId);
    if (!row)
      return { projectId, revision: 0, defaultViewId: null, favoriteIds: [] };
    if (typeof row.favoriteIds !== "string")
      throw new Error("Invalid favorites");
    const ids: unknown = JSON.parse(row.favoriteIds);
    return {
      projectId,
      revision: z.number().parse(row.revision),
      defaultViewId: z.string().nullable().parse(row.defaultViewId),
      favoriteIds: z.string().array().parse(ids),
    };
  }
  setPreferences(
    actor: Actor,
    projectId: string,
    input: unknown,
  ): ViewPreferences {
    this.ctx.write(actor);
    const data = parse(viewPreferenceInputSchema, input);
    return this.ctx.tx(() => {
      const current = this.preferences(actor, projectId);
      this.revision(current.revision, data.revision);
      for (const id of [
        ...data.favoriteIds,
        ...(data.defaultViewId ? [data.defaultViewId] : []),
      ])
        if (this.get(actor, id).projectId !== projectId)
          throw new DomainError(
            400,
            "PROJECT_MISMATCH",
            "같은 프로젝트의 뷰를 선택하세요.",
          );
      this.ctx.db
        .prepare(
          "INSERT INTO view_preferences VALUES (?,?,?,?,?) ON CONFLICT(actorId,projectId) DO UPDATE SET revision=excluded.revision,defaultViewId=excluded.defaultViewId,favoriteIds=excluded.favoriteIds",
        )
        .run(
          actor.id,
          projectId,
          current.revision + 1,
          data.defaultViewId,
          JSON.stringify(data.favoriteIds),
        );
      return this.preferences(actor, projectId);
    });
  }
  remove(actor: Actor, id: string, input: unknown) {
    this.ctx.write(actor);
    const data = parse(viewDeleteSchema, input);
    this.ctx.tx(() => {
      const view = this.get(actor, id);
      this.revision(view.revision, data.revision);
      const pref = this.preferences(actor, view.projectId);
      if (pref.revision)
        this.ctx.db
          .prepare(
            "UPDATE view_preferences SET revision=revision+1,defaultViewId=?,favoriteIds=? WHERE actorId=? AND projectId=?",
          )
          .run(
            pref.defaultViewId === id ? null : pref.defaultViewId,
            JSON.stringify(pref.favoriteIds.filter((v) => v !== id)),
            actor.id,
            view.projectId,
          );
      this.ctx.db.prepare("DELETE FROM saved_views WHERE id=?").run(id);
    });
  }
}
