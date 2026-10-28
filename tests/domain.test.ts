import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, DomainError } from "../server/domain.js";
import type { Actor } from "../server/types.js";

const owner: Actor = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "sticker-domain-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(dir);
      return store;
    },
  };
}
function project(s: Store, key = "STK") {
  return s.createProject(owner, { key, name: "스티커", color: "#d6ed61" });
}
function denies(fn: () => unknown, status: number) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.status === status,
  );
}

test("projects and versions persist and validate duplicate keys, date and ownership", (t) => {
  const f = fixture(t);
  const p = project(f.store);
  assert.equal(p.key, "STK");
  denies(() => project(f.store), 409);
  denies(
    () => f.store.createProject(owner, { key: "bad key", name: "x" }),
    400,
  );
  const v = f.store.createVersion(owner, {
    projectId: p.id,
    name: "v1",
    dueDate: "2026-12-01",
  });
  assert.equal(v.state, "planned");
  denies(
    () =>
      f.store.createVersion(owner, {
        projectId: p.id,
        name: "bad",
        dueDate: "2026-02-31",
      }),
    400,
  );
  const reopened = f.reopen();
  assert.equal(reopened.bootstrap(owner).versions[0].id, v.id);
  assert.equal(
    reopened.updateVersion(owner, v.id, { state: "released" }).state,
    "released",
  );
  denies(
    () => reopened.updateVersion(owner, v.id, { projectId: "different" }),
    400,
  );
  denies(() => reopened.deleteProject(owner, p.id), 409);
  reopened.deleteVersion(owner, v.id);
  reopened.deleteProject(owner, p.id);
  assert.equal(reopened.bootstrap(owner).projects.length, 0);
});

test("issues have monotonic sequence keys, persist and record immutable actor activity", (t) => {
  const f = fixture(t),
    p = project(f.store);
  const i = f.store.createIssue(owner, {
    projectId: p.id,
    title: "첫 이슈",
    labels: ["버그"],
  });
  assert.equal(i.key, "STK-1");
  assert.equal(i.revision, 1);
  assert.equal(i.status, "backlog");
  denies(
    () =>
      f.store.createIssue(owner, {
        projectId: p.id,
        title: "",
        authorName: "fake",
      }),
    400,
  );
  const updated = f.store.updateIssue(owner, i.id, {
    title: "바뀐 제목",
    revision: 1,
  });
  assert.equal(updated.revision, 2);
  const d = f.reopen().getIssue(owner, i.id);
  assert.equal(d.issue.title, "바뀐 제목");
  assert.equal(d.activity.length, 2);
  assert.equal(d.activity[0].authorId, "owner");
  f.store.deleteIssue(owner, i.id);
  const next = f.store.createIssue(owner, { projectId: p.id, title: "다음" });
  assert.equal(next.key, "STK-2");
});

test("optimistic revisions prevent two writers from silently overwriting assignment", (t) => {
  const f = fixture(t),
    p = project(f.store),
    i = f.store.createIssue(owner, { projectId: p.id, title: "claim me" });
  const second = new Store(f.dir);
  try {
    const old = second.getIssue(owner, i.id).issue;
    f.store.updateIssue(owner, i.id, {
      revision: i.revision,
      assignee: "agent-a",
      status: "in_progress",
    });
    denies(
      () =>
        second.updateIssue(owner, i.id, {
          revision: old.revision,
          assignee: "agent-b",
        }),
      409,
    );
    assert.equal(second.getIssue(owner, i.id).issue.assignee, "agent-a");
    assert.equal(second.getIssue(owner, i.id).activity.length, 2);
    denies(
      () => f.store.updateIssue(owner, i.id, { title: "no revision" }),
      422,
    );
  } finally {
    second.close();
  }
});

test("project scopes prevent all cross-project reads and mutation; readonly cannot write", (t) => {
  const f = fixture(t),
    a = project(f.store, "AAA"),
    b = project(f.store, "BBB");
  const ia = f.store.createIssue(owner, { projectId: a.id, title: "A" }),
    ib = f.store.createIssue(owner, { projectId: b.id, title: "B" });
  const scoped: Actor = {
    id: "coder",
    name: "코더",
    role: "agent",
    canWrite: true,
    projectIds: [a.id],
  };
  assert.equal(f.store.bootstrap(scoped).issues.length, 1);
  denies(() => f.store.getIssue(scoped, ib.id), 403);
  denies(
    () => f.store.updateIssue(scoped, ib.id, { revision: 1, title: "attack" }),
    403,
  );
  denies(
    () => f.store.createIssue(scoped, { projectId: b.id, title: "attack" }),
    403,
  );
  denies(() => f.store.deleteProject(scoped, a.id), 403);
  denies(() => f.store.deleteIssue(scoped, ia.id), 403);
  denies(() => f.store.createProject(scoped, { key: "NEW", name: "new" }), 403);
  denies(
    () =>
      f.store.updateProject({ ...scoped, canWrite: false }, a.id, {
        name: "attack",
      }),
    403,
  );
  denies(
    () =>
      f.store.addComment({ ...scoped, canWrite: false }, ia.id, {
        body: "attack",
      }),
    403,
  );
  assert.equal(
    f.store.updateIssue(scoped, ia.id, { revision: 1, status: "waiting" })
      .status,
    "waiting",
  );
});

