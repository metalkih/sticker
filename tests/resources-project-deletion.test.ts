import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, DomainError } from "../server/domain.js";
import { FileStorage } from "../server/file-storage.js";
import {
  sessionHttpFixture,
  sessionOwner as owner,
} from "./session-fixture.js";
void test("project deletion cannot bypass active resource tombstones or lose their immutable file metadata", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sticker-resource-project-")),
    store = new Store(root),
    files = new FileStorage(root);
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const project = store.createProject(owner, {
      key: "RP",
      name: "resource-only",
    }),
    stored = files.write(Buffer.from("retained"), "keep.bin"),
    resource = store.resources.createFile(
      owner,
      { projectId: project.id, title: "active", operationId: randomUUID() },
      stored,
    );
  assert.throws(
    () => {
      store.deleteProject(owner, project.id);
    },
    (error: unknown) =>
      error instanceof DomainError && error.code === "PROJECT_NOT_EMPTY",
  );
  assert.equal(
    store.resources.get(owner, resource.resource.id).current?.kind,
    "file",
  );
  assert.equal(
    readFileSync(files.filePath(stored.storageKey), "utf8"),
    "retained",
  );
  store.resources.remove(owner, resource.resource.id, {
    revision: 1,
    operationId: randomUUID(),
  });
  store.deleteProject(owner, project.id);
  assert.equal(store.bootstrap(owner).projects.length, 0);
  assert.equal(
    readFileSync(files.filePath(stored.storageKey), "utf8"),
    "retained",
    "Explicit project removal still does not delete shared file bytes",
  );
});

void test("HTTP project deletion reports active resources as nonempty before any cascade", async () => {
  const f = await sessionHttpFixture();
  try {
    const project = f.instance.store.createProject(owner, {
        key: "RD",
        name: "resource-only",
      }),
      resource = f.instance.store.resources.create(owner, {
        projectId: project.id,
        title: "document",
        kind: "markdown",
        markdown: "retained",
        operationId: randomUUID(),
      });
    assert.equal(
      (await f.call(`/projects/${project.id}`, "owner", "DELETE")).status,
      409,
    );
    assert.equal(
      (await f.call(`/resources/${resource.resource.id}`)).status,
      200,
    );
    assert.equal(
      (
        await f.call(`/resources/${resource.resource.id}`, "owner", "DELETE", {
          revision: 1,
          operationId: randomUUID(),
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.call(`/projects/${project.id}`, "owner", "DELETE")).status,
      204,
    );
  } finally {
    await f.close();
  }
});
