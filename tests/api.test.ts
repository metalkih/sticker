import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../server/app.js";
import type { AgentConfig } from "../server/auth.js";
const password = "temporary-test-owner-password";
const token = "ephemeral-test-agent-token-never-persisted";
const tokenHash = createHash("sha256").update(token).digest("hex");
async function fixture(agents: AgentConfig[] = []) {
  const dataDir = mkdtempSync(join(tmpdir(), "sticker-api-"));
  const instance = createApp({
    dataDir,
    ownerPassword: password,
    agents,
    appOrigin: "http://localhost:8787",
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, options: RequestInit = {}) =>
    fetch(base + path, options);
  const login = async () => {
    const r = await call("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  const json = (cookie: string, method: string, body?: unknown) => ({
    method,
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "http://localhost:8787",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    dataDir,
    instance,
    call,
    login,
    json,
    cleanup: async () => {
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
      instance.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
test("API is private, login is secure, logout invalidates session and foreign-origin writes fail", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("/api/bootstrap")).status, 401);
    const r = await f.call("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(r.headers.get("set-cookie")!, /SameSite=Strict/);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await f.call("/api/bootstrap", { headers: { cookie } })).status,
      200,
    );
    assert.equal(
      (
        await f.call("/api/projects", {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify({ name: "Bad", key: "BAD" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call("/api/projects", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "No origin", key: "BAD" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.call("/api/session", f.json(cookie, "DELETE"))).status,
      204,
    );
    assert.equal(
      (await f.call("/api/bootstrap", { headers: { cookie } })).status,
      401,
    );
  } finally {
    await f.cleanup();
  }
});
test("HTTP CRUD persists data and rejects stale issue updates", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const p = await (
      await f.call(
        "/api/projects",
        f.json(cookie, "POST", {
          name: "테스트 프로젝트",
          key: "TEST",
          color: "#c2f36b",
        }),
      )
    ).json();
    assert.ok(p.id);
    const v = await (
      await f.call(
        "/api/versions",
        f.json(cookie, "POST", { projectId: p.id, name: "v1" }),
      )
    ).json();
    assert.ok(v.id);
    const i = await (
      await f.call(
        "/api/issues",
        f.json(cookie, "POST", {
          projectId: p.id,
          title: "실제 저장되는 이슈",
          targetVersionId: v.id,
        }),
      )
    ).json();
    assert.ok(i.id);
    const updated = await f.call(
      `/api/issues/${i.id}`,
      f.json(cookie, "PATCH", { revision: i.revision, status: "waiting" }),
    );
    assert.equal(updated.status, 200);
    assert.equal(
      (
        await f.call(
          `/api/issues/${i.id}`,
          f.json(cookie, "PATCH", {
            revision: i.revision,
            title: "overwrites",
          }),
        )
      ).status,
      409,
    );
    const detail = await (
      await f.call(`/api/issues/${i.id}`, { headers: { cookie } })
    ).json();
    assert.equal(detail.issue.status, "waiting");
    assert.ok(detail.activity.length >= 2);
    const b = await (
      await f.call("/api/bootstrap", { headers: { cookie } })
    ).json();
    assert.equal(b.issues.length, 1);
    assert.ok(readdirSync(f.dataDir).includes("sticker.sqlite"));
  } finally {
    await f.cleanup();
  }
});
test("agent writes retain configured author, cannot escape scopes or close issues", async () => {
  const f = await fixture([
    {
      id: "reader",
      name: "읽기 에이전트",
      tokenHash,
      projectIds: [],
      canWrite: false,
    },
  ]);
  try {
    const cookie = await f.login();
    const p = await (
      await f.call(
        "/api/projects",
        f.json(cookie, "POST", { name: "Private", key: "PVT" }),
      )
    ).json();
    const i = await (
      await f.call(
        "/api/issues",
        f.json(cookie, "POST", { projectId: p.id, title: "private" }),
      )
    ).json();
    const auth = { authorization: `Bearer ${token}` };
    const b = await (await f.call("/api/bootstrap", { headers: auth })).json();
    assert.deepEqual(b.projects, []);
    assert.deepEqual(b.issues, []);
    assert.ok(
      [403, 404].includes(
        (await f.call(`/api/issues/${i.id}`, { headers: auth })).status,
      ),
    );
    assert.equal(
      (
        await f.call("/api/issues", {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ projectId: p.id, title: "forbidden" }),
        })
      ).status,
      403,
    );
  } finally {
    await f.cleanup();
  }
  const w = await fixture([
    {
      id: "writer",
      name: "Codex fixture",
      tokenHash,
      projectIds: null,
      canWrite: true,
    },
  ]);
  try {
    const cookie = await w.login();
    const p = await (
      await w.call(
        "/api/projects",
        w.json(cookie, "POST", { name: "Agent test", key: "AGT" }),
      )
    ).json();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const i = await (
      await w.call("/api/issues", {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId: p.id, title: "agent issue" }),
      })
    ).json();
    assert.ok(i.id);
    assert.equal(
      (
        await w.call(`/api/issues/${i.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ revision: i.revision, status: "closed" }),
        })
      ).status,
      403,
    );
    const c = await (
      await w.call(`/api/issues/${i.id}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: "작업 결과",
          authorId: "owner",
          authorName: "Imposter",
        }),
      })
    ).json();
    // Strict unknown-field rejection or authoritative attribution is acceptable; never impersonation.
    if (c.id) assert.equal(c.authorId, "writer");
    else assert.ok(c.error);
    const c2 = await (
      await w.call(`/api/issues/${i.id}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: "작업 결과" }),
      })
    ).json();
    assert.equal(c2.authorId, "writer");
  } finally {
    await w.cleanup();
  }
});
test("uploads and links are private, safe downloads; bytes survive a later authenticated fetch", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const p = await (
      await f.call(
        "/api/projects",
        f.json(cookie, "POST", { name: "Files", key: "FIL" }),
      )
    ).json();
    const i = await (
      await f.call(
        "/api/issues",
        f.json(cookie, "POST", { projectId: p.id, title: "attachments" }),
      )
    ).json();
    const form = new FormData();
    form.append(
      "file",
      new Blob(["<script>alert(1)</script>"], { type: "text/html" }),
      "../../unsafe.html",
    );
    const upload = await f.call(`/api/issues/${i.id}/attachments`, {
      method: "POST",
      headers: { cookie, origin: "http://localhost:8787" },
      body: form,
    });
    const a = await upload.json();
    assert.equal(upload.status, 201, JSON.stringify(a));
    assert.equal((await f.call(`/api/attachments/${a.id}/file`)).status, 401);
    const file = await f.call(`/api/attachments/${a.id}/file?preview=1`, {
      headers: { cookie },
    });
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition")!, /^attachment;/);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await file.text(), "<script>alert(1)</script>");
    assert.equal(
      (
        await f.call(
          `/api/issues/${i.id}/links`,
          f.json(cookie, "POST", {
            name: "unsafe",
            url: "javascript:alert(1)",
          }),
        )
      ).status,
      400,
    );
    const good = await f.call(
      `/api/issues/${i.id}/links`,
      f.json(cookie, "POST", { name: "docs", url: "https://example.com/doc" }),
    );
    assert.equal(good.status, 201);
    assert.equal(
      (await f.call(`/api/attachments/${a.id}`, f.json(cookie, "DELETE")))
        .status,
      204,
    );
    assert.equal(
      (await f.call(`/api/attachments/${a.id}/file`, { headers: { cookie } }))
        .status,
      404,
    );
    assert.equal(readdirSync(join(f.dataDir, "uploads")).length, 0);
  } finally {
    await f.cleanup();
  }
});
test("malformed JSON and unknown routes return bounded JSON errors, not internals", async () => {
  const f = await fixture();
  try {
    const bad = await f.call("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.ok(body.error);
    assert.equal(body.stack, undefined);
    assert.equal(
      (await f.call("/api/unknown", { headers: { cookie: await f.login() } }))
        .status,
      404,
    );
  } finally {
    await f.cleanup();
  }
});
test("Korean filenames remain readable and only detected raster images preview inline", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const p = await (
      await f.call(
        "/api/projects",
        f.json(cookie, "POST", { name: "이미지", key: "IMG" }),
      )
    ).json();
    const i = await (
      await f.call(
        "/api/issues",
        f.json(cookie, "POST", { projectId: p.id, title: "preview" }),
      )
    ).json();
    const form = new FormData();
    form.append(
      "file",
      new Blob(
        [
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXf8AAAAASUVORK5CYII=",
            "base64",
          ),
        ],
        { type: "text/html" },
      ),
      "테스트 이미지.png",
    );
    const uploaded = await f.call(`/api/issues/${i.id}/attachments`, {
      method: "POST",
      headers: { cookie, origin: "http://localhost:8787" },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const a = await uploaded.json();
    assert.equal(a.name, "테스트 이미지.png");
    const preview = await f.call(`/api/attachments/${a.id}/file?preview=1`, {
      headers: { cookie },
    });
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.match(preview.headers.get("content-disposition")!, /^inline;/);
    const normal = await f.call(`/api/attachments/${a.id}/file`, {
      headers: { cookie },
    });
    assert.match(normal.headers.get("content-disposition")!, /^attachment;/);
    const oversized = new FormData();
    oversized.append(
      "file",
      new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]),
      "large.bin",
    );
    assert.equal(
      (
        await f.call(`/api/issues/${i.id}/attachments`, {
          method: "POST",
          headers: { cookie, origin: "http://localhost:8787" },
          body: oversized,
        })
      ).status,
      413,
    );
    assert.equal(readdirSync(join(f.dataDir, "uploads")).length, 1);
    assert.equal(
      (await f.call(`/api/issues/${i.id}`, f.json(cookie, "DELETE"))).status,
      204,
    );
    assert.equal(readdirSync(join(f.dataDir, "uploads")).length, 0);
  } finally {
    await f.cleanup();
  }
});
test("malformed upload and unsupported JSON charset are client errors, not server errors", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const p = await (
      await f.call(
        "/api/projects",
        f.json(cookie, "POST", { name: "Malformed requests", key: "BAD" }),
      )
    ).json();
    const i = await (
      await f.call(
        "/api/issues",
        f.json(cookie, "POST", { projectId: p.id, title: "bad file requests" }),
      )
    ).json();
    const headers = {
      cookie,
      origin: "http://localhost:8787",
      "content-type": "multipart/form-data",
    };
    assert.equal(
      (
        await f.call(`/api/issues/${i.id}/attachments`, {
          method: "POST",
          headers,
          body: "invalid",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call(`/api/issues/${i.id}/attachments`, {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "multipart/form-data; boundary=broken",
          },
          body: '--broken\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\ntruncated',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json; charset=bogus" },
          body: "{}",
        })
      ).status,
      415,
    );
    assert.equal(readdirSync(join(f.dataDir, "uploads")).length, 0);
  } finally {
    await f.cleanup();
  }
});
test("RFC5987 filenames are not decoded twice", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const p = await (
      await f.call(
        "/api/projects",
        f.json(cookie, "POST", { name: "Unicode", key: "UNI" }),
      )
    ).json();
    const i = await (
      await f.call(
        "/api/issues",
        f.json(cookie, "POST", { projectId: p.id, title: "filename star" }),
      )
    ).json();
    for (const name of ["한글.txt", "Ā.txt", "Â©.txt"]) {
      const body = `--boundary\r\nContent-Disposition: form-data; name="file"; filename*=UTF-8''${encodeURIComponent(name)}\r\nContent-Type: text/plain\r\n\r\nhello\r\n--boundary--\r\n`;
      const r = await f.call(`/api/issues/${i.id}/attachments`, {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:8787",
          "content-type": "multipart/form-data; boundary=boundary",
        },
        body,
      });
      assert.equal(r.status, 201);
      assert.equal((await r.json()).name, name);
    }
  } finally {
    await f.cleanup();
  }
});
