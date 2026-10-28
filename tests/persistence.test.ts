import { readJson, requiredHeader } from "./helpers.js";
import {
  projectSchema,
  issueSchema,
  attachmentSchema,
  issueDetailSchema,
  sessionDetailSchema,
  sessionRequestSchema,
} from "../server/response-schemas.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

void test("a full server restart preserves issues/comments/files while expiring old sessions", async () => {
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
    const base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`;
    const call = (p: string, init: RequestInit = {}) => fetch(base + p, init);
    const login = async () => {
      const r = await call("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      assert.equal(r.status, 200);
      return requiredHeader(r, "set-cookie").split(";")[0];
    };
    return {
      call,
      login,
      instance,
      stop: async () => {
        await new Promise<void>((r, j) =>
          server.close((e) => {
            if (e) j(e);
            else r();
          }),
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
    const p = await readJson(
      await running.call(
        "/api/projects",
        json(cookie, { name: "지속되는 작업 공간", key: "SAVE" }),
      ),
      projectSchema,
    );
    const i = await readJson(
      await running.call(
        "/api/issues",
        json(cookie, {
          projectId: p.id,
          title: "다시 켜도 남는 스티커",
          status: "waiting",
        }),
      ),
      issueSchema,
    );
    await running.call(
      `/api/issues/${i.id}/comments`,
      json(cookie, { body: "재시작 전에 기록한 결과" }),
    );
    const form = new FormData();
    form.append("file", new Blob(["persistent file bytes"]), "note.txt");
    const a = await readJson(
      await running.call(`/api/issues/${i.id}/attachments`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:8787" },
        body: form,
      }),
      attachmentSchema,
    );
    assert.ok(a.id);
    const session = running.instance.store.sessions.report(
      {
        id: "restart-agent",
        name: "검증 에이전트",
        role: "agent",
        canWrite: true,
        projectIds: [p.id],
      },
      {
        projectId: p.id,
        issueId: i.id,
        externalSessionId: "persistent-run",
        eventId: "pending-question",
        kind: "request",
        requestKind: "input",
        message: "재시작 후에도 남는 질문",
      },
    );
    assert.ok(session.request);
    await running.stop();
    running = await start();
    assert.equal(
      (await running.call("/api/bootstrap", { headers: { cookie } })).status,
      401,
    );
    const secondCookie = await running.login();
    const detail = await readJson(
      await running.call(`/api/issues/${i.id}`, {
        headers: { cookie: secondCookie },
      }),
      issueDetailSchema,
    );
    const sessionDetail = await readJson(
      await running.call(`/api/sessions/${session.session.id}`, {
        headers: { cookie: secondCookie },
      }),
      sessionDetailSchema,
    );
    assert.equal(sessionDetail.events[0].message, "재시작 후에도 남는 질문");
    const inbox = await readJson(
      await running.call("/api/inbox", { headers: { cookie: secondCookie } }),
      sessionRequestSchema.array(),
    );
    assert.equal(inbox[0].id, session.request.id);
    assert.equal(inbox[0].status, "pending");
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
