import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStickerMcp } from "../server/mcp.js";
import { sessionHttpFixture, sessionOwner } from "./session-fixture.js";
import {
  issueQueryResultSchema,
  savedViewSchema,
} from "../server/contracts/views.js";
import { issueSchema } from "../server/response-schemas.js";
function content<T>(result: unknown, schema: z.ZodType<T>): T {
  const envelope = z
    .object({ content: z.array(z.object({ text: z.string() })).min(1) })
    .parse(result);
  const data: unknown = JSON.parse(envelope.content[0].text);
  return schema.parse(data);
}
void test("MCP shares authoritative query grammar while private owner views remain private", async () => {
  const f = await sessionHttpFixture(),
    server = createStickerMcp(f.base, f.tokens.agent),
    client = new Client({ name: "views", version: "1" }),
    [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("sticker_query_issues"));
    const view = f.instance.store.views.create(sessionOwner, {
      name: "주인",
      query: { projectId: f.project.id },
    });
    const query = {
      projectId: f.project.id,
      status: ["backlog"],
      sort: "key_asc",
      mode: "list",
    };
    const result = content(
      await client.callTool({ name: "sticker_query_issues", arguments: query }),
      issueQueryResultSchema,
    );
    assert.deepEqual(
      result.issues.map((i) => i.id),
      f.instance.store.views
        .query(
          {
            ...sessionOwner,
            id: "agent",
            role: "agent",
            projectIds: [f.project.id],
          },
          query,
        )
        .issues.map((i) => i.id),
    );
    const old = content(
      await client.callTool({
        name: "sticker_list_issues",
        arguments: {
          projectId: f.project.id,
          status: "backlog",
          sort: "key_asc",
        },
      }),
      issueSchema.array(),
    );
    assert.deepEqual(
      old.map((i) => i.id),
      result.issues.map((i) => i.id),
    );
    assert.deepEqual(
      content(
        await client.callTool({
          name: "sticker_list_saved_views",
          arguments: { projectId: f.project.id },
        }),
        savedViewSchema.array(),
      ),
      [],
    );
    assert.equal(
      (
        await client.callTool({
          name: "sticker_get_saved_view",
          arguments: { viewId: view.id },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: "sticker_query_issues",
          arguments: { projectId: f.other.id },
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
