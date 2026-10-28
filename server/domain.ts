import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { openDatabase } from "./db.js";
import {
  STATUSES,
  type Actor,
  type Project,
  type Version,
  type Issue,
  type Comment,
  type Activity,
  type Attachment,
  type AgentReport,
  type Bootstrap,
  type IssueDetail,
} from "./types.js";

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(160);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "올바른 날짜를 입력하세요.");
const projectFields = {
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/),
  name,
  description: z.string().max(20000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
};
const projectCreate = z
  .object({
    ...projectFields,
    description: projectFields.description.default(""),
    color: projectFields.color.default("#d6ed61"),
  })
  .strict();
const projectUpdate = z.object(projectFields).partial().strict();
const versionFields = {
  name,
  description: z.string().max(20000),
  state: z.enum(["planned", "released", "archived"]),
  dueDate: date.nullable(),
};
const versionCreate = z
  .object({
    projectId: id,
    ...versionFields,
    description: versionFields.description.default(""),
    state: versionFields.state.default("planned"),
    dueDate: versionFields.dueDate.default(null),
  })
  .strict();
const versionUpdate = z.object(versionFields).partial().strict();
const issueFields = {
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100000),
  status: z.enum(STATUSES),
  priority: z.enum(["none", "low", "medium", "high", "urgent"]),
  assignee: z.string().trim().max(160),
  targetVersionId: id.nullable(),
  foundVersionId: id.nullable(),
  fixedVersionId: id.nullable(),
  labels: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .transform((v) => [...new Set(v)]),
};
const issueCreate = z
  .object({
    projectId: id,
    ...issueFields,
    description: issueFields.description.default(""),
    status: issueFields.status.default("backlog"),
    priority: issueFields.priority.default("none"),
    assignee: issueFields.assignee.default(""),
    targetVersionId: issueFields.targetVersionId.default(null),
    foundVersionId: issueFields.foundVersionId.default(null),
    fixedVersionId: issueFields.fixedVersionId.default(null),
    labels: issueFields.labels.default([]),
  })
  .strict();
const issueUpdate = z
  .object({ ...issueFields })
  .partial()
  .extend({ revision: z.number().int().positive() })
  .strict();
const attachmentName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (v) => !/[\x00-\x1f\x7f]/.test(v),
    "파일 이름에 제어 문자를 사용할 수 없습니다.",
  );
const attachmentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("link"),
      name: attachmentName,
      url: z
        .string()
        .max(4096)
        .url()
        .refine((v) => {
          const u = new URL(v);
          return (
            ["http:", "https:"].includes(u.protocol) &&
            !u.username &&
            !u.password
          );
        }, "http/https 링크만 지원합니다."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("file"),
      name: attachmentName,
      storageKey: z.uuid(),
      mimeType: z
        .string()
        .min(1)
        .max(150)
        .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
      size: z
        .number()
        .int()
        .min(0)
        .max(20 * 1024 * 1024),
    })
    .strict(),
]);
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const out = schema.safeParse(input);
  if (!out.success)
    throw new DomainError(
      400,
      "VALIDATION",
      out.error.issues
        .map((i) => `${i.path.join(".") || "입력"}: ${i.message}`)
        .join("; "),
    );
  return out.data;
}
function now() {
  return new Date().toISOString();
}
type Row = Record<string, SQLInputValue>;
function issueRow(row: Row): Issue {
  return { ...row, labels: JSON.parse(String(row.labels)) } as unknown as Issue;
}
function reportRow(row: Row): AgentReport {
  const elapsed = Date.now() - Date.parse(String(row.reportedAt));
  return {
    ...row,
    stale: !Number.isFinite(elapsed) || elapsed > 300_000 || elapsed < -60_000,
  } as unknown as AgentReport;
}

