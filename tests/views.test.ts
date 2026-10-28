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
  const dir = mkdtempSync(join(tmpdir(), "sticker-views-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = store.createProject(owner, { key: "VW", name: "뷰" }),
    other = store.createProject(owner, { key: "VO", name: "다른" });
  const agent: Actor = {
    id: "agent",
    name: "코딩",
    role: "agent",
    canWrite: true,
    projectIds: [p.id],
  };
  return {
    get store() {
      return store;
    },
    p,
    other,
    agent,
    reopen() {
      store.close();
      store = new Store(dir);
    },
  };
}
function denied(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
void test("views are actor-private stored predicates, retain mode/sort and include future matching issues", (t) => {
  const f = fixture(t);
  assert.ok("views" in f.store);
  const a = f.store.createIssue(owner, {
    projectId: f.p.id,
    title: "검토",
    status: "done",
  });
  const v = f.store.views.create(owner, {
    name: "검토 대기",
    query: {
      projectId: f.p.id,
      status: ["done"],
      sort: "key_asc",
      mode: "list",
    },
  });
  assert.equal(f.store.views.query(owner, v.query).issues[0]?.id, a.id);
  f.store.createIssue(owner, {
    projectId: f.p.id,
    title: "새 검토",
    status: "done",
  });
  assert.equal(f.store.views.query(owner, v.query).issues.length, 2);
  assert.equal(f.store.views.list(f.agent).length, 0);
  denied(() => f.store.views.get(f.agent, v.id), "NOT_FOUND");
  f.reopen();
  assert.equal(f.store.views.get(owner, v.id).query.mode, "list");
  assert.equal(f.store.views.query(owner, v.query).issues.length, 2);
});
void test("views use CAS, unique per-actor/project names, safe copy and explicit deletion", (t) => {
  const f = fixture(t);
  const v = f.store.views.create(owner, {
    name: "뷰",
    query: { projectId: f.p.id },
  });
  denied(
    () =>
      f.store.views.create(owner, { name: "뷰", query: { projectId: f.p.id } }),
    "VIEW_NAME_EXISTS",
  );
  const copy = f.store.views.create(owner, { name: "복제", query: v.query });
  assert.notEqual(copy.id, v.id);
  const updated = f.store.views.update(owner, v.id, {
    revision: 1,
    name: "변경",
    query: { projectId: f.p.id, priority: ["high"] },
  });
  assert.equal(updated.revision, 2);
  denied(
    () =>
      f.store.views.update(owner, v.id, {
        revision: 1,
        name: "덮기",
        query: v.query,
      }),
    "REVISION_CONFLICT",
  );
  denied(() => {
    f.store.views.remove(owner, v.id, { revision: 1 });
  }, "REVISION_CONFLICT");
  f.store.views.remove(owner, v.id, { revision: 2 });
  denied(() => f.store.views.get(owner, v.id), "NOT_FOUND");
  assert.equal(f.store.views.get(owner, copy.id).name, "복제");
});
void test("saved version filters diagnose deleted references and never broaden to another scope", (t) => {
  const f = fixture(t);
  const version = f.store.createVersion(owner, {
    projectId: f.p.id,
    name: "1",
  });
  const foreign = f.store.createVersion(owner, {
    projectId: f.other.id,
    name: "2",
  });
  const v = f.store.views.create(owner, {
    name: "버전",
    query: { projectId: f.p.id, targetVersionId: version.id },
  });
  f.store.createIssue(owner, {
    projectId: f.p.id,
    title: "대상",
    targetVersionId: version.id,
  });
  f.store.createIssue(owner, { projectId: f.other.id, title: "비공개" });
  denied(
    () =>
      f.store.views.create(f.agent, {
        name: "외부",
        query: { projectId: f.other.id },
      }),
    "PROJECT_SCOPE",
  );
  denied(
    () =>
      f.store.views.create(owner, {
        name: "잘못된 버전",
        query: { projectId: f.p.id, foundVersionId: foreign.id },
      }),
    "INVALID_REFERENCE",
  );
  f.store.deleteVersion(owner, version.id);
  const result = f.store.views.query(
    owner,
    f.store.views.get(owner, v.id).query,
  );
  assert.equal(result.issues.length, 0);
  assert.equal(result.warnings[0]?.code, "VERSION_MISSING");
  assert.equal(
    f.store.views.get(owner, v.id).query.targetVersionId,
    version.id,
  );
});
void test("favorite ordering and project default persist privately with atomic preference revisions", (t) => {
  const f = fixture(t);
  const a = f.store.views.create(owner, {
      name: "A",
      query: { projectId: f.p.id },
    }),
    b = f.store.views.create(owner, {
      name: "B",
      query: { projectId: f.p.id },
    });
  const pref = f.store.views.preferences(owner, f.p.id);
  assert.equal(pref.revision, 0);
  const next = f.store.views.setPreferences(owner, f.p.id, {
    revision: 0,
    defaultViewId: b.id,
    favoriteIds: [b.id, a.id],
  });
  assert.equal(next.revision, 1);
  denied(
    () =>
      f.store.views.setPreferences(owner, f.p.id, {
        revision: 0,
        defaultViewId: null,
        favoriteIds: [],
      }),
    "REVISION_CONFLICT",
  );
  denied(
    () =>
      f.store.views.setPreferences(f.agent, f.p.id, {
        revision: 0,
        defaultViewId: a.id,
        favoriteIds: [],
      }),
    "NOT_FOUND",
  );
  f.reopen();
  assert.deepEqual(f.store.views.preferences(owner, f.p.id).favoriteIds, [
    b.id,
    a.id,
  ]);
  f.store.views.remove(owner, b.id, { revision: 1 });
  assert.equal(f.store.views.preferences(owner, f.p.id).defaultViewId, null);
  assert.deepEqual(f.store.views.preferences(owner, f.p.id).favoriteIds, [
    a.id,
  ]);
});
void test("one bounded query grammar covers every version role, labels, priority, assignee, blocker and exact pending input", (t) => {
  const f = fixture(t);
  const v = f.store.createVersion(owner, { projectId: f.p.id, name: "v" }),
    otherV = f.store.createVersion(owner, { projectId: f.p.id, name: "other" });
  const a = f.store.createIssue(owner, {
      projectId: f.p.id,
      title: "검색 대상",
      status: "done",
      priority: "high",
      assignee: "agent",
      labels: ["bug", "swift"],
      targetVersionId: v.id,
      foundVersionId: v.id,
      fixedVersionId: v.id,
    }),
    blocker = f.store.createIssue(owner, { projectId: f.p.id, title: "선행" });
  f.store.relations.add(owner, blocker.id, {
    kind: "blocks",
    targetIssueId: a.id,
    sourceRevision: 1,
    targetRevision: 1,
  });
  f.store.sessions.report(f.agent, {
    projectId: f.p.id,
    issueId: a.id,
    externalSessionId: "run",
    eventId: "input",
    kind: "request",
    requestKind: "input",
    message: "선택",
  });
  const query = {
    projectId: f.p.id,
    query: "검색",
    status: ["done"],
    priority: ["high"],
    assignee: "agent",
    labels: ["bug", "swift"],
    targetVersionId: v.id,
    foundVersionId: v.id,
    fixedVersionId: v.id,
    blocked: true,
    inputRequested: true,
    sort: "key_asc",
  };
  assert.deepEqual(
    f.store.views.query(owner, query).issues.map((i) => i.id),
    [a.id],
  );
  assert.deepEqual(
    f.store.views.query(f.agent, query).issues.map((i) => i.id),
    [a.id],
  );
  assert.deepEqual(
    f.store.views.query({ ...f.agent, id: "another-agent" }, query).issues,
    [],
  );
  for (const field of ["targetVersionId", "foundVersionId", "fixedVersionId"])
    assert.equal(
      f.store.views.query(owner, { ...query, [field]: otherV.id }).issues
        .length,
      0,
    );
  assert.equal(
    f.store.views.query(owner, { ...query, labels: ["missing"] }).issues.length,
    0,
  );
  assert.equal(
    f.store.views.query(owner, { ...query, inputRequested: false }).issues
      .length,
    0,
  );
  denied(
    () => f.store.views.query(owner, { ...query, sql: "SELECT *" }),
    "INVALID_INPUT",
  );
  denied(
    () =>
      f.store.views.create(
        { ...f.agent, canWrite: false },
        { name: "readonly", query: { projectId: f.p.id } },
      ),
    "READ_ONLY",
  );
});
void test("stable sorting breaks timestamp/priority ties by numeric key and respects null version filters", (t) => {
  const f = fixture(t);
  const issues = Array.from({ length: 11 }, (_, i) =>
    f.store.createIssue(owner, {
      projectId: f.p.id,
      title: `작업 ${String(i)}`,
      priority: "high",
    }),
  );
  const result = f.store.views.query(owner, {
    projectId: f.p.id,
    sort: "key_asc",
    targetVersionId: null,
  });
  assert.deepEqual(
    result.issues.map((i) => i.id),
    issues.map((i) => i.id),
  );
  denied(
    () => f.store.views.query(f.agent, { projectId: f.other.id }),
    "PROJECT_SCOPE",
  );
});
void test("shared text search preserves description and label matches", (t) => {
  const f = fixture(t);
  const a = f.store.createIssue(owner, {
    projectId: f.p.id,
    title: "제목",
    description: "본문 needle",
    labels: ["swift"],
  });
  for (const query of ["needle", "SWIFT"])
    assert.deepEqual(
      f.store.views
        .query(owner, { projectId: f.p.id, query })
        .issues.map((i) => i.id),
      [a.id],
    );
});
