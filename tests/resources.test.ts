import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, DomainError } from "../server/domain.js";
import { StoreContext } from "../server/store-context.js";
import { ResourceService } from "../server/features/resources.js";
import { FileStorage } from "../server/file-storage.js";
import type { Actor } from "../server/types.js";
const owner: Actor = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "sticker-resources-")),
    store = new Store(dir),
    ctx = new StoreContext(dir),
    files = new FileStorage(dir);
  const resources = new ResourceService(ctx);
  t.after(() => {
    ctx.db.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const p = store.createProject(owner, { key: "RR", name: "자료" }),
    foreign = store.createProject(owner, { key: "FF", name: "비공개" }),
    agent: Actor = {
      id: "agent",
      name: "개발",
      role: "agent",
      canWrite: true,
      projectIds: [p.id],
    };
  const create = (title = "설계") =>
    resources.create(owner, {
      projectId: p.id,
      title,
      kind: "markdown",
      markdown: "# 비공개 설계",
      operationId: randomUUID(),
    });
  return { dir, store, ctx, resources, files, p, foreign, agent, create };
}
function denied(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof DomainError && error.code === code,
  );
}
void test("resources have immutable versions with scoped search/history and owner-only guidance that cannot be overwritten by agents", (t) => {
  const f = fixture(t),
    first = f.create();
  assert.equal(first.resource.currentVersion, 1);
  assert.equal(first.current?.kind, "markdown");
  const updated = f.resources.update(f.agent, first.resource.id, {
    revision: 1,
    operationId: randomUUID(),
    markdown: "# 새 설계",
  });
  assert.equal(updated.resource.revision, 2);
  assert.equal(updated.resource.currentVersion, 2);
  assert.equal(
    f.resources.version(f.agent, first.resource.id, 1).kind,
    "markdown",
  );
  assert.equal(first.current.markdown, "# 비공개 설계");
  denied(
    () =>
      f.resources.update(owner, first.resource.id, {
        revision: 1,
        operationId: randomUUID(),
        title: "stale",
      }),
    "REVISION_CONFLICT",
  );
  denied(
    () =>
      f.resources.guidance(f.agent, first.resource.id, {
        revision: 2,
        operationId: randomUUID(),
        isGuidance: true,
      }),
    "OWNER_REQUIRED",
  );
  const designated = f.resources.guidance(owner, first.resource.id, {
    revision: 2,
    operationId: randomUUID(),
    isGuidance: true,
  });
  assert.equal(designated.resource.isGuidance, true);
  assert.equal(f.resources.projectGuidance(f.agent, f.p.id).length, 1);
  denied(
    () =>
      f.resources.update(f.agent, first.resource.id, {
        revision: 3,
        operationId: randomUUID(),
        markdown: "unapproved",
      }),
    "OWNER_REQUIRED",
  );
  denied(
    () =>
      f.resources.remove(f.agent, first.resource.id, {
        revision: 3,
        operationId: randomUUID(),
      }),
    "OWNER_REQUIRED",
  );
  const privateResource = f.resources.create(owner, {
    projectId: f.foreign.id,
    title: "secret",
    kind: "link",
    url: "https://example.invalid/",
    operationId: randomUUID(),
  });
  assert.equal(f.resources.list(f.agent, { query: "secret" }).length, 0);
  denied(
    () => f.resources.get(f.agent, privateResource.resource.id),
    "PROJECT_SCOPE",
  );
  denied(
    () => f.resources.list(f.agent, { projectId: f.foreign.id }),
    "PROJECT_SCOPE",
  );
});
void test("resource links pin versions across two issues; unlink never deletes another reference or source file", (t) => {
  const f = fixture(t),
    stored = f.files.write(Buffer.from("original bytes"), "shared.bin"),
    resource = f.resources.createFile(
      owner,
      { projectId: f.p.id, title: "파일", operationId: randomUUID() },
      stored,
    ),
    a = f.store.createIssue(owner, { projectId: f.p.id, title: "A" }),
    b = f.store.createIssue(owner, { projectId: f.p.id, title: "B" });
  const input = {
    resourceId: resource.resource.id,
    resourceVersion: 1,
    issueRevision: 1,
    operationId: randomUUID(),
  };
  const link = f.resources.link(f.agent, a.id, input);
  assert.deepEqual(f.resources.link(f.agent, a.id, input), link);
  f.resources.link(f.agent, b.id, { ...input, operationId: randomUUID() });
  assert.equal(
    f.resources.get(owner, resource.resource.id).usage.issues.length,
    2,
  );
  f.resources.unlink(f.agent, a.id, link.id, {
    issueRevision: 2,
    operationId: randomUUID(),
  });
  assert.equal(f.resources.issueLinks(f.agent, a.id).length, 0);
  assert.equal(f.resources.issueLinks(f.agent, b.id).length, 1);
  assert.equal(
    readFileSync(f.files.filePath(stored.storageKey), "utf8"),
    "original bytes",
  );
  const second = f.files.write(Buffer.from("new bytes"), "shared-v2.bin");
  f.resources.updateFile(
    owner,
    resource.resource.id,
    { revision: 1, operationId: randomUUID(), title: "새 파일" },
    second,
  );
  assert.equal(f.resources.issueLinks(owner, b.id)[0].version.version, 1);
  assert.equal(
    f.resources.fileRecord(f.agent, resource.resource.id, 1).storageKey,
    stored.storageKey,
  );
  assert.equal(
    f.resources.fileRecord(f.agent, resource.resource.id, 2).storageKey,
    second.storageKey,
  );
});
void test("all source/destination scope and closed-issue guards run before linking or file metadata disclosure", (t) => {
  const f = fixture(t),
    resource = f.create(),
    foreignIssue = f.store.createIssue(owner, {
      projectId: f.foreign.id,
      title: "private",
    }),
    closed = f.store.createIssue(owner, {
      projectId: f.p.id,
      title: "closed",
      status: "closed",
    });
  const input = {
    resourceId: resource.resource.id,
    resourceVersion: 1,
    issueRevision: 1,
    operationId: randomUUID(),
  };
  denied(
    () => f.resources.link(f.agent, foreignIssue.id, input),
    "PROJECT_SCOPE",
  );
  denied(
    () => f.resources.link(owner, foreignIssue.id, input),
    "PROJECT_MISMATCH",
  );
  denied(() => f.resources.link(f.agent, closed.id, input), "OWNER_REQUIRED");
  assert.equal(
    f.resources.get(owner, resource.resource.id).usage.issues.length,
    0,
  );
  const version = f.store.createVersion(owner, {
    projectId: f.foreign.id,
    name: "private",
  });
  denied(
    () =>
      f.resources.create(f.agent, {
        projectId: f.p.id,
        versionId: version.id,
        title: "wrong",
        kind: "markdown",
        markdown: "",
        operationId: randomUUID(),
      }),
    "PROJECT_SCOPE",
  );
});
void test("tombstones retain history and exact existing references without silently choosing a new version", (t) => {
  const f = fixture(t),
    resource = f.create(),
    issue = f.store.createIssue(owner, { projectId: f.p.id, title: "proof" });
  f.resources.link(owner, issue.id, {
    resourceId: resource.resource.id,
    resourceVersion: 1,
    issueRevision: 1,
    operationId: randomUUID(),
  });
  const removed = f.resources.remove(owner, resource.resource.id, {
    revision: 1,
    operationId: randomUUID(),
  });
  assert.ok(removed.resource.deletedAt);
  assert.equal(removed.current, null);
  assert.equal(f.resources.list(owner, { projectId: f.p.id }).length, 0);
  assert.equal(f.resources.issueLinks(owner, issue.id)[0].version.version, 1);
  assert.equal(
    f.resources.version(owner, resource.resource.id, 1).kind,
    "markdown",
  );
  denied(
    () =>
      f.resources.update(owner, resource.resource.id, {
        revision: 2,
        operationId: randomUUID(),
        title: "revive",
      }),
    "RESOURCE_DELETED",
  );
});
void test("agent result references require own authorized result event and exact resource version, with stable retry provenance", (t) => {
  const f = fixture(t),
    resource = f.create(),
    issue = f.store.createIssue(owner, { projectId: f.p.id, title: "result" });
  const report = f.store.sessions.report(f.agent, {
    projectId: f.p.id,
    issueId: issue.id,
    externalSessionId: "run",
    eventId: "result",
    kind: "result",
    message: "검증 결과",
  });
  const input = {
    sessionId: report.session.id,
    eventId: "result",
    resourceId: resource.resource.id,
    resourceVersion: 1,
    operationId: randomUUID(),
  };
  const ref = f.resources.recordReference(f.agent, input);
  assert.equal(ref.recordedBy, f.agent.id);
  assert.equal(ref.version.version, 1);
  assert.deepEqual(f.resources.recordReference(f.agent, input), ref);
  denied(
    () =>
      f.resources.recordReference(
        { ...f.agent, id: "other" },
        { ...input, operationId: randomUUID() },
      ),
    "SESSION_OWNER_REQUIRED",
  );
  denied(
    () =>
      f.resources.recordReference(f.agent, {
        ...input,
        eventId: "missing",
        operationId: randomUUID(),
      }),
    "RESULT_EVENT_REQUIRED",
  );
  f.resources.update(owner, resource.resource.id, {
    revision: 1,
    operationId: randomUUID(),
    markdown: "new",
  });
  assert.equal(
    f.resources.sessionReferences(owner, report.session.id)[0].version.version,
    1,
  );
});
void test("resource operation receipts survive reopen, reject changed retries, and reauthorize current scope before replay or version disclosure", (t) => {
  const f = fixture(t),
    input = {
      projectId: f.p.id,
      title: "receipt",
      kind: "markdown",
      markdown: "original",
      operationId: randomUUID(),
    },
    created = f.resources.create(f.agent, input);
  const update = {
      revision: 1,
      operationId: randomUUID(),
      markdown: "confirmed",
    },
    saved = f.resources.update(f.agent, created.resource.id, update);
  assert.deepEqual(
    f.resources.update(f.agent, created.resource.id, update),
    saved,
  );
  denied(
    () =>
      f.resources.update(f.agent, created.resource.id, {
        ...update,
        markdown: "changed",
      }),
    "OPERATION_CONFLICT",
  );
  const otherContext = new StoreContext(f.dir);
  try {
    const reopened = new ResourceService(otherContext);
    assert.deepEqual(reopened.create(f.agent, input), created);
    assert.deepEqual(
      reopened.update(f.agent, created.resource.id, update),
      saved,
    );
    const revoked = { ...f.agent, projectIds: [f.foreign.id] };
    denied(() => reopened.create(revoked, input), "PROJECT_SCOPE");
    denied(
      () => reopened.version(revoked, created.resource.id, 1),
      "PROJECT_SCOPE",
    );
    denied(
      () => reopened.update(revoked, created.resource.id, update),
      "PROJECT_SCOPE",
    );
    assert.equal(reopened.list(revoked).length, 0);
  } finally {
    otherContext.db.close();
  }
  assert.equal(f.resources.get(owner, created.resource.id).history.length, 2);
});
void test("resource audit, versions and receipts roll back together; failed metadata uploads discard only new bytes", (t) => {
  const f = fixture(t),
    input = { projectId: f.p.id, title: "atomic", operationId: randomUUID() };
  f.ctx.db.exec(
    "CREATE TRIGGER fail_resource_event BEFORE INSERT ON resource_events BEGIN SELECT RAISE(FAIL,'forced audit failure'); END",
  );
  assert.throws(
    () =>
      f.files.withUpload(Buffer.from("discard"), "new.bin", (file) => {
        const value = f.resources.createFile(owner, input, file);
        return {
          storageKey: f.resources.fileRecord(
            owner,
            value.resource.id,
            value.resource.currentVersion,
          ).storageKey,
          value,
        };
      }),
    /forced audit failure/,
  );
  assert.equal(
    f.ctx.db.prepare("SELECT COUNT(*) n FROM resources").get()?.n,
    0,
  );
  assert.equal(
    f.ctx.db.prepare("SELECT COUNT(*) n FROM resource_versions").get()?.n,
    0,
  );
  assert.equal(
    f.ctx.db.prepare("SELECT COUNT(*) n FROM resource_operations").get()?.n,
    0,
  );
  assert.deepEqual(readdirSync(join(f.dir, "uploads")), []);
  f.ctx.db.exec("DROP TRIGGER fail_resource_event");
  const upload = () =>
    f.files.withUpload(Buffer.from("retained"), "safe.bin", (file) => {
      const value = f.resources.createFile(owner, input, file);
      return {
        storageKey: f.resources.fileRecord(
          owner,
          value.resource.id,
          value.resource.currentVersion,
        ).storageKey,
        value,
      };
    });
  const created = upload();
  assert.deepEqual(upload(), created);
  assert.equal(readdirSync(join(f.dir, "uploads")).length, 1);
  const before = f.resources.get(owner, created.resource.id);
  f.ctx.db.exec(
    "CREATE TRIGGER fail_resource_receipt BEFORE INSERT ON resource_operations BEGIN SELECT RAISE(FAIL,'forced receipt failure'); END",
  );
  assert.throws(
    () =>
      f.resources.update(owner, created.resource.id, {
        revision: 1,
        title: "lost",
        operationId: randomUUID(),
      }),
    /forced receipt failure/,
  );
  assert.deepEqual(f.resources.get(owner, created.resource.id), before);
});
void test("resource audit includes actor-attributed guidance and tombstone changes without erasing immutable content", (t) => {
  const f = fixture(t),
    created = f.create();
  f.resources.update(f.agent, created.resource.id, {
    revision: 1,
    markdown: "agent revision",
    operationId: randomUUID(),
  });
  f.resources.guidance(owner, created.resource.id, {
    revision: 2,
    isGuidance: true,
    operationId: randomUUID(),
  });
  const deleted = f.resources.remove(owner, created.resource.id, {
    revision: 3,
    operationId: randomUUID(),
  });
  assert.deepEqual(
    deleted.events.map((event) => [
      event.action,
      event.revision,
      event.authorId,
    ]),
    [
      ["created", 1, owner.id],
      ["updated", 2, f.agent.id],
      ["guidance_designated", 3, owner.id],
      ["deleted", 4, owner.id],
    ],
  );
  assert.equal(deleted.history[0].authorId, f.agent.id);
  assert.equal(
    f.resources.version(owner, created.resource.id, 2).markdown,
    "agent revision",
  );
});
void test("deleted owning versions stay explicit and missing scope filters never broaden to all resources", (t) => {
  const f = fixture(t),
    version = f.store.createVersion(owner, { projectId: f.p.id, name: "v1" }),
    resource = f.resources.create(owner, {
      projectId: f.p.id,
      versionId: version.id,
      title: "proof",
      kind: "link",
      url: "https://example.invalid/",
      operationId: randomUUID(),
    });
  f.store.deleteVersion(owner, version.id);
  const detail = f.resources.get(owner, resource.resource.id);
  assert.equal(detail.resource.versionId, version.id);
  assert.equal(detail.resource.versionAvailable, false);
  assert.equal(f.resources.list(owner, { versionId: null }).length, 0);
  denied(() => f.resources.list(owner, { versionId: version.id }), "NOT_FOUND");
});