/** All authorization and business rules shared by HTTP and MCP live here. */
export class Store {
  private db: DatabaseSync;
  constructor(dataDir: string) {
    this.db = openDatabase(dataDir);
  }
  close() {
    this.db.close();
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      if (e instanceof Error && e.message.includes("UNIQUE constraint failed"))
        throw new DomainError(
          409,
          "CONFLICT",
          "이미 같은 식별자 또는 이름이 있습니다.",
        );
      throw e;
    }
  }
  private get(table: string, idValue: string): Row {
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .get(idValue) as Row | undefined;
    if (!row)
      throw new DomainError(404, "NOT_FOUND", "항목을 찾을 수 없습니다.");
    return row;
  }
  private insert(table: string, obj: Record<string, SQLInputValue>) {
    const keys = Object.keys(obj);
    this.db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .run(...keys.map((k) => obj[k]!));
  }
  private update(
    table: string,
    idValue: string,
    obj: Record<string, SQLInputValue>,
  ) {
    const keys = Object.keys(obj);
    if (keys.length)
      this.db
        .prepare(
          `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
        )
        .run(...keys.map((k) => obj[k]!), idValue);
  }
  private write(actor: Actor) {
    if (!actor.canWrite)
      throw new DomainError(403, "READ_ONLY", "읽기 전용 접근 권한입니다.");
  }
  private owner(actor: Actor) {
    this.write(actor);
    if (actor.role !== "owner")
      throw new DomainError(
        403,
        "OWNER_REQUIRED",
        "소유자만 할 수 있는 작업입니다.",
      );
  }
  private scope(actor: Actor, projectId: string) {
    if (
      actor.role !== "owner" &&
      actor.projectIds !== null &&
      !actor.projectIds.includes(projectId)
    )
      throw new DomainError(
        403,
        "PROJECT_SCOPE",
        "이 프로젝트에 접근할 권한이 없습니다.",
      );
  }
  private project(actor: Actor, projectId: string): Project {
    this.scope(actor, projectId);
    const { nextIssue: _, ...row } = this.get("projects", projectId);
    return row as unknown as Project;
  }
  private issue(actor: Actor, issueId: string): Issue {
    const row = issueRow(this.get("issues", issueId));
    this.scope(actor, row.projectId);
    return row;
  }
  private writableIssue(actor: Actor, issueId: string): Issue {
    this.write(actor);
    const issue = this.issue(actor, issueId);
    if (issue.status === "closed" && actor.role !== "owner")
      throw new DomainError(
        403,
        "OWNER_REQUIRED",
        "종료된 이슈는 소유자만 변경할 수 있습니다.",
      );
    return issue;
  }
  private activity(
    actor: Actor,
    issueId: string,
    action: string,
    detail: string,
  ) {
    this.insert("activity", {
      id: randomUUID(),
      issueId,
      action,
      detail,
      authorId: actor.id,
      authorName: actor.name,
      createdAt: now(),
    });
  }
  private versionsBelong(
    projectId: string,
    input: {
      targetVersionId?: string | null;
      foundVersionId?: string | null;
      fixedVersionId?: string | null;
    },
  ) {
    for (const key of [
      "targetVersionId",
      "foundVersionId",
      "fixedVersionId",
    ] as const) {
      const value = input[key];
      if (value) {
        const v = this.db
          .prepare("SELECT projectId FROM versions WHERE id=?")
          .get(value);
        if (!v || v.projectId !== projectId)
          throw new DomainError(
            400,
            "VERSION_PROJECT",
            "버전은 이슈와 같은 프로젝트에 있어야 합니다.",
          );
      }
    }
  }

  bootstrap(actor: Actor): Bootstrap {
    const allProjects = this.db
      .prepare(
        "SELECT id,key,name,description,color,createdAt,updatedAt FROM projects ORDER BY createdAt,id",
      )
      .all() as unknown as Project[];
    const projects = allProjects.filter(
      (p) =>
        actor.role === "owner" ||
        actor.projectIds === null ||
        actor.projectIds.includes(p.id),
    );
    const allowed = new Set(projects.map((p) => p.id));
    const versions = (
      this.db
        .prepare("SELECT * FROM versions ORDER BY createdAt,id")
        .all() as unknown as Version[]
    ).filter((v) => allowed.has(v.projectId));
    const issues = (
      this.db
        .prepare("SELECT * FROM issues ORDER BY updatedAt DESC,rowid DESC")
        .all() as Row[]
    )
      .map(issueRow)
      .filter((v) => allowed.has(v.projectId));
    const reports = (
      this.db
        .prepare("SELECT * FROM agent_reports ORDER BY reportedAt DESC")
        .all() as Row[]
    )
      .map(reportRow)
      .filter((v) => allowed.has(v.projectId));
    return { actor, projects, versions, issues, reports };
  }
  getIssue(actor: Actor, issueId: string): IssueDetail {
    const issue = this.issue(actor, issueId);
    return {
      issue,
      comments: this.db
        .prepare(
          "SELECT * FROM comments WHERE issueId=? ORDER BY createdAt,rowid",
        )
        .all(issueId) as unknown as Comment[],
      activity: this.db
        .prepare(
          "SELECT * FROM activity WHERE issueId=? ORDER BY createdAt,rowid",
        )
        .all(issueId) as unknown as Activity[],
      attachments: this.db
        .prepare(
          "SELECT * FROM attachments WHERE issueId=? ORDER BY createdAt,rowid",
        )
        .all(issueId) as unknown as Attachment[],
    };
  }
  createProject(actor: Actor, input: unknown): Project {
    this.owner(actor);
    const data = parse(projectCreate, input);
    return this.tx(() => {
      const stamp = now(),
        p = { id: randomUUID(), ...data, createdAt: stamp, updatedAt: stamp };
      this.insert("projects", p);
      return p;
    });
  }
  updateProject(actor: Actor, projectId: string, input: unknown): Project {
    this.write(actor);
    const data = parse(projectUpdate, input);
    return this.tx(() => {
      const current = this.project(actor, projectId);
      if (
        data.key &&
        data.key !== current.key &&
        Number(this.get("projects", projectId).nextIssue) > 1
      )
        throw new DomainError(
          409,
          "PROJECT_KEY_LOCKED",
          "이슈 번호가 발급된 프로젝트의 키는 바꿀 수 없습니다.",
        );
      this.update("projects", projectId, { ...data, updatedAt: now() });
      return this.project(actor, projectId);
    });
  }
  deleteProject(actor: Actor, projectId: string): void {
    this.owner(actor);
    this.tx(() => {
      this.project(actor, projectId);
      const count = this.db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM issues WHERE projectId=?) + (SELECT COUNT(*) FROM versions WHERE projectId=?) AS n",
        )
        .get(projectId, projectId);
      if (Number(count?.n) > 0)
        throw new DomainError(
          409,
          "PROJECT_NOT_EMPTY",
          "프로젝트의 이슈와 버전을 먼저 삭제하세요.",
        );
      this.db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
    });
  }
  createVersion(actor: Actor, input: unknown): Version {
    this.write(actor);
    const data = parse(versionCreate, input);
    return this.tx(() => {
      this.project(actor, data.projectId);
      const stamp = now(),
        v = { id: randomUUID(), ...data, createdAt: stamp, updatedAt: stamp };
      this.insert("versions", v);
      return v;
    });
  }
  updateVersion(actor: Actor, versionId: string, input: unknown): Version {
    this.write(actor);
    const data = parse(versionUpdate, input);
    return this.tx(() => {
      const old = this.get("versions", versionId);
      this.scope(actor, String(old.projectId));
      this.update("versions", versionId, { ...data, updatedAt: now() });
      return this.get("versions", versionId) as unknown as Version;
    });
  }
  deleteVersion(actor: Actor, versionId: string): void {
    this.write(actor);
    this.tx(() => {
      const v = this.get("versions", versionId);
      this.scope(actor, String(v.projectId));
      const affected = this.db
        .prepare(
          "SELECT * FROM issues WHERE targetVersionId=? OR foundVersionId=? OR fixedVersionId=?",
        )
        .all(versionId, versionId, versionId) as Row[];
      for (const row of affected) {
        this.writableIssue(actor, String(row.id));
        const change: Record<string, SQLInputValue> = {
          revision: Number(row.revision) + 1,
          updatedAt: now(),
        };
        for (const key of [
          "targetVersionId",
          "foundVersionId",
          "fixedVersionId",
        ])
          if (row[key] === versionId) change[key] = null;
        this.update("issues", String(row.id), change);
        this.activity(
          actor,
          String(row.id),
          "version_removed",
          `버전 삭제: ${String(v.name)}`,
        );
      }
      this.db.prepare("DELETE FROM versions WHERE id=?").run(versionId);
    });
  }
  createIssue(actor: Actor, input: unknown): Issue {
    this.write(actor);
    const data = parse(issueCreate, input);
    if (data.status === "closed" && actor.role !== "owner")
      throw new DomainError(
        403,
        "OWNER_REQUIRED",
        "소유자만 이슈를 종료할 수 있습니다.",
      );
    return this.tx(() => {
      const p = this.project(actor, data.projectId),
        internal = this.get("projects", p.id);
      this.versionsBelong(p.id, data);
      const stamp = now(),
        issue: Issue = {
          id: randomUUID(),
          key: `${p.key}-${internal.nextIssue}`,
          ...data,
          revision: 1,
          createdAt: stamp,
          updatedAt: stamp,
        };
      this.insert("issues", { ...issue, labels: JSON.stringify(issue.labels) });
      this.db
        .prepare("UPDATE projects SET nextIssue=nextIssue+1 WHERE id=?")
        .run(p.id);
      this.activity(actor, issue.id, "created", "이슈 생성");
      return issue;
    });
  }
  updateIssue(actor: Actor, issueId: string, input: unknown): Issue {
    this.write(actor);
    if (
      !input ||
      typeof input !== "object" ||
      !("revision" in input) ||
      !Number.isInteger((input as { revision: unknown }).revision) ||
      Number((input as { revision: unknown }).revision) < 1
    )
      throw new DomainError(
        422,
        "REVISION_REQUIRED",
        "최신 이슈 revision을 함께 보내세요.",
      );
    const { revision, ...data } = parse(issueUpdate, input);
    return this.tx(() => {
      const current = this.writableIssue(actor, issueId);
      if (current.revision !== revision)
        throw new DomainError(
          409,
          "REVISION_CONFLICT",
          "다른 사용자가 변경했습니다. 최신 이슈를 불러온 뒤 다시 시도하세요.",
        );
      if (data.status === "closed" && actor.role !== "owner")
        throw new DomainError(
          403,
          "OWNER_REQUIRED",
          "소유자만 이슈를 종료할 수 있습니다.",
        );
      this.versionsBelong(current.projectId, data);
      const changes: Record<string, SQLInputValue> = {
        ...data,
        revision: revision + 1,
        updatedAt: now(),
        ...(data.labels ? { labels: JSON.stringify(data.labels) } : {}),
      } as Record<string, SQLInputValue>;
      this.update("issues", issueId, changes);
      this.activity(
        actor,
        issueId,
        "updated",
        Object.keys(data).length
          ? `변경: ${Object.keys(data).join(", ")}`
          : "이슈 확인",
      );
      return this.issue(actor, issueId);
    });
  }
  deleteIssue(actor: Actor, issueId: string): void {
    this.owner(actor);
    this.tx(() => {
      this.issue(actor, issueId);
      this.db.prepare("DELETE FROM issues WHERE id=?").run(issueId);
    });
  }
  addComment(actor: Actor, issueId: string, input: unknown): Comment {
    this.write(actor);
    const data = parse(
      z.object({ body: z.string().trim().min(1).max(20000) }).strict(),
      input,
    );
    return this.tx(() => {
      this.writableIssue(actor, issueId);
      const c = {
        id: randomUUID(),
        issueId,
        ...data,
        authorId: actor.id,
        authorName: actor.name,
        createdAt: now(),
      };
      this.insert("comments", c);
      this.activity(actor, issueId, "commented", "댓글 작성");
      return c;
    });
  }
  deleteComment(actor: Actor, commentId: string): void {
    this.write(actor);
    this.tx(() => {
      const c = this.get("comments", commentId);
      this.writableIssue(actor, String(c.issueId));
      if (actor.role !== "owner" && c.authorId !== actor.id)
        throw new DomainError(
          403,
          "AUTHOR_REQUIRED",
          "작성자 또는 소유자만 삭제할 수 있습니다.",
        );
      this.db.prepare("DELETE FROM comments WHERE id=?").run(commentId);
      this.activity(actor, String(c.issueId), "comment_removed", "댓글 삭제");
    });
  }
  addAttachment(actor: Actor, issueId: string, input: unknown): Attachment {
    this.write(actor);
    const data = parse(attachmentSchema, input);
    return this.tx(() => {
      this.writableIssue(actor, issueId);
      const a: Attachment = {
        id: randomUUID(),
        issueId,
        kind: data.kind,
        name: data.name,
        url: data.kind === "link" ? data.url : null,
        storageKey: data.kind === "file" ? data.storageKey : null,
        mimeType: data.kind === "file" ? data.mimeType : null,
        size: data.kind === "file" ? data.size : 0,
        authorId: actor.id,
        authorName: actor.name,
        createdAt: now(),
      };
      this.insert("attachments", { ...a });
      this.activity(actor, issueId, "attachment_added", `자료 추가: ${a.name}`);
      return a;
    });
  }
  getAttachment(actor: Actor, attachmentId: string): Attachment {
    const a = this.get("attachments", attachmentId) as unknown as Attachment;
    this.issue(actor, a.issueId);
    return a;
  }
  deleteAttachment(actor: Actor, attachmentId: string): Attachment {
    this.write(actor);
    return this.tx(() => {
      const a = this.getAttachment(actor, attachmentId);
      this.writableIssue(actor, a.issueId);
      if (actor.role !== "owner" && a.authorId !== actor.id)
        throw new DomainError(
          403,
          "AUTHOR_REQUIRED",
          "작성자 또는 소유자만 삭제할 수 있습니다.",
        );
      this.db.prepare("DELETE FROM attachments WHERE id=?").run(attachmentId);
      this.activity(
        actor,
        a.issueId,
        "attachment_removed",
        `자료 삭제: ${a.name}`,
      );
      return a;
    });
  }
  reportAgent(actor: Actor, input: unknown): AgentReport {
    this.write(actor);
    if (actor.role !== "agent")
      throw new DomainError(
        403,
        "AGENT_REQUIRED",
        "에이전트 인증으로만 상태를 보고할 수 있습니다.",
      );
    const data = parse(
      z
        .object({
          projectId: id,
          issueId: id.nullable().optional().default(null),
          state: z.enum(["idle", "working", "blocked", "done"]),
          message: z.string().trim().max(2000),
        })
        .strict(),
      input,
    );
    return this.tx(() => {
      this.project(actor, data.projectId);
      if (data.issueId) {
        const issue = this.db
          .prepare("SELECT projectId FROM issues WHERE id=?")
          .get(data.issueId);
        if (!issue || issue.projectId !== data.projectId)
          throw new DomainError(
            400,
            "ISSUE_PROJECT",
            "이슈는 보고와 같은 프로젝트에 있어야 합니다.",
          );
      }
      const old = this.db
        .prepare("SELECT id FROM agent_reports WHERE agentId=? AND projectId=?")
        .get(actor.id, data.projectId);
      const record = {
        id: old ? String(old.id) : randomUUID(),
        agentId: actor.id,
        agentName: actor.name,
        ...data,
        reportedAt: now(),
      };
      if (old) this.update("agent_reports", record.id, record);
      else this.insert("agent_reports", record);
      return { ...record, stale: false };
    });
  }
}
