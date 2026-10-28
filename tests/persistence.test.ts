import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

test("a full server restart preserves issues/comments/files while expiring old sessions", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "sticker-restart-"));
  const password = "temporary-restart-fixture-password";
  const start = async () => {
    const instance = createApp({
      dataDir,
      ownerPassword: password,
      appOrigin: "http://localhost:8787",
    });
    const server = instance.app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const call = (p: string, init: RequestInit = {}) => fetch(base + p, init);
    const login = async () => {
      const r = await call("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    return {
      call,
      login,
      stop: async () => {
        await new Promise<void>((r, j) =>
          server.close((e) => (e ? j(e) : r())),
        );
        instance.close();
      },
    };
  };
  const json = (cookie: string, body: unknown) => ({
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:8787",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let running = await start();
  try {
    const cookie = await running.login();
    const p = await (
      await running.call(
        "/api/projects",
        json(cookie, { name: "지속되는 작업 공간", key: "SAVE" }),
      )
    ).json();
    const i = await (
      await running.call(
        "/api/issues",
        json(cookie, {
          projectId: p.id,
          title: "다시 켜도 남는 스티커",
          status: "waiting",
        }),
      )
    ).json();
    await running.call(
      `/api/issues/${i.id}/comments`,
      json(cookie, { body: "재시작 전에 기록한 결과" }),
    );
    const form = new FormData();
    form.append("file", new Blob(["persistent file bytes"]), "note.txt");
    const a = await (
      await running.call(`/api/issues/${i.id}/attachments`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:8787" },
        body: form,
      })
    ).json();
    assert.ok(a.id);
    await running.stop();
    running = await start();
    assert.equal(
      (await running.call("/api/bootstrap", { headers: { cookie } })).status,
      401,
    );
    const secondCookie = await running.login();
    const detail = await (
      await running.call(`/api/issues/${i.id}`, {
        headers: { cookie: secondCookie },
      })
    ).json();
    assert.equal(detail.issue.title, "다시 켜도 남는 스티커");
    assert.equal(detail.issue.status, "waiting");
    assert.equal(detail.comments[0].body, "재시작 전에 기록한 결과");
    assert.equal(detail.attachments[0].id, a.id);
    assert.equal(
      await (
        await running.call(`/api/attachments/${a.id}/file`, {
          headers: { cookie: secondCookie },
        })
      ).text(),
      "persistent file bytes",
    );
  } finally {
    await running.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
