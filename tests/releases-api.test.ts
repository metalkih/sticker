import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  sessionHttpFixture,
  sessionOwner as owner,
} from "./session-fixture.js";
import { readJson } from "./helpers.js";
import {
  readinessSchema,
  changelogSchema,
  releaseResultSchema,
} from "../server/contracts/releases.js";
void test("release HTTP routes authenticate, keep owner confirmation authoritative, expose matching readiness/draft/export and CAS", async () => {
  const f = await sessionHttpFixture();
  try {
    const v = f.instance.store.createVersion(owner, {
        projectId: f.project.id,
        name: "v1",
      }),
      foreign = f.instance.store.createVersion(owner, {
        projectId: f.other.id,
        name: "secret",
      });
    f.instance.store.updateIssue(owner, f.issue.id, {
      revision: 1,
      targetVersionId: v.id,
    });
    assert.equal(
      (await f.call(`/versions/${v.id}/readiness`, "anonymous")).status,
      401,
    );
    assert.equal(
      (await f.call(`/versions/${foreign.id}/readiness`, "agent")).status,
      403,
    );
    const read = await readJson(
      await f.call(`/versions/${v.id}/readiness`, "agent"),
      readinessSchema,
    );
    assert.equal(read.counts.unfinished, 1);
    const input = { revision: 1, operationId: randomUUID(), confirm: true };
    assert.equal(
      (await f.call(`/versions/${v.id}/release`, "agent", "POST", input))
        .status,
      403,
    );
    assert.equal(
      (
        await f.call(`/versions/${v.id}/release`, "owner", "POST", {
          ...input,
          confirm: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call(`/versions/${v.id}`, "agent", "PATCH", {
          revision: 1,
          state: "released",
        })
      ).status,
      409,
    );
    const generated = await readJson(
      await f.call(`/versions/${v.id}/changelog/generate`, "owner", "POST", {
        revision: 0,
        selectedIssueIds: [f.issue.id],
      }),
      changelogSchema,
    );
    assert.equal(generated.revision, 1);
    const exported = await f.call(`/versions/${v.id}/changelog/export`);
    assert.match(exported.headers.get("content-type") ?? "", /text\/markdown/);
    assert.equal(await exported.text(), generated.markdown);
    const released = await readJson(
      await f.call(`/versions/${v.id}/release`, "owner", "POST", input),
      releaseResultSchema,
    );
    assert.equal(released.version.state, "released");
    const retried = await readJson(
      await f.call(`/versions/${v.id}/release`, "owner", "POST", input),
      releaseResultSchema,
    );
    assert.deepEqual(retried, released);
  } finally {
    await f.close();
  }
});