test("done is not closed and only the owner can close or reopen", (t) => {
  const f = fixture(t),
    p = project(f.store),
    agent: Actor = {
      id: "agent",
      name: "에이전트",
      role: "agent",
      canWrite: true,
      projectIds: [p.id],
    };
  const i = f.store.createIssue(agent, {
    projectId: p.id,
    title: "work",
    status: "done",
  });
  assert.equal(i.status, "done");
  denies(
    () => f.store.updateIssue(agent, i.id, { revision: 1, status: "closed" }),
    403,
  );
  const closed = f.store.updateIssue(owner, i.id, {
    revision: 1,
    status: "closed",
  });
  denies(
    () =>
      f.store.updateIssue(agent, i.id, {
        revision: closed.revision,
        status: "ready",
      }),
    403,
  );
  denies(
    () =>
      f.store.createIssue(agent, {
        projectId: p.id,
        title: "shortcut",
        status: "closed",
      }),
    403,
  );
  const reopened = f.store.updateIssue(owner, i.id, {
    revision: closed.revision,
    status: "ready",
  });
  assert.equal(reopened.status, "ready");
});

test("target, found and fixed versions must belong to the same project and deletion clears references", (t) => {
  const f = fixture(t),
    p = project(f.store, "ONE"),
    other = project(f.store, "TWO");
  const v = f.store.createVersion(owner, { projectId: p.id, name: "v1" }),
    wrong = f.store.createVersion(owner, {
      projectId: other.id,
      name: "wrong",
    });
  for (const key of ["targetVersionId", "foundVersionId", "fixedVersionId"])
    denies(
      () =>
        f.store.createIssue(owner, {
          projectId: p.id,
          title: "x",
          [key]: wrong.id,
        }),
      400,
    );
  const i = f.store.createIssue(owner, {
    projectId: p.id,
    title: "versioned",
    targetVersionId: v.id,
    foundVersionId: v.id,
    fixedVersionId: v.id,
  });
  denies(
    () =>
      f.store.updateIssue(owner, i.id, {
        revision: 1,
        targetVersionId: wrong.id,
      }),
    400,
  );
  f.store.deleteVersion(owner, v.id);
  const after = f.store.getIssue(owner, i.id);
  assert.equal(after.issue.targetVersionId, null);
  assert.equal(after.issue.foundVersionId, null);
  assert.equal(after.issue.fixedVersionId, null);
  assert.equal(after.issue.revision, 2);
  assert.ok(after.activity.some((a) => a.action === "version_removed"));
});

test("comments and attachments enforce attribution, input bounds, scope and author deletion", (t) => {
  const f = fixture(t),
    p = project(f.store),
    i = f.store.createIssue(owner, { projectId: p.id, title: "resources" });
  const agent: Actor = {
      id: "agent",
      name: "코더",
      role: "agent",
      canWrite: true,
      projectIds: [p.id],
    },
    other = { ...agent, id: "other" };
  const c = f.store.addComment(agent, i.id, { body: "검토 요청" });
  assert.equal(c.authorId, "agent");
  denies(
    () => f.store.addComment(agent, i.id, { body: "fake", authorId: "owner" }),
    400,
  );
  denies(() => f.store.deleteComment(other, c.id), 403);
  const link = f.store.addAttachment(agent, i.id, {
    kind: "link",
    name: "문서",
    url: "https://example.com/doc",
  });
  assert.equal(link.authorName, "코더");
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,x",
  ])
    denies(
      () =>
        f.store.addAttachment(agent, i.id, { kind: "link", name: "bad", url }),
      400,
    );
  denies(
    () =>
      f.store.addAttachment(agent, i.id, {
        kind: "file",
        name: "bad",
        storageKey: "../../passwd",
        mimeType: "text/plain",
        size: 1,
      }),
    400,
  );
  denies(
    () =>
      f.store.addAttachment(agent, i.id, {
        kind: "file",
        name: "large",
        storageKey: "2cf181da-95cb-420c-a3d6-4d68d7b72f69",
        mimeType: "text/plain",
        size: 20 * 1024 * 1024 + 1,
      }),
    400,
  );
  const file = f.store.addAttachment(owner, i.id, {
    kind: "file",
    name: "notes.txt",
    storageKey: "2cf181da-95cb-420c-a3d6-4d68d7b72f69",
    mimeType: "text/plain",
    size: 5,
  });
  assert.equal(f.store.getAttachment(agent, file.id).size, 5);
  denies(
    () => f.store.getAttachment({ ...agent, projectIds: [] }, file.id),
    403,
  );
  assert.equal(f.store.deleteAttachment(owner, file.id).id, file.id);
  denies(() => f.store.getAttachment(owner, file.id), 404);
  f.store.deleteComment(agent, c.id);
  assert.equal(f.store.getIssue(owner, i.id).comments.length, 0);
});

