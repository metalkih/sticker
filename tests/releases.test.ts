import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  const dir = mkdtempSync(join(tmpdir(), "sticker-releases-"));
  const store = new Store(
    dir,
    () => Date.parse("2026-10-28T12:00:00.000Z"),
    "https://sticker.example",
  );
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const project = store.createProject(owner, { key: "RE", name: "출시" });
  const version = store.createVersion(owner, {
    projectId: project.id,
    name: "v1",
  });
  const next = store.createVersion(owner, {
    projectId: project.id,
    name: "v2",
  });
  const agent: Actor = {
    id: "agent",
    name: "에이전트",
    role: "agent",
    canWrite: true,
    projectIds: [project.id],
  };
  return { store, dir, project, version, next, agent };
}
function denied(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
void test("readiness separates all three version roles and target buckets; done blockers remain unresolved and empty scope is zero", (t) => {
  const f = fixture(t);
  assert.ok("releases" in f.store);
  const a = f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "대상",
    targetVersionId: f.version.id,
  });
  f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "완료",
    status: "done",
    targetVersionId: f.version.id,
    foundVersionId: f.version.id,
  });
  f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "종결",
    status: "closed",
    targetVersionId: f.version.id,
    fixedVersionId: f.version.id,
  });
  const blocker = f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "차단",
    status: "done",
  });
  f.store.relations.add(owner, blocker.id, {
    kind: "blocks",
    targetIssueId: a.id,
    sourceRevision: 1,
    targetRevision: 1,
  });
  const read = f.store.releases.readiness(f.agent, f.version.id);
  assert.deepEqual(read.counts, {
    unfinished: 1,
    done: 1,
    closed: 1,
    blocked: 1,
    total: 3,
  });
  assert.equal(read.targetIssues.length, 3);
  assert.equal(read.foundIssues.length, 1);
  assert.equal(read.fixedIssues.length, 1);
  assert.equal(f.store.releases.readiness(owner, f.next.id).counts.total, 0);
  assert.equal(read.version.state, "planned");
});
void test("version CAS and every release transition require explicit owner confirmation and one immutable audit per operation", (t) => {
  const f = fixture(t);
  assert.ok("releases" in f.store);
  for (const actor of [owner, f.agent])
    denied(
      () =>
        f.store.createVersion(actor, {
          projectId: f.project.id,
          name: "bypass",
          state: "released",
        }),
      "RELEASE_CONFIRMATION_REQUIRED",
    );
  denied(
    () =>
      f.store.updateVersion(f.agent, f.version.id, {
        revision: 1,
        state: "released",
      }),
    "RELEASE_CONFIRMATION_REQUIRED",
  );
  const edited = f.store.updateVersion(f.agent, f.version.id, {
    revision: 1,
    name: "changed",
  });
  assert.equal(edited.revision, 2);
  denied(
    () =>
      f.store.updateVersion(owner, f.version.id, {
        revision: 1,
        name: "stale",
      }),
    "REVISION_CONFLICT",
  );
  const input = { revision: 2, operationId: randomUUID(), confirm: true };
  denied(
    () => f.store.releases.release(f.agent, f.version.id, input),
    "OWNER_REQUIRED",
  );
  const result = f.store.releases.release(owner, f.version.id, input);
  assert.equal(result.version.state, "released");
  assert.equal(result.version.revision, 3);
  assert.equal(result.audit.authorId, "owner");
  assert.deepEqual(
    f.store.releases.release(owner, f.version.id, input),
    result,
  );
  denied(
    () =>
      f.store.releases.release(owner, f.version.id, {
        ...input,
        state: "archived",
      }),
    "OPERATION_CONFLICT",
  );
  denied(
    () =>
      f.store.updateVersion(owner, f.version.id, {
        revision: 3,
        state: "planned",
      }),
    "RELEASE_CONFIRMATION_REQUIRED",
  );
  const reopened = f.store.releases.release(owner, f.version.id, {
    revision: 3,
    operationId: randomUUID(),
    confirm: true,
    state: "planned",
  });
  assert.equal(reopened.version.state, "planned");
  assert.equal(
    f.store.releases.readiness(owner, f.version.id).releaseHistory.length,
    2,
  );
});
void test("carryover validates every project before writes, previews without effects, preserves all fields and reports per-issue CAS conflicts", (t) => {
  const f = fixture(t);
  assert.ok("releases" in f.store);
  const a = f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "A",
    status: "waiting",
    targetVersionId: f.version.id,
    foundVersionId: f.version.id,
    fixedVersionId: f.version.id,
  });
  const b = f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "B",
    targetVersionId: f.version.id,
  });
  const input = {
    revision: 1,
    destinationVersionId: f.next.id,
    destinationRevision: 1,
    operationId: randomUUID(),
    issues: [
      { issueId: a.id, revision: 1 },
      { issueId: b.id, revision: 1 },
    ],
  };
  assert.equal(
    f.store.releases.previewCarryover(owner, f.version.id, input).items.length,
    2,
  );
  assert.equal(
    f.store.getIssue(owner, a.id).issue.targetVersionId,
    f.version.id,
  );
  f.store.updateIssue(owner, b.id, { revision: 1, title: "changed" });
  const result = f.store.releases.carryover(owner, f.version.id, input);
  assert.deepEqual(
    result.items.map((x) => x.outcome),
    ["moved", "conflict"],
  );
  const moved = f.store.getIssue(owner, a.id).issue;
  assert.equal(moved.targetVersionId, f.next.id);
  assert.equal(moved.foundVersionId, f.version.id);
  assert.equal(moved.fixedVersionId, f.version.id);
  assert.equal(moved.status, "waiting");
  assert.deepEqual(
    f.store.releases.carryover(owner, f.version.id, input),
    result,
  );
  const foreign = f.store.createProject(owner, { key: "ZZ", name: "foreign" });
  const v = f.store.createVersion(owner, {
    projectId: foreign.id,
    name: "foreign",
  });
  denied(
    () =>
      f.store.releases.carryover(owner, f.version.id, {
        ...input,
        operationId: randomUUID(),
        destinationVersionId: v.id,
      }),
    "PROJECT_MISMATCH",
  );
  assert.equal(
    f.store.getIssue(owner, b.id).issue.targetVersionId,
    f.version.id,
  );
});
void test("draft generation escapes Markdown injection and uses canonical authenticated issue links, save uses CAS and scope", (t) => {
  const f = fixture(t);
  assert.ok("releases" in f.store);
  const a = f.store.createIssue(owner, {
    projectId: f.project.id,
    title: "[x](javascript:alert(1)) <script> & **bad**",
    targetVersionId: f.version.id,
  });
  const draft = f.store.releases.generateChangelog(owner, f.version.id, {
    revision: 0,
    selectedIssueIds: [a.id],
  });
  assert.equal(draft.revision, 1);
  assert.ok(
    draft.markdown.includes(
      `https://sticker.example/#project=${f.project.id}&issue=${a.id}`,
    ),
  );
  assert.ok(!draft.markdown.includes("[x](javascript:"));
  assert.ok(!draft.markdown.includes("<script>"));
  const saved = f.store.releases.saveChangelog(owner, f.version.id, {
    revision: 1,
    selectedIssueIds: [a.id],
    markdown: "# 사용자 초안\n",
  });
  assert.equal(saved.revision, 2);
  denied(
    () =>
      f.store.releases.saveChangelog(owner, f.version.id, {
        revision: 1,
        selectedIssueIds: [a.id],
        markdown: "stale",
      }),
    "REVISION_CONFLICT",
  );
  denied(
    () =>
      f.store.releases.saveChangelog(
        { ...f.agent, canWrite: false },
        f.version.id,
        { revision: 2, selectedIssueIds: [a.id], markdown: "bad" },
      ),
    "READ_ONLY",
  );
  assert.equal(
    f.store.releases.changelog(f.agent, f.version.id).markdown,
    "# 사용자 초안\n",
  );
  const other = f.store.createProject(owner, { key: "XX", name: "secret" }),
    foreign = f.store.createVersion(owner, {
      projectId: other.id,
      name: "secret",
    });
  denied(
    () => f.store.releases.readiness(f.agent, foreign.id),
    "PROJECT_SCOPE",
  );
  const second = new Store(f.dir);
  try {
    assert.equal(second.releases.changelog(owner, f.version.id).revision, 2);
  } finally {
    second.close();
  }
});
void test("carryover preview never advertises a closed issue as writable for an agent and cross-project selections abort before any writes", (t) => {
  const f = fixture(t),
    closed = f.store.createIssue(owner, {
      projectId: f.project.id,
      title: "종결",
      status: "closed",
      targetVersionId: f.version.id,
    });
  const input = {
    revision: 1,
    destinationVersionId: f.next.id,
    destinationRevision: 1,
    operationId: randomUUID(),
    issues: [{ issueId: closed.id, revision: 1 }],
  };
  assert.equal(
    f.store.releases.previewCarryover(f.agent, f.version.id, input).items[0]
      .outcome,
    "denied",
  );
  const applied = f.store.releases.carryover(f.agent, f.version.id, input);
  assert.equal(applied.items[0].outcome, "failed");
  assert.equal(applied.items[0].code, "OWNER_REQUIRED");
  const good = f.store.createIssue(owner, {
      projectId: f.project.id,
      title: "보존",
      targetVersionId: f.version.id,
    }),
    p = f.store.createProject(owner, { key: "FG", name: "foreign" }),
    foreign = f.store.createIssue(owner, { projectId: p.id, title: "foreign" });
  denied(
    () =>
      f.store.releases.carryover(owner, f.version.id, {
        ...input,
        operationId: randomUUID(),
        issues: [
          { issueId: good.id, revision: 1 },
          { issueId: foreign.id, revision: 1 },
        ],
      }),
    "PROJECT_MISMATCH",
  );
  assert.equal(
    f.store.getIssue(owner, good.id).issue.targetVersionId,
    f.version.id,
  );
});
