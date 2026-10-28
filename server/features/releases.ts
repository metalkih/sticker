import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../domain-error.js";
import { versionSchema } from "../response-schemas.js";
import type { StoreContext } from "../store-context.js";
import type { Actor, Issue } from "../types.js";
import type { RelationService } from "./relations.js";
import {
  carryoverInputSchema,
  carryoverResultSchema,
  changelogInputSchema,
  changelogSchema,
  generateChangelogInputSchema,
  releaseInputSchema,
  releaseAuditSchema,
  releaseResultSchema,
  type VersionReadiness,
  type Changelog,
  type CarryoverInput,
  type CarryoverPreview,
  type CarryoverResult,
  type ReleaseResult,
} from "../contracts/releases.js";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const out = schema.safeParse(input);
  if (!out.success)
    throw new DomainError(400, "VALIDATION", "출시 입력을 확인하세요.");
  return out.data;
}
function checkRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new DomainError(
      409,
      "REVISION_CONFLICT",
      "다른 변경이 있습니다. 최신 내용을 확인하세요.",
    );
}
function markdownText(value: string) {
  return value
    .replace(/[\r\n\t]/g, " ")
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "\\$&");
}
export class ReleaseService {
  constructor(
    private readonly ctx: StoreContext,
    private readonly relations: RelationService,
    private readonly patchIssue: (
      actor: Actor,
      id: string,
      input: unknown,
    ) => Issue,
    private readonly origin: string,
  ) {}
  private version(actor: Actor, id: string) {
    const version = versionSchema.parse(this.ctx.get("versions", id));
    this.ctx.scope(actor, version.projectId);
    return version;
  }
  readiness(actor: Actor, id: string): VersionReadiness {
    const version = this.version(actor, id),
      rows = this.ctx.db
        .prepare("SELECT id FROM issues WHERE projectId=? ORDER BY key,id")
        .all(version.projectId);
    const issues = rows.map((row) =>
        this.ctx.issue(actor, z.string().parse(row.id)),
      ),
      summaries = this.relations.summaries(actor, version.projectId),
      targetIssues = issues.filter((i) => i.targetVersionId === id);
    const blockedIssueIds = targetIssues
      .filter((i) => summaries[i.id].blocked)
      .map((i) => i.id);
    return {
      version,
      targetIssues,
      foundIssues: issues.filter((i) => i.foundVersionId === id),
      fixedIssues: issues.filter((i) => i.fixedVersionId === id),
      counts: {
        unfinished: targetIssues.filter(
          (i) => i.status !== "done" && i.status !== "closed",
        ).length,
        done: targetIssues.filter((i) => i.status === "done").length,
        closed: targetIssues.filter((i) => i.status === "closed").length,
        blocked: blockedIssueIds.length,
        total: targetIssues.length,
      },
      blockedIssueIds,
      releaseHistory: releaseAuditSchema
        .array()
        .parse(
          this.ctx.db
            .prepare(
              "SELECT * FROM version_release_audit WHERE versionId=? ORDER BY createdAt,id",
            )
            .all(id),
        ),
    };
  }
  private carryoverScope(actor: Actor, id: string, data: CarryoverInput) {
    const source = this.version(actor, id),
      destination = this.version(actor, data.destinationVersionId);
    checkRevision(source.revision, data.revision);
    checkRevision(destination.revision, data.destinationRevision);
    if (source.projectId !== destination.projectId)
      throw new DomainError(
        400,
        "PROJECT_MISMATCH",
        "같은 프로젝트의 버전만 선택하세요.",
      );
    if (id === destination.id || destination.state !== "planned")
      throw new DomainError(
        400,
        "INVALID_DESTINATION",
        "다른 계획 버전을 선택하세요.",
      );
    return data.issues.map((item) => {
      const issue = this.ctx.issue(actor, item.issueId);
      if (issue.projectId !== source.projectId)
        throw new DomainError(
          400,
          "PROJECT_MISMATCH",
          "같은 프로젝트의 이슈만 이동할 수 있습니다.",
        );
      return issue;
    });
  }
  previewCarryover(actor: Actor, id: string, input: unknown): CarryoverPreview {
    this.ctx.write(actor);
    const data = parse(carryoverInputSchema, input),
      issues = this.carryoverScope(actor, id, data),
      summaries = this.relations.summaries(actor, issues[0].projectId);
    return {
      items: issues.map((issue, index) => {
        let denied = false;
        try {
          this.ctx.writableIssue(actor, issue.id);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          denied = true;
        }
        return {
          issue,
          blocked: summaries[issue.id].blocked,
          outcome: denied
            ? "denied"
            : issue.revision === data.issues[index].revision &&
                issue.targetVersionId === id
              ? "ready"
              : "conflict",
        };
      }),
    };
  }
  private prior<T>(
    actor: Actor,
    id: string,
    kind: string,
    operationId: string,
    payload: string,
    schema: z.ZodType<T>,
  ): T | undefined {
    const row = this.ctx.db
      .prepare(
        "SELECT payload,result FROM release_operations WHERE actorId=? AND kind=? AND operationId=?",
      )
      .get(actor.id, kind, operationId);
    if (!row) return undefined;
    if (row.payload !== payload)
      throw new DomainError(
        409,
        "OPERATION_CONFLICT",
        "같은 작업 ID에 다른 내용을 보낼 수 없습니다.",
      );
    this.version(actor, id);
    return schema.parse(JSON.parse(z.string().parse(row.result)) as unknown);
  }
  private record(
    actor: Actor,
    id: string,
    kind: string,
    operationId: string,
    payload: string,
    result: unknown,
  ) {
    this.ctx.db
      .prepare("INSERT INTO release_operations VALUES (?,?,?,?,?,?,?)")
      .run(
        actor.id,
        kind,
        operationId,
        id,
        payload,
        JSON.stringify(result),
        this.ctx.now(),
      );
  }
  carryover(actor: Actor, id: string, input: unknown): CarryoverResult {
    this.ctx.write(actor);
    const data = parse(carryoverInputSchema, input),
      payload = JSON.stringify({ versionId: id, ...data });
    return this.ctx.tx(() => {
      this.version(actor, id);
      const previous = this.prior(
        actor,
        id,
        "carryover",
        data.operationId,
        payload,
        carryoverResultSchema,
      );
      if (previous) return previous;
      const issues = this.carryoverScope(actor, id, data),
        items: CarryoverResult["items"] = [];
      for (const [index, issue] of issues.entries()) {
        this.ctx.db.exec("SAVEPOINT carryover_item");
        try {
          if (issue.targetVersionId !== id)
            throw new DomainError(
              409,
              "REVISION_CONFLICT",
              "목표 버전이 변경되었습니다.",
            );
          const updated = this.patchIssue(actor, issue.id, {
            revision: data.issues[index].revision,
            targetVersionId: data.destinationVersionId,
          });
          this.ctx.db.exec("RELEASE carryover_item");
          items.push({
            issueId: issue.id,
            outcome: "moved",
            code: null,
            issue: updated,
          });
        } catch (error) {
          this.ctx.db.exec(
            "ROLLBACK TO carryover_item; RELEASE carryover_item",
          );
          if (!(error instanceof DomainError)) throw error;
          items.push({
            issueId: issue.id,
            outcome: error.status === 409 ? "conflict" : "failed",
            code: error.code,
            issue: null,
          });
        }
      }
      const result = { items };
      this.record(actor, id, "carryover", data.operationId, payload, result);
      return result;
    });
  }
  changelog(actor: Actor, id: string): Changelog {
    this.version(actor, id);
    const row = this.ctx.db
      .prepare("SELECT * FROM version_changelogs WHERE versionId=?")
      .get(id);
    if (!row)
      return {
        versionId: id,
        markdown: "",
        selectedIssueIds: [],
        revision: 0,
        authorId: null,
        authorName: null,
        updatedAt: null,
      };
    return changelogSchema.parse({
      ...row,
      selectedIssueIds: JSON.parse(
        z.string().parse(row.selectedIssueIds),
      ) as unknown,
    });
  }
  private selection(actor: Actor, id: string, ids: string[]) {
    const scope = this.readiness(actor, id),
      allowed = new Set(
        [...scope.targetIssues, ...scope.foundIssues, ...scope.fixedIssues].map(
          (i) => i.id,
        ),
      );
    return ids.map((issueId) => {
      const issue = this.ctx.issue(actor, issueId);
      if (!allowed.has(issue.id))
        throw new DomainError(
          400,
          "VERSION_SCOPE",
          "선택한 이슈는 이 버전 범위에 있어야 합니다.",
        );
      return issue;
    });
  }
  saveChangelog(actor: Actor, id: string, input: unknown): Changelog {
    this.ctx.write(actor);
    const data = parse(changelogInputSchema, input);
    return this.ctx.tx(() => {
      this.selection(actor, id, data.selectedIssueIds);
      const old = this.changelog(actor, id);
      checkRevision(old.revision, data.revision);
      const result = {
        versionId: id,
        markdown: data.markdown,
        selectedIssueIds: JSON.stringify(data.selectedIssueIds),
        revision: old.revision + 1,
        authorId: actor.id,
        authorName: actor.name,
        updatedAt: this.ctx.now(),
      };
      this.ctx.db
        .prepare(
          "INSERT INTO version_changelogs VALUES (?,?,?,?,?,?,?) ON CONFLICT(versionId) DO UPDATE SET markdown=excluded.markdown,selectedIssueIds=excluded.selectedIssueIds,revision=excluded.revision,authorId=excluded.authorId,authorName=excluded.authorName,updatedAt=excluded.updatedAt",
        )
        .run(...Object.values(result));
      this.ctx.db
        .prepare(
          "INSERT INTO version_changelog_history VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(randomUUID(), ...Object.values(result));
      return this.changelog(actor, id);
    });
  }
  generateChangelog(actor: Actor, id: string, input: unknown): Changelog {
    this.ctx.write(actor);
    const data = parse(generateChangelogInputSchema, input),
      version = this.version(actor, id),
      issues = this.selection(actor, id, data.selectedIssueIds);
    const markdown = `# ${markdownText(version.name)}\n\n${issues
      .map((issue) => {
        const url = new URL("/", this.origin);
        url.hash = new URLSearchParams({
          project: issue.projectId,
          issue: issue.id,
        }).toString();
        return `- [${markdownText(issue.key)} · ${markdownText(issue.title)}](${url.href}) — ${issue.status}`;
      })
      .join("\n")}\n`;
    return this.saveChangelog(actor, id, { ...data, markdown });
  }
  release(actor: Actor, id: string, input: unknown): ReleaseResult {
    this.ctx.owner(actor);
    const data = parse(releaseInputSchema, input),
      payload = JSON.stringify({ versionId: id, ...data });
    return this.ctx.tx(() => {
      const current = this.version(actor, id),
        previous = this.prior(
          actor,
          id,
          "release",
          data.operationId,
          payload,
          releaseResultSchema,
        );
      if (previous) return previous;
      checkRevision(current.revision, data.revision);
      if (current.state === data.state)
        throw new DomainError(409, "STATE_UNCHANGED", "이미 같은 상태입니다.");
      const audit = {
        id: randomUUID(),
        versionId: id,
        authorId: actor.id,
        authorName: actor.name,
        fromState: current.state,
        toState: data.state,
        reviewedRevision: data.revision,
        operationId: data.operationId,
        createdAt: this.ctx.now(),
      };
      this.ctx.update("versions", id, {
        state: data.state,
        revision: current.revision + 1,
        updatedAt: this.ctx.now(),
      });
      this.ctx.db
        .prepare("INSERT INTO version_release_audit VALUES (?,?,?,?,?,?,?,?,?)")
        .run(...Object.values(audit));
      const result = { version: this.version(actor, id), audit };
      this.record(actor, id, "release", data.operationId, payload, result);
      return result;
    });
  }
}