test("agent reports are authenticated self-reports, stale after five minutes and project-related", (t) => {
  const f = fixture(t),
    p = project(f.store, "ONE"),
    p2 = project(f.store, "TWO");
  const i = f.store.createIssue(owner, { projectId: p.id, title: "work" }),
    other = f.store.createIssue(owner, { projectId: p2.id, title: "other" });
  const agent: Actor = {
    id: "agent",
    name: "코더",
    role: "agent",
    canWrite: true,
    projectIds: [p.id],
  };
  denies(
    () =>
      f.store.reportAgent(owner, {
        projectId: p.id,
        state: "working",
        message: "fake",
      }),
    403,
  );
  denies(
    () =>
      f.store.reportAgent(agent, {
        projectId: p.id,
        issueId: other.id,
        state: "working",
        message: "wrong",
      }),
    400,
  );
  const r = f.store.reportAgent(agent, {
    projectId: p.id,
    issueId: i.id,
    state: "working",
    message: "마지막 보고",
  });
  assert.equal(r.agentId, "agent");
  assert.equal(r.stale, false);
  denies(
    () =>
      f.store.reportAgent(agent, {
        projectId: p.id,
        state: "working",
        message: "fake",
        reportedAt: "2099-01-01",
      }),
    400,
  );
  const sql = new DatabaseSync(join(f.dir, "sticker.sqlite"));
  try {
    sql
      .prepare("UPDATE agent_reports SET reportedAt = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", r.id);
  } finally {
    sql.close();
  }
  assert.equal(f.store.bootstrap(owner).reports[0].stale, true);
  const fresh = f.store.reportAgent(agent, {
    projectId: p.id,
    state: "blocked",
    message: "승인 대기",
  });
  assert.equal(fresh.state, "blocked");
  assert.equal(f.store.bootstrap(owner).reports.length, 1);
  assert.equal(
    f.store.bootstrap({ ...agent, projectIds: [] }).reports.length,
    0,
  );
});

test("project key cannot be repurposed after issue keys have been allocated", (t) => {
  const f = fixture(t),
    p = project(f.store);
  const i = f.store.createIssue(owner, {
    projectId: p.id,
    title: "stable issue identifier",
  });
  denies(() => f.store.updateProject(owner, p.id, { key: "NEW" }), 409);
  assert.equal(f.store.getIssue(owner, i.id).issue.key, "STK-1");
  assert.equal(f.store.bootstrap(owner).projects[0].key, "STK");
});

test("deleting a linked version cannot let agents mutate an owner-closed issue indirectly", (t) => {
  const f = fixture(t),
    p = project(f.store),
    v = f.store.createVersion(owner, { projectId: p.id, name: "v1" });
  const i = f.store.createIssue(owner, {
    projectId: p.id,
    title: "closed",
    status: "closed",
    targetVersionId: v.id,
  });
  const agent: Actor = {
    id: "agent",
    name: "코더",
    role: "agent",
    canWrite: true,
    projectIds: [p.id],
  };
  denies(() => f.store.deleteVersion(agent, v.id), 403);
  assert.equal(f.store.getIssue(owner, i.id).issue.targetVersionId, v.id);
  assert.equal(f.store.bootstrap(owner).versions.length, 1);
});

test("repeated valid issue revisions advance once each and stale retries do not add activity", (t) => {
  const f = fixture(t),
    p = project(f.store),
    i = f.store.createIssue(owner, { projectId: p.id, title: "retry" });
  const a = f.store.updateIssue(owner, i.id, { revision: 1, status: "ready" });
  const b = f.store.updateIssue(owner, i.id, {
    revision: a.revision,
    status: "waiting",
  });
  assert.equal(b.revision, 3);
  denies(
    () =>
      f.store.updateIssue(owner, i.id, {
        revision: a.revision,
        status: "in_progress",
      }),
    409,
  );
  assert.equal(f.store.getIssue(owner, i.id).activity.length, 3);
  assert.equal(f.store.getIssue(owner, i.id).issue.status, "waiting");
});
