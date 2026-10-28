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
  const dir = mkdtempSync(join(tmpdir(), "sticker-templates-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store };
}
void test("Store exposes project-scoped versioned issue templates", (t) => {
  const f = fixture(t);
  assert.ok("templates" in f.store, "template service is required");
});

import { randomUUID } from "node:crypto";
function projectFixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "sticker-template-projects-"));
  const seed = new Store(dir),
    p = seed.createProject(owner, { key: "TP", name: "템플릿" }),
    q = seed.createProject(owner, { key: "TQ", name: "다른 범위" });
  const version = seed.createVersion(owner, { projectId: p.id, name: "v1" }),
    foreignVersion = seed.createVersion(owner, {
      projectId: q.id,
      name: "foreign",
    });
  seed.close();
  const agent: Actor = {
    id: "agent-a",
    name: "에이전트 A",
    role: "agent",
    canWrite: true,
    projectIds: [p.id],
  };
  const other: Actor = {
    ...agent,
    id: "agent-b",
    name: "다른 범위 에이전트",
    projectIds: [q.id],
  };
  const reader: Actor = { ...agent, id: "reader", canWrite: false };
  const store = new Store(dir, Date.now, "http://localhost:8787", [
    owner,
    agent,
    other,
    reader,
  ]);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, p, q, version, foreignVersion, agent, other, reader };
}
function rejects(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof DomainError && error.code === code,
  );
}
void test("owner definitions are revisioned, immutable, tombstoned, and creation retries compare payloads", (t) => {
  const f = projectFixture(t),
    body = {
      projectId: f.p.id,
      name: "버그",
      body: "## 버그",
      requiredFields: ["reproduction", "expected", "actual", "foundVersionId"],
      defaults: {
        priority: "high",
        assignee: f.agent.id,
        foundVersionId: f.version.id,
      },
      operationId: randomUUID(),
    };
  assert.equal(f.store.templates.examples().length, 3);
  assert.equal(f.store.templates.list(owner, f.p.id).length, 0);
  const first = f.store.templates.create(owner, body);
  assert.equal(first.template.currentVersion, 1);
  assert.equal(first.versions.length, 1);
  assert.deepEqual(f.store.templates.create(owner, body), first);
  rejects(
    () => f.store.templates.create(owner, { ...body, name: "키 재사용" }),
    "OPERATION_CONFLICT",
  );
  const second = f.store.templates.update(owner, first.template.id, {
    revision: 1,
    name: "수정된 버그",
    body: "수정된 본문",
    requiredFields: ["actual"],
    defaults: { priority: "urgent" },
  });
  assert.equal(second.template.currentVersion, 2);
  assert.equal(second.template.revision, 2);
  assert.equal(second.versions[0].body, body.body);
  assert.equal(second.versions[1].body, "수정된 본문");
  rejects(
    () =>
      f.store.templates.update(owner, first.template.id, {
        revision: 1,
        name: "충돌",
        body: "x",
        requiredFields: [],
        defaults: {},
      }),
    "REVISION_CONFLICT",
  );
  const historical = f.store.templates.get(f.agent, first.template.id, 1);
  assert.equal(historical.selectedVersion.body, body.body);
  rejects(() => {
    f.store.templates.remove(owner, first.template.id, { revision: 1 });
  }, "REVISION_CONFLICT");
  f.store.templates.remove(owner, first.template.id, { revision: 2 });
  assert.equal(f.store.templates.list(owner, f.p.id).length, 0);
  rejects(
    () => f.store.templates.get(owner, first.template.id),
    "TEMPLATE_NOT_FOUND",
  );
});
void test("template CRUD, reads and safe assignee directory recheck owner/write/project scope", (t) => {
  const f = projectFixture(t),
    body = {
      projectId: f.p.id,
      name: "기능",
      body: "본문",
      requiredFields: ["problem", "scope", "acceptance"],
      defaults: {},
      operationId: randomUUID(),
    };
  const created = f.store.templates.create(owner, body);
  rejects(
    () =>
      f.store.templates.create(f.agent, { ...body, operationId: randomUUID() }),
    "OWNER_REQUIRED",
  );
  rejects(
    () =>
      f.store.templates.create(f.reader, {
        ...body,
        operationId: randomUUID(),
      }),
    "READ_ONLY",
  );
  rejects(
    () => f.store.templates.get(f.other, created.template.id),
    "PROJECT_SCOPE",
  );
  rejects(() => f.store.templates.list(f.other, f.p.id), "PROJECT_SCOPE");
  rejects(
    () =>
      f.store.templates.update(f.agent, created.template.id, {
        revision: 1,
        name: "x",
        body: "x",
        requiredFields: [],
        defaults: {},
      }),
    "OWNER_REQUIRED",
  );
  rejects(() => {
    f.store.templates.remove(f.agent, created.template.id, { revision: 1 });
  }, "OWNER_REQUIRED");
  assert.equal(
    f.store.templates.get(f.reader, created.template.id).template.id,
    created.template.id,
  );
  const directory = f.store.templates.assignees(f.agent, f.p.id);
  assert.deepEqual(directory.map((a) => a.id).sort(), [
    "agent-a",
    "owner",
    "reader",
  ]);
  assert.equal(JSON.stringify(directory).includes("tokenHash"), false);
  rejects(() => f.store.templates.assignees(f.other, f.p.id), "PROJECT_SCOPE");
});
void test("template defaults and fixed fields reject forged privilege, unknown fields and foreign references", (t) => {
  const f = projectFixture(t),
    base = {
      projectId: f.p.id,
      name: "안전한 템플릿",
      body: "본문",
      requiredFields: [],
      defaults: {},
      operationId: randomUUID(),
    };
  for (const defaults of [
    { status: "closed" },
    { projectId: f.q.id },
    { revision: 1 },
    { authorId: "owner" },
    { canWrite: true },
  ])
    rejects(
      () =>
        f.store.templates.create(owner, {
          ...base,
          defaults,
          operationId: randomUUID(),
        }),
      "VALIDATION",
    );
  rejects(
    () =>
      f.store.templates.create(owner, {
        ...base,
        requiredFields: ["arbitrary-shell"],
      }),
    "VALIDATION",
  );
  rejects(
    () =>
      f.store.templates.create(owner, {
        ...base,
        requiredFields: ["input", "input"],
      }),
    "VALIDATION",
  );
  rejects(
    () =>
      f.store.templates.create(owner, {
        ...base,
        defaults: { assignee: f.other.id },
      }),
    "TEMPLATE_ASSIGNEE",
  );
  rejects(
    () =>
      f.store.templates.create(owner, {
        ...base,
        defaults: { targetVersionId: f.foreignVersion.id },
      }),
    "TEMPLATE_VERSION_REFERENCE",
  );
  rejects(
    () =>
      f.store.templates.create(owner, {
        ...base,
        defaults: { foundVersionId: "deleted-version" },
      }),
    "TEMPLATE_VERSION_REFERENCE",
  );
});
void test("a project with active templates is not silently deleted as empty", (t) => {
  const f = fixture(t),
    p = f.store.createProject(owner, { key: "TE", name: "반복 양식" });
  const definition = f.store.templates.create(owner, {
    projectId: p.id,
    name: "보존할 양식",
    body: "본문",
    requiredFields: [],
    defaults: {},
    operationId: randomUUID(),
  });
  rejects(() => {
    f.store.deleteProject(owner, p.id);
  }, "PROJECT_NOT_EMPTY");
  f.store.templates.remove(owner, definition.template.id, { revision: 1 });
  f.store.deleteProject(owner, p.id);
});
