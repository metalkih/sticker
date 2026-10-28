import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const dir = mkdtempSync(join(tmpdir(), "sticker-relations-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = store.createProject(owner, { key: "RL", name: "관계" });
  const issues = ["부모", "자식", "다음"].map((title) =>
    store.createIssue(owner, { projectId: project.id, title }),
  );
  const [a, b, c] = issues;
  const agent: Actor = {
    id: "agent",
    name: "agent",
    role: "agent",
    canWrite: true,
    projectIds: [project.id],
  };
  const revision = (id: string) => store.getIssue(owner, id).issue.revision;
  const add = (
    source: string,
    target: string,
    kind = "parent",
    actor = owner,
  ) =>
    store.relations.add(actor, source, {
      kind,
      targetIssueId: target,
      sourceRevision: revision(source),
      targetRevision: revision(target),
    });
  return { store, dir, project, a, b, c, agent, add, revision };
}
function denied(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
void test("relations service exists independently of agent sessions", (t) => {
  const f = fixture(t);
  assert.ok("relations" in f.store);
});
void test("parent edges preserve endpoint revisions and activity; self, cycles and second parent are rejected", (t) => {
  const f = fixture(t);
  const edge = f.add(f.a.id, f.b.id);
  assert.equal(f.revision(f.a.id), 2);
  assert.equal(f.revision(f.b.id), 2);
  assert.equal(
    f.store.relations.get(owner, f.a.id).children[0]?.issue.id,
    f.b.id,
  );
  assert.equal(f.store.relations.get(owner, f.b.id).parent?.issue.id, f.a.id);
  denied(() => f.add(f.a.id, f.a.id), "SELF_RELATION");
  f.add(f.b.id, f.c.id);
  denied(() => f.add(f.c.id, f.a.id), "RELATION_CYCLE");
  denied(() => f.add(f.c.id, f.b.id), "PARENT_EXISTS");
  assert.ok(
    f.store
      .getIssue(owner, f.a.id)
      .activity.some((a) => a.action === "relation_added"),
  );
  f.store.relations.remove(owner, edge.id, {
    sourceRevision: f.revision(f.a.id),
    targetRevision: f.revision(f.b.id),
  });
  assert.equal(f.store.relations.get(owner, f.b.id).parent, null);
});
void test("blocks resolve only at owner closure and never start or close another issue", (t) => {
  const f = fixture(t);
  f.add(f.a.id, f.b.id, "blocks");
  f.add(f.b.id, f.c.id, "blocks");
  denied(() => f.add(f.c.id, f.a.id, "blocks"), "RELATION_CYCLE");
  assert.equal(f.store.relations.get(owner, f.b.id).blocked, true);
  f.store.updateIssue(owner, f.a.id, {
    revision: f.revision(f.a.id),
    status: "done",
  });
  assert.equal(f.store.relations.get(owner, f.b.id).blocked, true);
  f.store.updateIssue(owner, f.a.id, {
    revision: f.revision(f.a.id),
    status: "closed",
  });
  assert.equal(f.store.relations.get(owner, f.b.id).blocked, false);
  assert.equal(f.store.getIssue(owner, f.b.id).issue.status, "backlog");
});
void test("related edges canonicalize duplicates, reject stale revisions and enforce both scopes and closed guard", (t) => {
  const f = fixture(t);
  f.add(f.a.id, f.b.id, "related");
  denied(() => f.add(f.b.id, f.a.id, "related"), "RELATION_EXISTS");
  denied(
    () =>
      f.store.relations.add(owner, f.a.id, {
        kind: "related",
        targetIssueId: f.c.id,
        sourceRevision: 1,
        targetRevision: 1,
      }),
    "REVISION_CONFLICT",
  );
  const other = f.store.createProject(owner, { key: "OT", name: "other" }),
    foreign = f.store.createIssue(owner, {
      projectId: other.id,
      title: "foreign",
    });
  denied(() => f.add(f.a.id, foreign.id, "related", f.agent), "PROJECT_SCOPE");
  denied(() => f.add(f.a.id, foreign.id, "related"), "PROJECT_MISMATCH");
  denied(
    () => f.add(f.a.id, f.c.id, "related", { ...f.agent, canWrite: false }),
    "READ_ONLY",
  );
  f.store.updateIssue(owner, f.c.id, { revision: 1, status: "closed" });
  denied(() => f.add(f.a.id, f.c.id, "related", f.agent), "OWNER_REQUIRED");
  assert.equal(f.store.relations.get(owner, f.a.id).related.length, 1);
});
void test("parent deletion preserves children; summaries distinguish done from closed without parent mutation", (t) => {
  const f = fixture(t);
  f.add(f.a.id, f.b.id);
  f.add(f.a.id, f.c.id);
  f.store.updateIssue(owner, f.b.id, {
    revision: f.revision(f.b.id),
    status: "done",
  });
  f.store.updateIssue(owner, f.c.id, {
    revision: f.revision(f.c.id),
    status: "closed",
  });
  const summary = f.store.relations.summaries(owner)[f.a.id];
  assert.ok(summary);
  assert.equal(summary.childCounts.done, 1);
  assert.equal(summary.childCounts.closed, 1);
  assert.equal(f.store.getIssue(owner, f.a.id).issue.status, "backlog");
  f.store.deleteIssue(owner, f.a.id);
  assert.equal(f.store.getIssue(owner, f.b.id).issue.title, "자식");
  assert.equal(f.store.relations.get(owner, f.b.id).parent, null);
});
void test("deleting an endpoint records the removed relation on surviving issue and persists through restart", (t) => {
  const f = fixture(t);
  f.add(f.a.id, f.b.id);
  const before = f.revision(f.b.id);
  f.store.deleteIssue(owner, f.a.id);
  const child = f.store.getIssue(owner, f.b.id);
  assert.equal(child.issue.revision, before + 1);
  assert.ok(child.activity.some((a) => a.action === "relation_target_deleted"));
  const reopened = new Store(f.dir);
  try {
    assert.equal(reopened.relations.get(owner, f.b.id).parent, null);
  } finally {
    reopened.close();
  }
});
void test("stale concurrent writer cannot add a relation and missing targets leave no revision change", (t) => {
  const f = fixture(t),
    other = new Store(f.dir);
  try {
    const old = f.revision(f.a.id);
    f.add(f.a.id, f.b.id, "related");
    denied(
      () =>
        other.relations.add(owner, f.a.id, {
          kind: "blocks",
          targetIssueId: f.c.id,
          sourceRevision: old,
          targetRevision: 1,
        }),
      "REVISION_CONFLICT",
    );
    const before = f.revision(f.a.id);
    f.store.deleteIssue(owner, f.c.id);
    denied(
      () =>
        f.store.relations.add(owner, f.a.id, {
          kind: "blocks",
          targetIssueId: f.c.id,
          sourceRevision: before,
          targetRevision: 1,
        }),
      "NOT_FOUND",
    );
    assert.equal(f.revision(f.a.id), before);
    assert.equal(f.store.relations.get(owner, f.a.id).related.length, 1);
  } finally {
    other.close();
  }
});
