import { randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";
import { z } from "zod";
import { DomainError } from "../domain-error.js";
import type { StoreContext } from "../store-context.js";
import type { Actor } from "../types.js";
import {
  sessionEventInputSchema,
  sessionSchema,
  sessionEventSchema,
  sessionRequestSchema,
  responseInputSchema,
  closeInputSchema,
  type AgentSession,
  type SessionEvent,
  type SessionRequest,
} from "../contracts/sessions.js";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const out = schema.safeParse(input);
  if (!out.success)
    throw new DomainError(
      400,
      "VALIDATION",
      out.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return out.data;
}
const sessionColumns =
  "id,externalSessionId,agentId,agentName,projectId,issueId,startedAt,lastReportedAt,endedAt,closedAt,revision,legacy";
const requestSql = `SELECT r.id,r.sessionId,r.eventId,r.kind,r.prompt,r.createdAt,r.revision,r.status,
  a.body AS response,a.createdAt AS respondedAt,s.projectId,s.issueId,s.agentName,s.externalSessionId
  FROM session_requests r JOIN agent_sessions s ON s.id=r.sessionId LEFT JOIN session_responses a ON a.requestId=r.id`;
/** Records self-reported information only. No execution, approval, or issue-closure side effects. */
export class SessionService {
  constructor(private readonly context: StoreContext) {}
  private session(actor: Actor, id: string): AgentSession {
    const c = this.context;
    const row = c.db
      .prepare(`SELECT ${sessionColumns} FROM agent_sessions WHERE id=?`)
      .get(id);
    if (!row)
      throw new DomainError(
        404,
        "SESSION_NOT_FOUND",
        "세션이 없거나 삭제되었습니다.",
      );
    c.scope(actor, z.string().parse(row.projectId));
    const requests = c.db
      .prepare(
        "SELECT kind,COUNT(*) AS n FROM session_requests WHERE sessionId=? AND status='pending' GROUP BY kind",
      )
      .all(id);
    const pendingInput = Number(
      requests.find((r) => r.kind === "input")?.n ?? 0,
    );
    const pendingReview = Number(
      requests.find((r) => r.kind === "review")?.n ?? 0,
    );
    const elapsed =
      c.clock() - Date.parse(z.string().parse(row.lastReportedAt));
    const stale =
      !Number.isFinite(elapsed) || elapsed > 300000 || elapsed < -60000;
    const last = c.db
      .prepare(
        "SELECT payload FROM session_events WHERE sessionId=? AND kind='report' ORDER BY occurredAt DESC,receivedAt DESC,eventId DESC LIMIT 1",
      )
      .get(id);
    const payload: unknown =
      last && typeof last.payload === "string" ? JSON.parse(last.payload) : {};
    const state = row.closedAt
      ? "closed"
      : stale
        ? "stale"
        : row.endedAt
          ? "ended"
          : pendingInput
            ? "input"
            : pendingReview
              ? "review"
              : (z
                  .object({
                    state: z.enum(["working", "idle", "blocked"]).optional(),
                  })
                  .parse(payload).state ?? "recorded");
    return sessionSchema.parse({
      ...row,
      lastMessage: z
        .string()
        .parse(
          c.db
            .prepare(
              "SELECT message FROM session_events WHERE sessionId=? ORDER BY receivedAt DESC,eventId DESC LIMIT 1",
            )
            .get(id)?.message ?? "",
        ),
      legacy: row.legacy === 1,
      state,
      stale,
      pendingInput,
      pendingReview,
    });
  }
  private event(row: Record<string, SQLOutputValue>): SessionEvent {
    const payload: unknown = JSON.parse(z.string().parse(row.payload));
    return sessionEventSchema.parse({ ...row, payload });
  }
  private request(actor: Actor, id: string): SessionRequest {
    const row = this.context.db.prepare(`${requestSql} WHERE r.id=?`).get(id);
    if (!row)
      throw new DomainError(
        404,
        "REQUEST_NOT_FOUND",
        "요청이 없거나 삭제되었습니다.",
      );
    const result = sessionRequestSchema.parse(row);
    this.context.scope(actor, result.projectId);
    return result;
  }
  getRequest(actor: Actor, id: string): SessionRequest {
    return this.request(actor, id);
  }
  list(actor: Actor, projectId?: string): AgentSession[] {
    const c = this.context;
    if (projectId) c.project(actor, projectId);
    const rows = c.db
      .prepare(
        `SELECT id,projectId FROM agent_sessions ${projectId ? "WHERE projectId=?" : ""} ORDER BY lastReportedAt DESC,id`,
      )
      .all(...(projectId ? [projectId] : []));
    return rows
      .filter(
        (r) =>
          actor.role === "owner" ||
          actor.projectIds === null ||
          actor.projectIds.includes(z.string().parse(r.projectId)),
      )
      .map((r) => this.session(actor, z.string().parse(r.id)));
  }
  get(actor: Actor, id: string) {
    const session = this.session(actor, id);
    const events = this.context.db
      .prepare(
        "SELECT sessionId,eventId,kind,occurredAt,receivedAt,message,payload FROM session_events WHERE sessionId=? ORDER BY occurredAt,receivedAt,eventId",
      )
      .all(id)
      .map((r) => this.event(r));
    const requests = sessionRequestSchema
      .array()
      .parse(
        this.context.db
          .prepare(
            `${requestSql} WHERE r.sessionId=? ORDER BY r.createdAt,r.id`,
          )
          .all(id),
      );
    return { session, events, requests };
  }
  inbox(actor: Actor, projectId?: string, completed = false): SessionRequest[] {
    const c = this.context;
    if (projectId) c.project(actor, projectId);
    return sessionRequestSchema
      .array()
      .parse(
        c.db
          .prepare(
            `${requestSql} WHERE r.status ${completed ? "<>" : "="} 'pending' ORDER BY r.createdAt,r.id`,
          )
          .all(),
      )
      .filter(
        (r) =>
          (!projectId || r.projectId === projectId) &&
          (actor.role === "owner" ||
            actor.projectIds === null ||
            actor.projectIds.includes(r.projectId)),
      )
      .filter(
        (r) =>
          actor.role === "owner" ||
          this.session(actor, r.sessionId).agentId === actor.id,
      );
  }
  report(
    actor: Actor,
    input: unknown,
    legacy = false,
    onNewEvent?: (receivedAt: string) => void,
  ) {
    const c = this.context;
    c.write(actor);
    if (actor.role !== "agent")
      throw new DomainError(
        403,
        "AGENT_REQUIRED",
        "에이전트 인증으로만 자기 보고를 기록할 수 있습니다.",
      );
    const data = parse(sessionEventInputSchema, input);
    if (data.occurredAt && Date.parse(data.occurredAt) > c.clock() + 60000)
      throw new DomainError(
        400,
        "EVENT_TIME",
        "보고 시각은 서버 시각보다 1분 이상 미래일 수 없습니다.",
      );
    const fingerprint = JSON.stringify(data);
    return c.tx(() => {
      c.project(actor, data.projectId);
      if (data.issueId) {
        const linked = c.get("issues", data.issueId);
        if (linked.projectId !== data.projectId)
          throw new DomainError(
            400,
            "ISSUE_PROJECT",
            "이슈는 세션과 같은 프로젝트에 있어야 합니다.",
          );
        c.writableIssue(actor, data.issueId);
      }
      const old = c.db
        .prepare(
          "SELECT id,issueId,closedAt FROM agent_sessions WHERE agentId=? AND projectId=? AND externalSessionId=?",
        )
        .get(actor.id, data.projectId, data.externalSessionId);
      if (old && old.issueId !== data.issueId)
        throw new DomainError(
          409,
          "SESSION_ISSUE_CONFLICT",
          "기존 세션의 연결 이슈를 바꿀 수 없습니다.",
        );
      const sessionId = old ? z.string().parse(old.id) : randomUUID();
      const existing = c.db
        .prepare(
          "SELECT fingerprint FROM session_events WHERE sessionId=? AND eventId=?",
        )
        .get(sessionId, data.eventId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new DomainError(
            409,
            "EVENT_CONFLICT",
            "같은 eventId에 다른 내용을 보낼 수 없습니다.",
          );
        return this.reportResult(actor, sessionId, data.eventId);
      }
      if (old?.closedAt)
        throw new DomainError(
          409,
          "SESSION_CLOSED",
          "소유자가 종결한 세션에는 보고를 추가할 수 없습니다.",
        );
      const receivedAt = c.now(),
        occurredAt = data.occurredAt ?? receivedAt;
      if (!old)
        c.insert("agent_sessions", {
          id: sessionId,
          externalSessionId: data.externalSessionId,
          agentId: actor.id,
          agentName: actor.name,
          projectId: data.projectId,
          issueId: data.issueId,
          startedAt: receivedAt,
          lastReportedAt: receivedAt,
          endedAt: null,
          closedAt: null,
          revision: 1,
          legacy: legacy ? 1 : 0,
        });
      const payload =
        data.kind === "report"
          ? { state: data.state }
          : data.kind === "request"
            ? { requestKind: data.requestKind }
            : {};
      c.db
        .prepare("INSERT INTO session_events VALUES (?,?,?,?,?,?,?,?)")
        .run(
          sessionId,
          data.eventId,
          data.kind,
          occurredAt,
          receivedAt,
          data.message,
          JSON.stringify(payload),
          fingerprint,
        );
      if (data.kind === "request")
        c.insert("session_requests", {
          id: randomUUID(),
          sessionId,
          eventId: data.eventId,
          kind: data.requestKind,
          prompt: data.message,
          createdAt: receivedAt,
          revision: 1,
          status: "pending",
        });
      c.db
        .prepare(
          "UPDATE agent_sessions SET lastReportedAt=?,revision=revision+?,endedAt=CASE WHEN ?='end' THEN ? WHEN legacy=1 AND ?=1 THEN NULL ELSE endedAt END WHERE id=?",
        )
        .run(
          receivedAt,
          old ? 1 : 0,
          data.kind,
          occurredAt,
          legacy ? 1 : 0,
          sessionId,
        );
      onNewEvent?.(receivedAt);
      return this.reportResult(actor, sessionId, data.eventId);
    });
  }
  private reportResult(actor: Actor, sessionId: string, eventId: string) {
    const detail = this.get(actor, sessionId);
    const event = detail.events.find((e) => e.eventId === eventId);
    if (!event) throw new Error("Stored event is missing");
    return {
      session: detail.session,
      event,
      request: detail.requests.find((r) => r.eventId === eventId) ?? null,
    };
  }
  respond(actor: Actor, id: string, input: unknown): SessionRequest {
    const c = this.context;
    c.owner(actor);
    const data = parse(responseInputSchema, input);
    return c.tx(() => {
      const current = this.request(actor, id);
      const prior = c.db
        .prepare(
          "SELECT requestId,body,revision FROM session_responses WHERE authorId=? AND operationId=?",
        )
        .get(actor.id, data.operationId);
      if (prior) {
        if (
          prior.requestId !== id ||
          prior.body !== data.body ||
          prior.revision !== data.revision
        )
          throw new DomainError(
            409,
            "OPERATION_CONFLICT",
            "동일 operationId는 같은 요청과 답변에만 사용할 수 있습니다.",
          );
        return current;
      }
      if (current.revision !== data.revision || current.status !== "pending")
        throw new DomainError(
          409,
          "REVISION_CONFLICT",
          "이미 처리되었거나 변경된 요청입니다. 작성한 답변을 유지하고 최신 상태를 확인하세요.",
        );
      c.insert("session_responses", {
        id: randomUUID(),
        requestId: id,
        authorId: actor.id,
        operationId: data.operationId,
        body: data.body,
        revision: data.revision,
        createdAt: c.now(),
      });
      c.update("session_requests", id, {
        status: "answered",
        revision: current.revision + 1,
      });
      return this.request(actor, id);
    });
  }
  closeRequest(actor: Actor, id: string, input: unknown): SessionRequest {
    const c = this.context;
    c.owner(actor);
    const data = parse(closeInputSchema, input);
    return c.tx(() => {
      const current = this.request(actor, id),
        raw = c.get("session_requests", id);
      const previousTarget = c.db
        .prepare("SELECT id FROM session_requests WHERE closeOperationId=?")
        .get(data.operationId);
      if (previousTarget && previousTarget.id !== id)
        throw new DomainError(
          409,
          "OPERATION_CONFLICT",
          "동일 operationId는 같은 요청에만 사용할 수 있습니다.",
        );
      if (raw.closeOperationId === data.operationId) {
        if (raw.closeRevision !== data.revision)
          throw new DomainError(
            409,
            "OPERATION_CONFLICT",
            "동일 operationId의 내용이 다릅니다.",
          );
        return current;
      }
      if (current.revision !== data.revision || current.status === "closed")
        throw new DomainError(
          409,
          "REVISION_CONFLICT",
          "이미 처리되었거나 변경된 요청입니다.",
        );
      c.update("session_requests", id, {
        status: "closed",
        revision: current.revision + 1,
        closeOperationId: data.operationId,
        closeRevision: data.revision,
      });
      return this.request(actor, id);
    });
  }
  closeSession(actor: Actor, id: string, input: unknown): AgentSession {
    const c = this.context;
    c.owner(actor);
    const data = parse(closeInputSchema, input);
    return c.tx(() => {
      const current = this.session(actor, id),
        raw = c.get("agent_sessions", id);
      const previousTarget = c.db
        .prepare("SELECT id FROM agent_sessions WHERE closeOperationId=?")
        .get(data.operationId);
      if (previousTarget && previousTarget.id !== id)
        throw new DomainError(
          409,
          "OPERATION_CONFLICT",
          "동일 operationId는 같은 세션에만 사용할 수 있습니다.",
        );
      if (raw.closeOperationId === data.operationId) {
        if (raw.closeRevision !== data.revision)
          throw new DomainError(
            409,
            "OPERATION_CONFLICT",
            "동일 operationId의 내용이 다릅니다.",
          );
        return current;
      }
      if (current.revision !== data.revision || current.closedAt)
        throw new DomainError(
          409,
          "REVISION_CONFLICT",
          "이미 종결되었거나 변경된 세션입니다.",
        );
      c.update("agent_sessions", id, {
        closedAt: c.now(),
        revision: current.revision + 1,
        closeOperationId: data.operationId,
        closeRevision: data.revision,
      });
      return this.session(actor, id);
    });
  }
}
