import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/domain.js";

void test("Store exposes an isolated session history service rather than snapshot reports", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sticker-sessions-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.ok("sessions" in store, "session history service must exist");
});

import { DomainError } from "../server/domain.js";
import type { Actor } from "../server/types.js";
import { randomUUID } from "node:crypto";
const owner: Actor = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "sticker-sessions-"));
  let time = Date.parse("2026-10-28T10:00:00.000Z");
  let store = new Store(dir, () => time);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = store.createProject(owner, { key: "SS", name: "세션" });
  const issue = store.createIssue(owner, {
    projectId: project.id,
    title: "작업 A",
  });
  const agent: Actor = {
    id: "agent-a",
    name: "에이전트",
    role: "agent",
    canWrite: true,
    projectIds: [project.id],
  };
  return {
    get store() {
      return store;
    },
    project,
    issue,
    agent,
    advance(ms: number) {
      time += ms;
    },
    reopen() {
      store.close();
      store = new Store(dir, () => time);
    },
  };
}
function denied(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
void test("parallel issue-scoped and same-issue sessions never overwrite; identical retries deduplicate", (t) => {
  const f = fixture(t);
  const nextIssue = f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "작업 B",
  });
  const body = {
    projectId: f.project.id,
    issueId: f.issue.id,
    externalSessionId: "run-a",
    eventId: "e1",
    kind: "report",
    message: "작업 보고",
  };
  const first = f.store.sessions.report(f.agent, body);
  assert.deepEqual(f.store.sessions.report(f.agent, body), first);
  denied(
    () => f.store.sessions.report(f.agent, { ...body, message: "다른 내용" }),
    "EVENT_CONFLICT",
  );
  f.store.sessions.report(f.agent, {
    ...body,
    issueId: nextIssue.id,
    externalSessionId: "run-b",
  });
  f.store.sessions.report(f.agent, { ...body, externalSessionId: "run-c" });
  assert.equal(f.store.sessions.list(owner).length, 3);
  denied(
    () =>
      f.store.sessions.report(f.agent, {
        ...body,
        issueId: nextIssue.id,
        eventId: "e2",
      }),
    "SESSION_ISSUE_CONFLICT",
  );
});
void test("received-time staleness has exact five-minute boundary and deterministic event ordering", (t) => {
  const f = fixture(t),
    base = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "timeline",
      kind: "report",
      message: "보고",
    };
  const a = f.store.sessions.report(f.agent, {
    ...base,
    eventId: "z",
    occurredAt: "2026-10-28T09:59:00.000Z",
  });
  f.advance(300000);
  assert.equal(f.store.sessions.get(owner, a.session.id).session.stale, false);
  f.advance(1);
  assert.equal(
    f.store.sessions.get(owner, a.session.id).session.state,
    "stale",
  );
  f.store.sessions.report(f.agent, {
    ...base,
    eventId: "a",
    occurredAt: "2026-10-28T09:58:00.000Z",
  });
  assert.deepEqual(
    f.store.sessions.get(owner, a.session.id).events.map((e) => e.eventId),
    ["a", "z"],
  );
  denied(
    () =>
      f.store.sessions.report(f.agent, {
        ...base,
        eventId: "bad",
        occurredAt: "not-time",
      }),
    "VALIDATION",
  );
  denied(
    () =>
      f.store.sessions.report(f.agent, {
        ...base,
        eventId: "future",
        occurredAt: "2027-01-01T00:00:00.000Z",
      }),
    "EVENT_TIME",
  );
});
void test("requests, exact reply idempotence, revision conflicts and owner-only closures survive restart", (t) => {
  const f = fixture(t),
    base = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "requests",
      kind: "request",
      requestKind: "input",
      message: "무엇을 할까요?",
    };
  const first = f.store.sessions.report(f.agent, { ...base, eventId: "q1" });
  const second = f.store.sessions.report(f.agent, {
    ...base,
    eventId: "q2",
    requestKind: "review",
  });
  assert.ok(first.request);
  assert.ok(second.request);
  const requestId = first.request.id,
    secondRequestId = second.request.id;
  denied(
    () =>
      f.store.sessions.respond(f.agent, requestId, {
        revision: 1,
        operationId: randomUUID(),
        body: "에이전트 응답",
      }),
    "OWNER_REQUIRED",
  );
  const reply = {
    revision: 1,
    operationId: randomUUID(),
    body: "계획만 기록해 주세요.",
  };
  const answered = f.store.sessions.respond(owner, requestId, reply);
  assert.equal(answered.status, "answered");
  assert.deepEqual(f.store.sessions.respond(owner, requestId, reply), answered);
  denied(
    () =>
      f.store.sessions.respond(owner, requestId, { ...reply, body: "수정" }),
    "OPERATION_CONFLICT",
  );
  denied(
    () => f.store.sessions.respond(owner, secondRequestId, reply),
    "OPERATION_CONFLICT",
  );
  denied(
    () =>
      f.store.sessions.respond(owner, requestId, {
        ...reply,
        operationId: randomUUID(),
      }),
    "REVISION_CONFLICT",
  );
  denied(
    () =>
      f.store.sessions.closeRequest(f.agent, secondRequestId, {
        revision: 1,
        operationId: randomUUID(),
      }),
    "OWNER_REQUIRED",
  );
  f.reopen();
  assert.equal(f.store.sessions.inbox(owner).length, 1);
  assert.equal(f.store.sessions.inbox(f.agent).length, 1);
  assert.equal(
    f.store.sessions
      .get(owner, first.session.id)
      .requests.find((r) => r.id === requestId)?.response,
    reply.body,
  );
  const close = { revision: 1, operationId: randomUUID() };
  assert.equal(
    f.store.sessions.closeRequest(owner, second.request.id, close).status,
    "closed",
  );
  assert.equal(
    f.store.sessions.closeRequest(owner, second.request.id, close).status,
    "closed",
  );
  const current = f.store.sessions.get(owner, first.session.id).session;
  f.store.sessions.closeSession(owner, current.id, {
    revision: current.revision,
    operationId: randomUUID(),
  });
  assert.equal(f.store.getIssue(owner, f.issue.id).issue.status, "backlog");
});
void test("all direct lookups and mutations enforce current scope, readonly and actor identity", (t) => {
  const f = fixture(t),
    body = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "own",
      eventId: "e1",
      kind: "report",
      message: "보고",
    };
  const result = f.store.sessions.report(f.agent, body);
  const other = { ...f.agent, id: "other" };
  // The external ID namespace is authoritative actor+project, so another actor creates its own session, never modifies this one.
  const theirs = f.store.sessions.report(other, body);
  assert.notEqual(theirs.session.id, result.session.id);
  assert.equal(f.store.sessions.get(owner, result.session.id).events.length, 1);
  denied(
    () => f.store.sessions.report(f.agent, { ...body, agentId: other.id }),
    "VALIDATION",
  );
  denied(
    () => f.store.sessions.report({ ...f.agent, canWrite: false }, body),
    "READ_ONLY",
  );
  denied(
    () =>
      f.store.sessions.get({ ...f.agent, projectIds: [] }, result.session.id),
    "PROJECT_SCOPE",
  );
  denied(
    () => f.store.sessions.list({ ...f.agent, projectIds: [] }, f.project.id),
    "PROJECT_SCOPE",
  );
  denied(
    () =>
      f.store.sessions.closeSession(other, result.session.id, {
        revision: 1,
        operationId: randomUUID(),
      }),
    "OWNER_REQUIRED",
  );
  denied(() => f.store.sessions.report(owner, body), "AGENT_REQUIRED");
  const closed = f.store.updateIssue(owner, f.issue.id, {
    revision: 1,
    status: "closed",
  });
  assert.equal(closed.status, "closed");
  denied(
    () => f.store.sessions.report(f.agent, { ...body, eventId: "closed" }),
    "OWNER_REQUIRED",
  );
});
void test("legacy report endpoint preserves old snapshots while recording separate issue-scoped history", (t) => {
  const f = fixture(t),
    next = f.store.createIssue(owner, {
      projectId: f.project.id,
      title: "다른 이슈",
    });
  f.store.reportAgent(f.agent, {
    projectId: f.project.id,
    issueId: f.issue.id,
    state: "working",
    message: "레거시 A",
  });
  f.store.reportAgent(f.agent, {
    projectId: f.project.id,
    issueId: next.id,
    state: "blocked",
    message: "레거시 B",
  });
  assert.equal(f.store.sessions.list(owner).length, 2);
  assert.equal(f.store.bootstrap(owner).reports.length, 1);
  assert.equal(f.store.sessions.inbox(owner).length, 0);
});

