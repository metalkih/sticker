import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  resourceCreateInputSchema,
  resourcePatchInputSchema,
  resourceUploadInputSchema,
  resourceLinkInputSchema,
  resourceReferenceInputSchema,
  resourceQuerySchema,
} from "../server/contracts/resources.js";
const base = {
  projectId: "legacy-project",
  title: "프로젝트 설계",
  operationId: randomUUID(),
};
void test("resource inputs preserve untrusted Markdown as data and reject forged identity/storage or unknown mutation fields", () => {
  const valid = {
    ...base,
    kind: "markdown",
    markdown:
      "<script>alert(1)</script>\n![remote](https://example.invalid/image.svg)",
  };
  assert.equal(resourceCreateInputSchema.safeParse(valid).success, true);
  for (const extra of [
    { authorId: "owner" },
    { isGuidance: true },
    { storageKey: randomUUID() },
    { fetchUrl: "https://example.invalid/" },
  ])
    assert.equal(
      resourceCreateInputSchema.safeParse({ ...valid, ...extra }).success,
      false,
    );
});
void test("link resource contracts accept only credential-free http(s) links; URLs never stand in for resource IDs", () => {
  for (const url of [
    "https://example.invalid/docs?q=1#part",
    "http://localhost:9000/reference",
  ])
    assert.equal(
      resourceCreateInputSchema.safeParse({ ...base, kind: "link", url })
        .success,
      true,
    );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "file:///etc/passwd",
    "https://user:secret@example.invalid/",
  ])
    assert.equal(
      resourceCreateInputSchema.safeParse({ ...base, kind: "link", url })
        .success,
      false,
    );
  assert.equal(
    resourceLinkInputSchema.safeParse({
      resourceId: "https://example.invalid/doc",
      resourceVersion: 1,
      issueRevision: 1,
      operationId: randomUUID(),
    }).success,
    false,
  );
});
void test("resource updates and links require revision and operation preconditions; result references pin an exact positive version", () => {
  const patch = {
    revision: 1,
    operationId: randomUUID(),
    title: "변경",
    markdown: "새 내용",
  };
  assert.equal(resourcePatchInputSchema.safeParse(patch).success, true);
  for (const input of [
    { ...patch, revision: 0 },
    { title: "missing" },
    { ...patch, kind: "link" },
    { ...patch, projectId: "foreign" },
  ])
    assert.equal(resourcePatchInputSchema.safeParse(input).success, false);
  const linked = {
    resourceId: randomUUID(),
    resourceVersion: 1,
    issueRevision: 2,
    operationId: randomUUID(),
  };
  assert.equal(resourceLinkInputSchema.safeParse(linked).success, true);
  const reference = {
    sessionId: "session",
    eventId: "result-1",
    resourceId: randomUUID(),
    resourceVersion: 1,
    operationId: randomUUID(),
  };
  assert.equal(resourceReferenceInputSchema.safeParse(reference).success, true);
  assert.equal(
    resourceReferenceInputSchema.safeParse({ ...reference, resourceVersion: 0 })
      .success,
    false,
  );
  assert.equal(
    resourceReferenceInputSchema.safeParse({
      ...reference,
      resourceVersion: undefined,
    }).success,
    false,
  );
  assert.equal(
    resourceReferenceInputSchema.safeParse({ ...reference, agentId: "owner" })
      .success,
    false,
  );
});
void test("file upload metadata excludes claimed MIME, bytes, storage paths and guidance while scoped queries reject unrecognized options", () => {
  assert.equal(resourceUploadInputSchema.safeParse(base).success, true);
  for (const extra of [
    { storageKey: "../../private" },
    { mimeType: "image/svg+xml" },
    { size: 1 },
    { authorId: "owner" },
    { isGuidance: true },
  ])
    assert.equal(
      resourceUploadInputSchema.safeParse({ ...base, ...extra }).success,
      false,
    );
  assert.equal(
    resourceQuerySchema.safeParse({
      projectId: "project",
      versionId: "version",
      kind: "file",
      query: "개발",
    }).success,
    true,
  );
  assert.equal(
    resourceQuerySchema.safeParse({
      projectId: "project",
      url: "https://example.invalid",
    }).success,
    false,
  );
});
