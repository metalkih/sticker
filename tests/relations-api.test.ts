import test from "node:test";
import assert from "node:assert/strict";
import { sessionHttpFixture, sessionOwner } from "./session-fixture.js";
import {
  relationSchema,
  relationDetailSchema,
  relationSummariesSchema,
} from "../server/contracts/relations.js";
import { readJson } from "./helpers.js";
void test("relation HTTP endpoints enforce authentication, scope, revisions and directional cycle protection", async () => {
  const f = await sessionHttpFixture();
  try {
    const second = f.instance.store.createIssue(sessionOwner, {
      projectId: f.project.id,
      title: "second",
    });
    const path = `/issues/${f.issue.id}/relations`;
    assert.equal((await f.call(path, "anonymous")).status, 401);
    assert.equal(
      (
        await f.call(path, "read", "POST", {
          kind: "parent",
          targetIssueId: second.id,
          sourceRevision: 1,
          targetRevision: 1,
        })
      ).status,
      403,
    );
    const response = await f.call(path, "agent", "POST", {
      kind: "parent",
      targetIssueId: second.id,
      sourceRevision: 1,
      targetRevision: 1,
    });
    assert.equal(response.status, 201);
    const edge = await readJson(response, relationSchema);
    const detail = await readJson(await f.call(path), relationDetailSchema);
    assert.equal(detail.children[0]?.issue.id, second.id);
    const all = await readJson(
      await f.call("/relations/summary", "agent"),
      relationSummariesSchema,
    );
    assert.ok(all[f.issue.id]);
    assert.equal(all[f.foreign.id], undefined);
    assert.equal(
      (
        await f.call(`/issues/${second.id}/relations`, "agent", "POST", {
          kind: "parent",
          targetIssueId: f.issue.id,
          sourceRevision: 2,
          targetRevision: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.call(`/issues/${f.foreign.id}/relations`, "agent")).status,
      403,
    );
    assert.equal(
      (
        await f.call(`/relations/${edge.id}`, "owner", "DELETE", {
          sourceRevision: 1,
          targetRevision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.call(`/relations/${edge.id}`, "owner", "DELETE", {
          sourceRevision: 2,
          targetRevision: 2,
        })
      ).status,
      204,
    );
  } finally {
    await f.close();
  }
});