import { sessionHttpFixture } from "./session-fixture.js";
import { readJson } from "./helpers.js";
import {
  sessionEventResultSchema,
  sessionDetailSchema,
  sessionRequestSchema,
} from "../server/contracts/sessions.js";
void test("HTTP session and inbox routes apply authentication, origin, scope, exact-request revisions and owner-only mutations", async () => {
  const f = await sessionHttpFixture();
  try {
    assert.equal((await f.call("/sessions", "anonymous")).status, 401);
    const body = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "http-run",
      eventId: "q1",
      kind: "request",
      requestKind: "input",
      message: "누구에게 답할까요?",
    };
    const created = await f.call("/sessions/events", "agent", "POST", body);
    assert.equal(created.status, 201);
    const result = await readJson(created, sessionEventResultSchema);
    assert.ok(result.request);
    assert.equal(
      (await f.call("/sessions/events", "read", "POST", body)).status,
      403,
    );
    assert.equal(
      (await f.call("/sessions/events", "owner", "POST", body)).status,
      403,
    );
    assert.equal(
      (
        await f.call("/sessions/events", "agent", "POST", {
          ...body,
          eventId: "q2",
          projectId: f.other.id,
          issueId: f.foreign.id,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call("/sessions/events", "unscoped", "POST", {
          ...body,
          eventId: "q2",
          projectId: f.other.id,
          issueId: f.foreign.id,
        })
      ).status,
      201,
    );
    assert.equal(
      (await f.call(`/sessions/${result.session.id}`, "read")).status,
      200,
    );
    assert.equal(
      (await f.call(`/sessions?projectId=${f.other.id}`, "agent")).status,
      403,
    );
    assert.equal(
      (
        await f.call("/sessions/events", "agent", "POST", {
          ...body,
          message: "충돌",
        })
      ).status,
      409,
    );
    const requestId = result.request.id,
      reply = {
        revision: 1,
        operationId: randomUUID(),
        body: "승인이 아닌 답변",
      };
    assert.equal(
      (await f.call(`/requests/${requestId}/responses`, "agent", "POST", reply))
        .status,
      403,
    );
    assert.equal(
      (
        await f.call(`/requests/${requestId}/close`, "read", "POST", {
          revision: 1,
          operationId: randomUUID(),
        })
      ).status,
      403,
    );
    const answered = await readJson(
      await f.call(`/requests/${requestId}/responses`, "owner", "POST", reply),
      sessionRequestSchema,
    );
    assert.equal(answered.response, reply.body);
    assert.equal(answered.id, requestId);
    assert.equal(
      (await f.call(`/requests/${requestId}/responses`, "owner", "POST", reply))
        .status,
      200,
    );
    assert.equal(
      (
        await f.call(`/requests/${requestId}/responses`, "owner", "POST", {
          ...reply,
          operationId: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.call(`/sessions/${result.session.id}/close`, "other", "POST", {
          revision: 1,
          operationId: randomUUID(),
        })
      ).status,
      403,
    );
    const detail = await readJson(
      await f.call(`/sessions/${result.session.id}`),
      sessionDetailSchema,
    );
    assert.equal(detail.requests[0].response, reply.body);
    assert.equal(
      f.instance.store.getIssue(
        {
          id: "owner",
          name: "나",
          role: "owner",
          canWrite: true,
          projectIds: null,
        },
        f.issue.id,
      ).issue.status,
      "backlog",
    );
    assert.equal((await f.call(`/sessions/missing`)).status, 404);
  } finally {
    await f.close();
  }
});
void test("end is agent-reported completion, owner closure blocks new events, and closure operation keys cannot target another request", (t) => {
  const f = fixture(t),
    base = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "end-run",
      kind: "request",
      requestKind: "review",
      message: "검토",
    };
  const a = f.store.sessions.report(f.agent, { ...base, eventId: "a" }),
    b = f.store.sessions.report(f.agent, { ...base, eventId: "b" });
  assert.ok(a.request);
  assert.ok(b.request);
  const secondId = b.request.id;
  const close = { revision: 1, operationId: randomUUID() };
  f.store.sessions.closeRequest(owner, a.request.id, close);
  denied(
    () => f.store.sessions.closeRequest(owner, secondId, close),
    "OPERATION_CONFLICT",
  );
  const ended = f.store.sessions.report(f.agent, {
    projectId: f.project.id,
    issueId: f.issue.id,
    externalSessionId: "end-run",
    eventId: "end",
    kind: "end",
    message: "보고 종료",
  });
  assert.equal(ended.session.closedAt, null);
  assert.ok(ended.session.endedAt);
  assert.equal(f.store.getIssue(owner, f.issue.id).issue.status, "backlog");
  f.store.sessions.closeSession(owner, ended.session.id, {
    revision: ended.session.revision,
    operationId: randomUUID(),
  });
  denied(
    () =>
      f.store.sessions.report(f.agent, {
        projectId: f.project.id,
        issueId: f.issue.id,
        externalSessionId: "end-run",
        eventId: "later",
        kind: "report",
        message: "늦은 보고",
      }),
    "SESSION_CLOSED",
  );
  assert.equal(
    f.store.sessions.report(f.agent, {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "end-run",
      eventId: "end",
      kind: "end",
      message: "보고 종료",
    }).event.eventId,
    "end",
  );
});
void test("mixed ISO precision sorts by actual occurrence time and chooses the actual latest report state", (t) => {
  const f = fixture(t),
    base = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "precision",
      kind: "report",
      message: "시각",
    };
  const later = f.store.sessions.report(f.agent, {
    ...base,
    eventId: "later",
    state: "idle",
    occurredAt: "2026-10-28T09:59:00.100Z",
  });
  f.store.sessions.report(f.agent, {
    ...base,
    eventId: "earlier",
    state: "working",
    occurredAt: "2026-10-28T09:59:00Z",
  });
  const detail = f.store.sessions.get(owner, later.session.id);
  assert.deepEqual(
    detail.events.map((e) => e.eventId),
    ["earlier", "later"],
  );
  assert.equal(detail.events[0].occurredAt, "2026-10-28T09:59:00.000Z");
  assert.equal(detail.session.state, "idle");
});
void test("old-client done then working resumes the issue-scoped legacy record without deleting its end event", (t) => {
  const f = fixture(t),
    base = {
      projectId: f.project.id,
      issueId: f.issue.id,
      message: "예전 호출",
    };
  f.store.reportAgent(f.agent, { ...base, state: "done" });
  const ended = f.store.sessions.list(owner)[0];
  assert.ok(ended.endedAt);
  f.advance(1000);
  f.store.reportAgent(f.agent, { ...base, state: "working" });
  const current = f.store.sessions.get(owner, ended.id);
  assert.equal(current.session.endedAt, null);
  assert.equal(current.session.state, "working");
  assert.deepEqual(
    current.events.map((e) => e.kind),
    ["end", "report"],
  );
  assert.equal(f.store.sessions.list(owner).length, 1);
  assert.equal(f.store.bootstrap(owner).reports[0].state, "working");
});
void test("explicit legacy bridge event retries preserve newer snapshot and its original receipt time", (t) => {
  const f = fixture(t),
    base = {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: "bridge",
      message: "먼저",
    };
  f.store.reportAgent(f.agent, { ...base, eventId: "e1", state: "working" });
  f.advance(1000);
  f.store.reportAgent(f.agent, {
    ...base,
    eventId: "e2",
    state: "done",
    message: "나중",
  });
  const before = f.store.bootstrap(owner).reports[0];
  f.advance(1000);
  const retry = f.store.reportAgent(f.agent, {
    ...base,
    eventId: "e1",
    state: "working",
  });
  assert.deepEqual(f.store.bootstrap(owner).reports[0], before);
  assert.deepEqual(retry, before);
  assert.equal(
    f.store.sessions.get(owner, f.store.sessions.list(owner)[0].id).events
      .length,
    2,
  );
});
void test("result/error-only sessions do not invent working or idle self-reports", (t) => {
  const f = fixture(t);
  for (const kind of ["result", "error"] as const) {
    const event = f.store.sessions.report(f.agent, {
      projectId: f.project.id,
      issueId: f.issue.id,
      externalSessionId: `only-${kind}`,
      eventId: "only",
      kind,
      message: "상태를 보고하지 않은 기록",
    });
    assert.equal(event.session.state, "recorded");
    assert.equal(
      f.store.sessions.get(owner, event.session.id).events[0].kind,
      kind,
    );
  }
});
void test("legacy blocked reports remain truthful blockers and create no owner requests without explicit request events", (t) => {
  const f = fixture(t);
  f.store.reportAgent(f.agent, {
    projectId: f.project.id,
    issueId: f.issue.id,
    state: "blocked",
    message: "외부 의존성 때문에 막힘",
  });
  const session = f.store.sessions.list(owner)[0];
  assert.equal(session.state, "blocked");
  assert.equal(f.store.sessions.get(owner, session.id).requests.length, 0);
  assert.equal(f.store.sessions.inbox(owner).length, 0);
  f.store.sessions.report(f.agent, {
    projectId: f.project.id,
    issueId: f.issue.id,
    externalSessionId: "explicit-question",
    eventId: "q",
    kind: "request",
    requestKind: "input",
    message: "이 부분에 답해 주세요.",
  });
  assert.equal(f.store.sessions.inbox(owner).length, 1);
});
