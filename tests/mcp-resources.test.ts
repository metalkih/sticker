import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStickerMcp } from "../server/mcp.js";
import {
  sessionHttpFixture,
  sessionOwner as owner,
} from "./session-fixture.js";
import {
  resourceSchema,
  resourceVersionSchema,
  resourceDetailSchema,
  issueResourceLinkSchema,
  resourceReferenceSchema,
} from "../server/contracts/resources.js";
function content<T>(result: unknown, schema: z.ZodType<T>): T {
  const envelope = z
      .object({
        content: z
          .array(z.object({ type: z.literal("text"), text: z.string() }))
          .min(1),
      })
      .parse(result),
    raw: unknown = JSON.parse(envelope.content[0].text);
  return schema.parse(raw);
}
void test("official MCP resources reauthorize scope, distinguish owner guidance, pin issue/result versions and never grant authority or owner writes", async () => {
  const f = await sessionHttpFixture(),
    server = createStickerMcp(f.base, f.tokens.agent),
    client = new Client({ name: "resources-test", version: "1" }),
    [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const resource = f.instance.store.resources.create(owner, {
        projectId: f.project.id,
        title: "guide",
        kind: "markdown",
        markdown: "untrusted body",
        operationId: randomUUID(),
      }),
      foreign = f.instance.store.resources.create(owner, {
        projectId: f.other.id,
        title: "secret",
        kind: "link",
        url: "https://example.invalid/",
        operationId: randomUUID(),
      });
    f.instance.store.resources.guidance(owner, resource.resource.id, {
      revision: 1,
      isGuidance: true,
      operationId: randomUUID(),
    });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("sticker_list_resources"));
    assert.ok(
      !names.some((name) => /designate_guidance|set_guidance/.test(name)),
    );
    assert.equal(
      content(
        await client.callTool({
          name: "sticker_list_resources",
          arguments: { projectId: f.project.id },
        }),
        resourceSchema.array(),
      ).length,
      1,
    );
    assert.equal(
      content(
        await client.callTool({
          name: "sticker_get_project_guidance",
          arguments: { projectId: f.project.id },
        }),
        resourceDetailSchema.array(),
      )[0].resource.isGuidance,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: "sticker_get_resource",
          arguments: { resourceId: foreign.resource.id },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: "sticker_list_resources",
          arguments: { projectId: f.other.id },
        })
      ).isError,
      true,
    );
    const link = content(
      await client.callTool({
        name: "sticker_link_resource",
        arguments: {
          issueId: f.issue.id,
          resourceId: resource.resource.id,
          resourceVersion: 1,
          issueRevision: 1,
          operationId: randomUUID(),
        },
      }),
      issueResourceLinkSchema,
    );
    assert.equal(link.version.version, 1);
    const report = f.instance.store.sessions.report(
      { ...owner, id: "agent", role: "agent", projectIds: [f.project.id] },
      {
        projectId: f.project.id,
        issueId: f.issue.id,
        externalSessionId: "mcp-resource",
        eventId: "result",
        kind: "result",
        message: "self report",
      },
    );
    const reference = content(
      await client.callTool({
        name: "sticker_record_resource_reference",
        arguments: {
          sessionId: report.session.id,
          eventId: "result",
          resourceId: resource.resource.id,
          resourceVersion: 1,
          operationId: randomUUID(),
        },
      }),
      resourceReferenceSchema,
    );
    assert.equal(reference.recordedBy, "agent");
    assert.equal(reference.version.authorId, owner.id);
    f.instance.store.resources.update(owner, resource.resource.id, {
      revision: 2,
      markdown: "new body",
      operationId: randomUUID(),
    });
    const selected = content(
      await client.callTool({
        name: "sticker_get_resource",
        arguments: { resourceId: resource.resource.id, resourceVersion: 1 },
      }),
      z.object({
        resource: resourceSchema,
        selectedVersion: resourceVersionSchema.nullable(),
      }),
    );
    assert.equal(selected.resource.currentVersion, 2);
    assert.equal(selected.selectedVersion?.markdown, "untrusted body");
    assert.equal(selected.selectedVersion.version, 1);
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
void test("MCP shared file upload/read accepts bytes only, enforces 5 MiB separately from HTTP 20 MiB, and preserves exact versions", async () => {
  const f = await sessionHttpFixture(),
    server = createStickerMcp(f.base, f.tokens.agent),
    client = new Client({ name: "resource-file-test", version: "1" }),
    [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const args = {
      projectId: f.project.id,
      title: "file",
      name: "../원본.svg",
      operationId: randomUUID(),
      base64: Buffer.from('<svg onload="alert(1)"/>').toString("base64"),
    };
    const uploaded = content(
      await client.callTool({
        name: "sticker_upload_resource_file",
        arguments: args,
      }),
      resourceDetailSchema,
    );
    assert.equal(uploaded.current?.fileName, "원본.svg");
    assert.equal(uploaded.current.mimeType, "application/octet-stream");
    assert.deepEqual(
      content(
        await client.callTool({
          name: "sticker_upload_resource_file",
          arguments: args,
        }),
        resourceDetailSchema,
      ),
      uploaded,
    );
    const file = content(
      await client.callTool({
        name: "sticker_read_resource_file",
        arguments: { resourceId: uploaded.resource.id, resourceVersion: 1 },
      }),
      z.object({
        resourceId: z.string(),
        resourceVersion: z.number(),
        base64: z.string(),
        size: z.number(),
        name: z.string(),
        mimeType: z.string(),
      }),
    );
    assert.equal(file.base64, args.base64);
    assert.equal(file.resourceVersion, 1);
    const boundary = content(
      await client.callTool({
        name: "sticker_upload_resource_file",
        arguments: {
          ...args,
          title: "boundary",
          name: "boundary.bin",
          operationId: randomUUID(),
          base64: Buffer.alloc(5 * 1024 * 1024).toString("base64"),
        },
      }),
      resourceDetailSchema,
    );
    assert.equal(boundary.current?.size, 5 * 1024 * 1024);
    const boundaryRead = content(
      await client.callTool({
        name: "sticker_read_resource_file",
        arguments: { resourceId: boundary.resource.id, resourceVersion: 1 },
      }),
      z.object({ size: z.number(), base64: z.string() }),
    );
    assert.equal(boundaryRead.size, 5 * 1024 * 1024);
    assert.equal(
      Buffer.from(boundaryRead.base64, "base64").length,
      5 * 1024 * 1024,
    );
    const oversized = await client.callTool({
      name: "sticker_upload_resource_file",
      arguments: {
        ...args,
        operationId: randomUUID(),
        base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
      },
    });
    assert.equal(oversized.isError, true);
    assert.equal(
      content(oversized, z.object({ code: z.string() })).code,
      "FILE_TOO_LARGE",
    );
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({ title: "web-only", operationId: randomUUID() }),
    );
    form.append(
      "file",
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]),
      "large.bin",
    );
    const response = await fetch(
      `${f.base}/api/projects/${f.project.id}/resources/files`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${f.tokens.agent}` },
        body: form,
      },
    );
    assert.equal(response.status, 201);
    const web = resourceDetailSchema.parse(await response.json());
    const read = await client.callTool({
      name: "sticker_read_resource_file",
      arguments: { resourceId: web.resource.id, resourceVersion: 1 },
    });
    assert.equal(read.isError, true);
    assert.equal(
      content(read, z.object({ code: z.string() })).code,
      "FILE_TOO_LARGE",
    );
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});

void test("read-only MCP principals can search but cannot upload or attach resources", async () => {
  const f = await sessionHttpFixture(),
    server = createStickerMcp(f.base, f.tokens.read),
    client = new Client({ name: "resources-read-test", version: "1" }),
    [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const resource = f.instance.store.resources.create(owner, {
      projectId: f.project.id,
      title: "read",
      kind: "markdown",
      markdown: "data",
      operationId: randomUUID(),
    });
    assert.equal(
      content(
        await client.callTool({
          name: "sticker_list_resources",
          arguments: { projectId: f.project.id },
        }),
        resourceSchema.array(),
      ).length,
      1,
    );
    for (const call of [
      {
        name: "sticker_upload_resource_file",
        arguments: {
          projectId: f.project.id,
          title: "denied",
          name: "data.txt",
          base64: "",
          operationId: randomUUID(),
        },
      },
      {
        name: "sticker_link_resource",
        arguments: {
          issueId: f.issue.id,
          resourceId: resource.resource.id,
          issueRevision: 1,
          operationId: randomUUID(),
        },
      },
    ]) {
      const result = await client.callTool(call);
      assert.equal(result.isError, true);
      assert.equal(
        content(result, z.object({ code: z.string() })).code,
        "READ_ONLY",
      );
    }
    assert.equal(
      (
        await client.callTool({
          name: "sticker_get_resource",
          arguments: { resourceId: "https://example.invalid/" },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
