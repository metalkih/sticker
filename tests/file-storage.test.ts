import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { FileStorage, normalizeFileName } from "../server/file-storage.js";
import { DomainError } from "../server/domain-error.js";
function fixture(t: test.TestContext, uuid?: () => string) {
  const dir = mkdtempSync(join(tmpdir(), "sticker-resource-storage-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, storage: new FileStorage(dir, uuid) };
}
void test("resource storage uses opaque exclusive UUID paths, safe original names and server-detected MIME", (t) => {
  const f = fixture(t),
    bytes = Buffer.from('<svg onload="alert(1)"/>'),
    file = f.storage.write(bytes, "C:\\private\\../paper.svg\n");
  assert.equal(file.fileName, "paper.svg");
  assert.equal(file.mimeType, "application/octet-stream");
  assert.equal(file.size, bytes.length);
  assert.equal(file.checksum, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(readFileSync(f.storage.filePath(file.storageKey)), bytes);
  assert.equal(
    statSync(f.storage.filePath(file.storageKey)).mode & 0o777,
    0o600,
  );
  assert.equal(statSync(join(f.dir, "uploads")).mode & 0o777, 0o700);
  assert.equal(normalizeFileName("../../."), "attachment");
  assert.equal(normalizeFileName("/a/unsafe\u0000name.txt"), "unsafename.txt");
  const png = f.storage.write(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    "image.bin",
  );
  assert.equal(png.mimeType, "image/png");
});
void test("failed or duplicate metadata commit removes only the new file and preserves existing version bytes", (t) => {
  const f = fixture(t),
    original = f.storage.write(Buffer.from("immutable"), "old.txt");
  assert.throws(
    () =>
      f.storage.withUpload(Buffer.from("new"), "new.txt", () => {
        throw new Error("metadata failed");
      }),
    /metadata failed/,
  );
  assert.deepEqual(readdirSync(join(f.dir, "uploads")), [original.storageKey]);
  const result = f.storage.withUpload(
    Buffer.from("immutable"),
    "old.txt",
    () => ({
      storageKey: original.storageKey,
      value: "original committed metadata",
    }),
  );
  assert.equal(result, "original committed metadata");
  assert.deepEqual(readdirSync(join(f.dir, "uploads")), [original.storageKey]);
  assert.equal(
    readFileSync(f.storage.filePath(original.storageKey), "utf8"),
    "immutable",
  );
});
void test("20 MiB upload boundary is enforced before metadata or disk mutation", (t) => {
  const f = fixture(t);
  let called = false;
  assert.throws(
    () =>
      f.storage.withUpload(
        Buffer.alloc(20 * 1024 * 1024 + 1),
        "too-large.bin",
        () => {
          called = true;
          return { storageKey: randomUUID(), value: 1 };
        },
      ),
    (e) => e instanceof DomainError && e.status === 413,
  );
  assert.equal(called, false);
  assert.deepEqual(readdirSync(join(f.dir, "uploads")), []);
  const file = f.storage.write(Buffer.alloc(20 * 1024 * 1024), "boundary.bin");
  assert.equal(file.size, 20 * 1024 * 1024);
});
void test("collisions never overwrite old versions and path traversal or links never become downloads", (t) => {
  const key = randomUUID(),
    f = fixture(t, () => key),
    first = f.storage.write(Buffer.from("must survive"), "one.txt");
  assert.throws(() =>
    f.storage.withUpload(Buffer.from("overwrite"), "two.txt", (file) => ({
      storageKey: file.storageKey,
      value: 1,
    })),
  );
  assert.equal(
    readFileSync(f.storage.filePath(first.storageKey), "utf8"),
    "must survive",
  );
  assert.throws(() => f.storage.filePath("../../private"));
  const link = randomUUID();
  writeFileSync(join(f.dir, "not-a-resource"), "private");
  symlinkSync(join(f.dir, "not-a-resource"), join(f.dir, "uploads", link));
  assert.throws(
    () => f.storage.filePath(link),
    (e) => e instanceof DomainError && e.status === 404,
  );
});
void test("a linked upload directory is refused instead of writing outside the workspace", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sticker-resource-dir-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "elsewhere"));
  symlinkSync(join(dir, "elsewhere"), join(dir, "uploads"));
  assert.throws(() => new FileStorage(dir), /real directory/);
});

void test(
  "partial filesystem write failures remove only newly owned files before metadata, preserving EEXIST bytes (#58)",
  { skip: process.platform === "win32" },
  () => {
    const moduleUrl = new URL("../server/file-storage.ts", import.meta.url)
      .href;
    const code = `
    import assert from "node:assert/strict";
    import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
    import { join } from "node:path";
    import { tmpdir } from "node:os";
    import { randomUUID } from "node:crypto";
    import { FileStorage } from ${JSON.stringify(moduleUrl)};
    process.on("SIGXFSZ", () => {});
    const root = mkdtempSync(join(tmpdir(), "sticker-partial-write-"));
    try {
      const key = randomUUID(), existing = new FileStorage(root, () => key);
      existing.write(Buffer.from("keep"), "old.bin");
      let metadataCalls = 0;
      const metadata = file => { metadataCalls++; return { storageKey: file.storageKey, value: true }; };
      assert.throws(() => new FileStorage(root).withUpload(Buffer.alloc(16384), "partial.bin", metadata), error => error.code === "EFBIG");
      assert.equal(metadataCalls, 0);
      assert.deepEqual(readdirSync(join(root, "uploads")), [key]);
      assert.throws(() => existing.withUpload(Buffer.alloc(16384), "collision.bin", metadata), error => error.code === "EEXIST");
      assert.equal(metadataCalls, 0);
      assert.equal(readFileSync(existing.filePath(key), "utf8"), "keep");
    } finally { rmSync(root, { recursive: true, force: true }); }
  `;
    const result = spawnSync(
      "bash",
      [
        "-c",
        'ulimit -f 2; exec "$STICKER_NODE" --import tsx --input-type=module -',
      ],
      {
        input: code,
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          STICKER_NODE: process.execPath,
          TSX_DISABLE_CACHE: "1",
        },
      },
    );
    assert.equal(
      result.status,
      0,
      result.stderr || String(result.error ?? result.signal),
    );
  },
);
void test("safe filenames never split Unicode characters or retain lone surrogates that break download headers", () => {
  const boundary = normalizeFileName("a".repeat(254) + "📄");
  assert.doesNotThrow(() => encodeURIComponent(boundary));
  assert.equal(boundary, "a".repeat(254));
  assert.equal(
    normalizeFileName("a".repeat(253) + "📄"),
    "a".repeat(253) + "📄",
  );
  assert.equal(normalizeFileName("bad\ud800.txt"), "bad�.txt");
});
