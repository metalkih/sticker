import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStickerMcp } from "../server/mcp.js";
import { sessionHttpFixture, sessionOwner } from "./session-fixture.js";
import {
  relationSchema,
  relationDetailSchema,
} from "../server/contracts/relations.js";
function content<T>(result: unknown, schema: z.ZodType<T>): T {
  const e = z
    .object({
      content: z
        .array(z.object({ type: z.literal("text"), text: z.string() }))
        .min(1),
    })
    .parse(result);
  const value: unknown = JSON.parse(e.content[0].text);
  return schema.parse(value);
}
void test("MCP relation tools share cycle, scoped write and CAS checks without changing issue status", async () => {
  const f = await sessionHttpFixture(),
    server = createStickerMcp(f.base, f.tokens.agent),
    client = new Client({ name: "relations-test", version: "1" }),
    [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("sticker_add_issue_relation"));
    const second = f.instance.store.createIssue(sessionOwner, {
      projectId: f.project.id,
      title: "child",
    });
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args });
    const edge = content(
      await call("sticker_add_issue_relation", {
        issueId: f.issue.id,
        targetIssueId: second.id,
        kind: "parent",
        sourceRevision: 1,
        targetRevision: 1,
      }),
      relationSchema,
    );
    const detail = content(
      await call("sticker_get_issue_relations", { issueId: f.issue.id }),
      relationDetailSchema,
    );
    assert.equal(detail.children.length, 1);
    const cycle = await call("sticker_add_issue_relation", {
      issueId: second.id,
      targetIssueId: f.issue.id,
      kind: "parent",
      sourceRevision: 2,
      targetRevision: 2,
    });
    assert.equal(cycle.isError, true);
    assert.equal(
      content(cycle, z.object({ code: z.string() })).code,
      "RELATION_CYCLE",
    );
    const foreign = await call("sticker_get_issue_relations", {
      issueId: f.foreign.id,
    });
    assert.equal(foreign.isError, true);
    const removal = await call("sticker_remove_issue_relation", {
      relationId: edge.id,
      sourceRevision: 2,
      targetRevision: 2,
    });
    assert.ok(!removal.isError);
    assert.equal(
      f.instance.store.getIssue(sessionOwner, second.id).issue.status,
      "backlog",
    );
  } finally {
    await client.close();
    await server.close();
    await f.close();
  }
});
