import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/domain.js";
import { FileStorage } from "../server/file-storage.js";
import { sessionOwner as owner } from "./session-fixture.js";
void test(
  "existing authenticated attachment EFBIG failure removes new partial bytes without changing prior files or metadata (#58)",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "sticker-legacy-write-")),
      password = `fixture-${randomUUID()}`,
      store = new Store(root),
      project = store.createProject(owner, { key: "LW", name: "fixture" }),
      issue = store.createIssue(owner, {
        projectId: project.id,
        title: "fixture",
      }),
      files = new FileStorage(root),
      prior = files.write(Buffer.from("keep"), "prior.bin");
    store.addAttachment(owner, issue.id, {
      kind: "file",
      name: prior.fileName,
      storageKey: prior.storageKey,
      mimeType: prior.mimeType,
      size: prior.size,
    });
    store.close();
    const moduleUrl = new URL("../server/app.ts", import.meta.url).href,
      source = `
  import { createApp } from ${JSON.stringify(moduleUrl)};
  process.on("SIGXFSZ", () => {});
  const instance = createApp({dataDir:process.env.FIXTURE_DIR,ownerPassword:process.env.FIXTURE_PASSWORD,agents:[],appOrigin:"http://localhost:8787"});
  const server = instance.app.listen(0,"127.0.0.1",()=>{console.log("FIXTURE_READY http://127.0.0.1:"+server.address().port);});
  process.once("SIGTERM",()=>{server.closeAllConnections();server.close(()=>{instance.close();process.exit(0);});});
 `,
      child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-"],
        {
          env: {
            ...process.env,
            TSX_DISABLE_CACHE: "1",
            STICKER_NODE: process.execPath,
            FIXTURE_DIR: root,
            FIXTURE_PASSWORD: password,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    let output = "";
    child.stdout.on("data", (bytes: Buffer) => {
      output += bytes.toString();
    });
    child.stderr.on("data", (bytes: Buffer) => {
      output += bytes.toString();
    });
    child.stdin.end(source);
    t.after(async () => {
      child.kill("SIGTERM");
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            child.kill("SIGKILL");
          }, 5000);
          child.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      rmSync(root, { recursive: true, force: true });
    });
    const base = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Attachment failure fixture did not start"));
      }, 15000);
      child.stdout.on("data", () => {
        const match = /FIXTURE_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", () => {
        clearTimeout(timeout);
        reject(new Error(output));
      });
    });
    const login = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:8787",
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.ok(child.pid);
    const limited = spawnSync(
      "prlimit",
      ["--pid", String(child.pid), "--fsize=2048:2048"],
      { encoding: "utf8" },
    );
    assert.equal(limited.status, 0, limited.stderr || String(limited.error));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(16384)]), "partial.bin");
    const response = await fetch(`${base}/api/issues/${issue.id}/attachments`, {
      method: "POST",
      headers: { cookie, origin: "http://localhost:8787" },
      body: form,
    });
    assert.equal(response.status, 500);
    await response.text();
    assert.deepEqual(readdirSync(join(root, "uploads")), [prior.storageKey]);
    assert.equal(
      readFileSync(files.filePath(prior.storageKey), "utf8"),
      "keep",
    );
    const db = new DatabaseSync(join(root, "sticker.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM attachments").get()?.n,
        1,
      );
    } finally {
      db.close();
    }
  },
);
