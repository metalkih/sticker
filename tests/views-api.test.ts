import test from "node:test";
import assert from "node:assert/strict";
import { sessionHttpFixture, sessionOwner } from "./session-fixture.js";
import {
  savedViewSchema,
  issueQueryResultSchema,
  viewPreferencesSchema,
} from "../server/contracts/views.js";
import { readJson } from "./helpers.js";
void test("view HTTP API scopes private entities, validates query and CAS preferences", async () => {
  const f = await sessionHttpFixture();
  try {
    const created = await f.call("/views", "owner", "POST", {
      name: "개인",
      query: { projectId: f.project.id, status: ["backlog"], mode: "list" },
    });
    assert.equal(created.status, 201);
    const view = await readJson(created, savedViewSchema);
    assert.equal((await f.call(`/views/${view.id}`, "agent")).status, 404);
    assert.equal((await f.call("/views", "anonymous")).status, 401);
    const q = await readJson(
      await f.call("/issues/query", "agent", "POST", {
        projectId: f.project.id,
        status: ["backlog"],
      }),
      issueQueryResultSchema,
    );
    assert.deepEqual(
      q.issues.map((i) => i.id),
      [f.issue.id],
    );
    assert.equal(
      (
        await f.call("/issues/query", "agent", "POST", {
          projectId: f.other.id,
        })
      ).status,
      403,
    );
    const get = await readJson(
      await f.call(
        `/issues?filter=${encodeURIComponent(JSON.stringify({ projectId: f.project.id, status: ["backlog"] }))}`,
      ),
      issueQueryResultSchema,
    );
    assert.deepEqual(
      get.issues.map((i) => i.id),
      q.issues.map((i) => i.id),
    );
    assert.equal((await f.call("/issues?sql=delete")).status, 400);
    const p = await readJson(
      await f.call(`/view-preferences/${f.project.id}`, "owner", "PUT", {
        revision: 0,
        defaultViewId: view.id,
        favoriteIds: [view.id],
      }),
      viewPreferencesSchema,
    );
    assert.equal(p.revision, 1);
    assert.equal(
      (
        await f.call(`/view-preferences/${f.project.id}`, "owner", "PUT", {
          revision: 0,
          defaultViewId: null,
          favoriteIds: [],
        })
      ).status,
      409,
    );
    f.instance.store.createIssue(sessionOwner, {
      projectId: f.project.id,
      title: "새 이슈",
    });
    assert.equal(
      (
        await readJson(
          await f.call("/issues/query", "owner", "POST", view.query),
          issueQueryResultSchema,
        )
      ).issues.length,
      2,
    );
  } finally {
    await f.close();
  }
});
