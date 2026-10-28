import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { sessionHttpFixture } from "./session-fixture.js";
import { readJson } from "./helpers.js";
void test("existing issue attachment downloads keep Unicode boundaries within the 255-unit cap instead of storing lone surrogates", async () => {
  const f = await sessionHttpFixture();
  try {
    for (const [name, expected] of [
      ["a".repeat(254) + "📄", "a".repeat(254)],
      ["a".repeat(253) + "📄", "a".repeat(253) + "📄"],
    ]) {
      const form = new FormData();
      form.append("file", new Blob(["existing bytes"]), name);
      const upload = await fetch(
        `${f.base}/api/issues/${f.issue.id}/attachments`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${f.tokens.agent}` },
          body: form,
        },
      );
      assert.equal(upload.status, 201);
      const attachment = await readJson(
        upload,
        z.object({ id: z.string(), name: z.string() }),
      );
      const download = await f.call(
        `/attachments/${attachment.id}/file`,
        "agent",
      );
      assert.equal(download.status, 200);
      assert.equal(await download.text(), "existing bytes");
      assert.equal(attachment.name, expected);
      assert.match(
        download.headers.get("content-disposition") ?? "",
        new RegExp(encodeURIComponent(expected)),
      );
      assert.doesNotMatch(
        download.headers.get("content-disposition") ?? "",
        /%EF%BF%BD/,
      );
    }
  } finally {
    await f.close();
  }
});
