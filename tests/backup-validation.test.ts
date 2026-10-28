import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/domain.js";

const owner = {
  id: "owner",
  name: "나",
  role: "owner" as const,
  canWrite: true,
  projectIds: null,
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "sticker-backup-validation-"));
  const dbPath = join(dir, "sticker.sqlite");
  const store = new Store(dir);
  const project = store.createProject(owner, {
    name: "backup fixture",
    key: "BKP",
  });
  const issue = store.createIssue(owner, {
    projectId: project.id,
    title: "보존할 이슈",
  });
  const key = randomUUID();
  store.addAttachment(owner, issue.id, {
    kind: "file",
    name: "note.txt",
    storageKey: key,
    mimeType: "text/plain",
    size: 4,
  });
  store.close();
  mkdirSync(join(dir, "uploads"));
  writeFileSync(join(dir, "uploads", key), "test");
  return {
    dir,
    dbPath,
    key,
    issue,
    close: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function validate(dir: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "server/backup-validation.ts", dir],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}
function changeDb(path: string, sql: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
function rejection(dir: string, reason: RegExp) {
  const result = validate(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, reason);
}

void test("validator accepts supported Sticker schema and complete attachments without changing DB bytes", () => {
  const f = fixture();
  try {
    const before = readFileSync(f.dbPath);
    const result = validate(f.dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(f.dbPath), before);
  } finally {
    f.close();
  }
});
void test("validator rejects zero-byte database rather than treating it as an empty workspace", () => {
  const f = fixture();
  try {
    writeFileSync(f.dbPath, "");
    rejection(f.dir, /empty|zero-byte/i);
  } finally {
    f.close();
  }
});
void test("validator rejects unrelated SQLite even if it claims supported user_version", () => {
  const f = fixture();
  try {
    rmSync(f.dbPath);
    changeDb(
      f.dbPath,
      "CREATE TABLE unrelated(value TEXT); PRAGMA user_version=1;",
    );
    rejection(f.dir, /schema|table/i);
  } finally {
    f.close();
  }
});
void test("validator rejects future Sticker schema versions", () => {
  const f = fixture();
  try {
    changeDb(f.dbPath, "PRAGMA user_version=2;");
    rejection(f.dir, /version/i);
  } finally {
    f.close();
  }
});
void test("validator rejects missing required Sticker columns", () => {
  const f = fixture();
  try {
    changeDb(f.dbPath, "ALTER TABLE comments DROP COLUMN body;");
    rejection(f.dir, /column|schema/i);
  } finally {
    f.close();
  }
});
void test("validator rejects relational corruption detected by foreign_key_check", () => {
  const f = fixture();
  try {
    changeDb(
      f.dbPath,
      "PRAGMA foreign_keys=OFF; UPDATE issues SET projectId='missing';",
    );
    rejection(f.dir, /foreign.key/i);
  } finally {
    f.close();
  }
});
void test("validator rejects missing and truncated attachment bytes", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, "uploads", f.key), "t");
    rejection(f.dir, /size/i);
    rmSync(join(f.dir, "uploads", f.key));
    rejection(f.dir, /missing|file/i);
  } finally {
    f.close();
  }
});
void test("validator rejects unsafe storage keys and symlink attachment files", () => {
  const f = fixture();
  try {
    rmSync(join(f.dir, "uploads", f.key));
    symlinkSync(f.dbPath, join(f.dir, "uploads", f.key));
    rejection(f.dir, /regular|link/i);
    changeDb(f.dbPath, "UPDATE attachments SET storageKey='../escape';");
    rejection(f.dir, /storage.key|UUID/i);
  } finally {
    f.close();
  }
});
void test("validator rejects a symlink database or uploads directory", () => {
  const f = fixture();
  try {
    const original = readFileSync(f.dbPath);
    rmSync(f.dbPath);
    writeFileSync(join(f.dir, "other.sqlite"), original);
    symlinkSync(join(f.dir, "other.sqlite"), f.dbPath);
    rejection(f.dir, /regular|link/i);
    rmSync(f.dbPath);
    writeFileSync(f.dbPath, original);
    rmSync(join(f.dir, "uploads"), { recursive: true });
    symlinkSync(tmpdir(), join(f.dir, "uploads"));
    rejection(f.dir, /directory|link/i);
  } finally {
    f.close();
  }
});
