import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/domain.js";
import { StoreContext } from "../server/store-context.js";
import { FileStorage } from "../server/file-storage.js";
import { ResourceService } from "../server/features/resources.js";
import { validateResourceVersionFiles } from "../server/resource-files.js";
import type { Actor } from "../server/types.js";
const owner: Actor = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "sticker-resource-backup-")),
    store = new Store(root),
    ctx = new StoreContext(root),
    files = new FileStorage(root);
  const resources = new ResourceService(ctx),
    project = store.createProject(owner, { key: "RF", name: "자료" }),
    first = files.write(Buffer.from("old bytes"), "old.bin"),
    created = resources.createFile(
      owner,
      { projectId: project.id, title: "proof", operationId: randomUUID() },
      first,
    );
  resources.update(owner, created.resource.id, {
    revision: 1,
    title: "same bytes",
    operationId: randomUUID(),
  });
  const second = files.write(Buffer.from("new bytes"), "new.bin");
  resources.updateFile(
    owner,
    created.resource.id,
    { revision: 2, operationId: randomUUID() },
    second,
  );
  resources.remove(owner, created.resource.id, {
    revision: 3,
    operationId: randomUUID(),
  });
  t.after(() => {
    ctx.db.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, store, ctx, files, resources, first, second, created };
}
void test("resource backup verification includes immutable history and tombstones, deduplicating shared version bytes", (t) => {
  const f = fixture(t);
  assert.equal(validateResourceVersionFiles(f.root, f.ctx.db), 2);
  assert.equal(
    f.ctx.db
      .prepare("SELECT COUNT(*) n FROM resource_versions WHERE kind='file'")
      .get()?.n,
    3,
  );
});
void test("missing historical resource bytes and same-length corrupt bytes are rejected before restore", (t) => {
  const f = fixture(t),
    path = f.files.filePath(f.first.storageKey);
  writeFileSync(path, "bad bytes");
  assert.throws(
    () => validateResourceVersionFiles(f.root, f.ctx.db),
    /checksum/i,
  );
  unlinkSync(path);
  assert.throws(
    () => validateResourceVersionFiles(f.root, f.ctx.db),
    /missing/i,
  );
});
void test("inconsistent duplicate file metadata and unsafe storage keys fail closed", (t) => {
  const f = fixture(t);
  f.ctx.db
    .prepare(
      "UPDATE resource_versions SET size=size+1 WHERE resourceId=? AND version=2",
    )
    .run(f.created.resource.id);
  assert.throws(
    () => validateResourceVersionFiles(f.root, f.ctx.db),
    /inconsistent/i,
  );
  f.ctx.db
    .prepare(
      "UPDATE resource_versions SET size=size-1 WHERE resourceId=? AND version=2",
    )
    .run(f.created.resource.id);
  f.ctx.db
    .prepare(
      "UPDATE resource_versions SET storageKey='../escape' WHERE resourceId=? AND version=1",
    )
    .run(f.created.resource.id);
  assert.throws(() => validateResourceVersionFiles(f.root, f.ctx.db), /UUID/i);
});
