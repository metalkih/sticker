import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  resourceDetailSchema,
  resourceSchema,
  issueResourceLinkSchema,
} from "../server/contracts/resources.js";
import {
  sessionHttpFixture,
  sessionOwner as owner,
} from "./session-fixture.js";
import { readJson } from "./helpers.js";
function uploadForm(metadata: unknown, bytes: Uint8Array, name = "자료.svg") {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append(
    "file",
    new Blob([Uint8Array.from(bytes)], { type: "image/svg+xml" }),
    name,
  );
  return form;
}
void test("resource HTTP CRUD/guidance stays behind real auth/origin/project/CAS rules without URL fetching", async () => {
  const f = await sessionHttpFixture();
  try {
    const response = await f.call("/resources", "agent", "POST", {
      projectId: f.project.id,
      title: "문서",
      kind: "markdown",
      markdown: "<script>untrusted</script>",
      operationId: randomUUID(),
    });
    assert.equal(response.status, 201);
    const created = await readJson(response, resourceDetailSchema),
      id = created.resource.id;
    assert.equal(created.current?.markdown, "<script>untrusted</script>");
    assert.equal((await f.call(`/resources/${id}`, "anonymous")).status, 401);
    assert.equal(
      (
        await f.call("/resources", "read", "POST", {
          projectId: f.project.id,
          title: "read",
          kind: "link",
          url: "https://example.invalid/",
          operationId: randomUUID(),
        })
      ).status,
      403,
    );
    const foreign = f.instance.store.resources.create(owner, {
      projectId: f.other.id,
      title: "secret",
      kind: "link",
      url: "https://example.invalid/private",
      operationId: randomUUID(),
    });
    assert.equal(
      (await f.call(`/resources/${foreign.resource.id}`, "agent")).status,
      403,
    );
    assert.equal(
      (
        await readJson(
          await f.call("/resources?query=secret", "agent"),
          resourceSchema.array(),
        )
      ).length,
      0,
    );
    assert.equal(
      (await f.call(`/resources?projectId=${f.other.id}`, "agent")).status,
      403,
    );
    assert.equal(
      (
        await f.call(`/resources/${id}/guidance`, "agent", "PATCH", {
          revision: 1,
          isGuidance: true,
          operationId: randomUUID(),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(`/resources/${id}/guidance`, "owner", "PATCH", {
          revision: 1,
          isGuidance: true,
          operationId: randomUUID(),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await readJson(
          await f.call(`/projects/${f.project.id}/guidance`, "agent"),
          resourceDetailSchema.array(),
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await f.call(`/resources/${id}`, "agent", "PATCH", {
          revision: 2,
          markdown: "overwrite",
          operationId: randomUUID(),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(`/resources/${id}`, "owner", "PATCH", {
          revision: 1,
          markdown: "stale",
          operationId: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.call("/resources", "agent", "POST", {
          projectId: f.project.id,
          title: "bad",
          kind: "link",
          url: "file:///etc/passwd",
          operationId: randomUUID(),
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
void test("HTTP file versions remain shared and pinned across unlink/tombstone, with safe active-format download headers and duplicate upload cleanup", async () => {
  const f = await sessionHttpFixture();
  try {
    const metadata = { title: "공유 파일", operationId: randomUUID() },
      bytes = Buffer.from('<svg onload="alert(1)"/>');
    const upload = () =>
      fetch(`${f.base}/api/projects/${f.project.id}/resources/files`, {
        method: "POST",
        headers: { authorization: `Bearer ${f.tokens.agent}` },
        body: uploadForm(metadata, bytes),
      });
    const response = await upload();
    assert.equal(response.status, 201);
    const created = await readJson(response, resourceDetailSchema),
      id = created.resource.id;
    assert.equal(JSON.stringify(created).includes("storageKey"), false);
    assert.deepEqual(
      await readJson(await upload(), resourceDetailSchema),
      created,
    );
    const first = await readJson(
        await f.call(`/issues/${f.issue.id}/resources`, "agent", "POST", {
          resourceId: id,
          resourceVersion: 1,
          issueRevision: 1,
          operationId: randomUUID(),
        }),
        issueResourceLinkSchema,
      ),
      second = f.instance.store.createIssue(owner, {
        projectId: f.project.id,
        title: "second",
      });
    assert.equal(
      (
        await f.call(`/issues/${second.id}/resources`, "agent", "POST", {
          resourceId: id,
          resourceVersion: 1,
          issueRevision: 1,
          operationId: randomUUID(),
        })
      ).status,
      201,
    );
    const update = await fetch(`${f.base}/api/resources/${id}/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${f.tokens.agent}` },
      body: uploadForm(
        { revision: 1, operationId: randomUUID() },
        Buffer.from("new version"),
        "v2.bin",
      ),
    });
    assert.equal(update.status, 200);
    assert.equal(
      (
        await f.call(
          `/issues/${f.issue.id}/resources/${first.id}`,
          "agent",
          "DELETE",
          { issueRevision: 2, operationId: randomUUID() },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await readJson(
          await f.call(`/issues/${second.id}/resources`, "agent"),
          issueResourceLinkSchema.array(),
        )
      )[0].version.version,
      1,
    );
    assert.equal(
      (
        await f.call(`/resources/${id}`, "agent", "DELETE", {
          revision: 2,
          operationId: randomUUID(),
        })
      ).status,
      200,
    );
    const file = await f.call(
      `/resources/${id}/versions/1/file?preview=1`,
      "agent",
    );
    assert.equal(file.status, 200);
    assert.equal(await file.text(), bytes.toString());
    assert.match(
      file.headers.get("content-disposition") ?? "",
      /^attachment;.*filename\*=UTF-8''/,
    );
    assert.equal(file.headers.get("content-type"), "application/octet-stream");
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.match(file.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(
      (await f.call(`/resources/${id}/versions/99/file`, "agent")).status,
      404,
    );
    assert.equal(
      (await f.call(`/resources/${id}/versions/1/file`, "anonymous")).status,
      401,
    );
  } finally {
    await f.close();
  }
});
void test("resource upload preflights scope/write before buffering and rejects malformed metadata while foreign file reads remain forbidden", async () => {
  const f = await sessionHttpFixture();
  try {
    const send = (projectId: string, token: string, metadata: unknown) =>
      fetch(`${f.base}/api/projects/${projectId}/resources/files`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: uploadForm(metadata, Buffer.from("private"), "secret.bin"),
      });
    const metadata = { title: "private", operationId: randomUUID() };
    assert.equal(
      (await send(f.other.id, f.tokens.agent, metadata)).status,
      403,
    );
    assert.equal(
      (await send(f.project.id, f.tokens.read, metadata)).status,
      403,
    );
    assert.equal(
      (
        await send(f.project.id, f.tokens.agent, {
          ...metadata,
          storageKey: "../../escape",
        })
      ).status,
      400,
    );
    const foreign = await readJson(
      await send(f.other.id, f.tokens.unscoped, metadata),
      resourceDetailSchema,
    );
    assert.equal(
      (
        await f.call(
          `/resources/${foreign.resource.id}/versions/1/file`,
          "agent",
        )
      ).status,
      403,
    );
    const missing = new FormData();
    missing.append("metadata", "not-json");
    missing.append("file", new Blob(["data"]), "one.txt");
    assert.equal(
      (
        await fetch(`${f.base}/api/projects/${f.project.id}/resources/files`, {
          method: "POST",
          headers: { authorization: `Bearer ${f.tokens.agent}` },
          body: missing,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await readJson(
          await f.call("/resources", "agent"),
          z.array(resourceSchema),
        )
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});
void test("HTTP result references require the current own result event, preserve exact history, and expose scoped pinned JSON versions", async () => {
  const f = await sessionHttpFixture();
  try {
    const created = f.instance.store.resources.create(owner, {
        projectId: f.project.id,
        title: "result",
        kind: "markdown",
        markdown: "original",
        operationId: randomUUID(),
      }),
      agent = {
        ...owner,
        id: "agent",
        role: "agent" as const,
        projectIds: [f.project.id],
      },
      report = f.instance.store.sessions.report(agent, {
        projectId: f.project.id,
        issueId: f.issue.id,
        externalSessionId: "http-result",
        eventId: "result",
        kind: "result",
        message: "reported",
      }),
      input = {
        sessionId: report.session.id,
        eventId: "result",
        resourceId: created.resource.id,
        resourceVersion: 1,
        operationId: randomUUID(),
      };
    assert.equal(
      (await f.call("/resource-references", "other", "POST", input)).status,
      403,
    );
    assert.equal(
      (
        await f.call("/resource-references", "agent", "POST", {
          ...input,
          eventId: "absent",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.call("/resource-references", "agent", "POST", input)).status,
      201,
    );
    f.instance.store.resources.update(owner, created.resource.id, {
      revision: 1,
      markdown: "latest",
      operationId: randomUUID(),
    });
    const old = await readJson(
      await f.call(`/resources/${created.resource.id}/versions/1`, "agent"),
      z.object({ version: z.number(), markdown: z.string() }),
    );
    assert.equal(old.markdown, "original");
    const refs = await readJson(
      await f.call(`/sessions/${report.session.id}/resources`, "agent"),
      z.array(
        z.object({
          recordedBy: z.string(),
          version: z.object({ version: z.number() }),
        }),
      ),
    );
    assert.equal(refs[0].recordedBy, "agent");
    assert.equal(refs[0].version.version, 1);
    assert.equal(
      (
        await readJson(
          await f.call("/resources/query", "read", "POST", {
            projectId: f.project.id,
            versionId: null,
            query: "result",
          }),
          resourceSchema.array(),
        )
      ).length,
      1,
    );
  } finally {
    await f.close();
  }
});
void test("HTTP resource multipart enforces the 20 MiB cap without creating metadata", async () => {
  const f = await sessionHttpFixture();
  try {
    const form = uploadForm(
        { title: "too-large", operationId: randomUUID() },
        new Uint8Array(20 * 1024 * 1024 + 1),
        "large.bin",
      ),
      response = await fetch(
        `${f.base}/api/projects/${f.project.id}/resources/files`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${f.tokens.agent}` },
          body: form,
        },
      );
    assert.equal(response.status, 413);
    assert.equal(
      (
        await readJson(
          await f.call("/resources", "agent"),
          resourceSchema.array(),
        )
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});
