// Run only against the disposable loopback container fixture, never an operator workspace.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const phase = process.argv[2],
  base = process.env.STICKER_SMOKE_API_URL ?? "http://127.0.0.1:8787",
  origin = process.env.APP_ORIGIN,
  target = new URL(base);
assert.ok(["initialize", "verify"].includes(phase));
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
assert.ok(["http:", "https:"].includes(target.protocol));
assert.ok(!target.username && !target.password && target.pathname === "/");
assert.ok(
  process.env.OWNER_PASSWORD && origin,
  "Disposable fixture configuration required",
);
const login = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ password: process.env.OWNER_PASSWORD }),
  signal: AbortSignal.timeout(15000),
  redirect: "error",
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
async function request(path, method = "GET", body, expected = 200) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      cookie,
      origin,
      ...(body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response;
}
async function api(path, method = "GET", body, expected = 200) {
  return (await request(path, method, body, expected)).json();
}
function form(metadata, bytes, name) {
  const body = new FormData();
  body.append("metadata", JSON.stringify(metadata));
  body.append("file", new Blob([bytes], { type: "image/svg+xml" }), name);
  return body;
}
const state = await api("/bootstrap"),
  project = state.projects.find((row) => row.name === "Portable fixture"),
  core = state.issues.find((row) => row.title === "Persisted container issue"),
  owningVersion = state.versions.find(
    (row) => row.name === "Container next fixture",
  ),
  referenceTitle = "Container shared resource reference",
  guidanceTitle = "Container resource guidance",
  fileTitle = "Container immutable shared file",
  guidanceBytes = "# Container reference data\n",
  firstBytes = '<svg onload="untrusted()">Container version one</svg>\n',
  secondBytes = "Container immutable resource version two\n";
assert.ok(
  project && core && owningVersion,
  "Only the disposable core/release fixture is accepted",
);
assert.equal(core.projectId, project.id);
assert.equal(owningVersion.projectId, project.id);
if (phase === "initialize") {
  assert.equal(
    state.issues.some((row) => row.title === referenceTitle),
    false,
    "Initialize must not run twice",
  );
  assert.deepEqual(
    await api(`/resources?projectId=${project.id}`),
    [],
    "Disposable resource scope must start empty",
  );
  const reference = await api(
      "/issues",
      "POST",
      { projectId: project.id, title: referenceTitle },
      201,
    ),
    document = await api(
      "/resources",
      "POST",
      {
        projectId: project.id,
        title: guidanceTitle,
        kind: "markdown",
        markdown: guidanceBytes,
        operationId: randomUUID(),
      },
      201,
    );
  await api(`/resources/${document.resource.id}/guidance`, "PATCH", {
    revision: document.resource.revision,
    isGuidance: true,
    operationId: randomUUID(),
  });
  const create = {
      title: fileTitle,
      versionId: owningVersion.id,
      operationId: randomUUID(),
    },
    file = await api(
      `/projects/${project.id}/resources/files`,
      "POST",
      form(create, firstBytes, "reference.svg"),
      201,
    );
  assert.deepEqual(
    await api(
      `/projects/${project.id}/resources/files`,
      "POST",
      form(create, firstBytes, "reference.svg"),
      201,
    ),
    file,
  );
  const first = await api(
    `/issues/${core.id}/resources`,
    "POST",
    {
      resourceId: file.resource.id,
      resourceVersion: 1,
      issueRevision: core.revision,
      operationId: randomUUID(),
    },
    201,
  );
  await api(
    `/issues/${reference.id}/resources`,
    "POST",
    {
      resourceId: file.resource.id,
      resourceVersion: 1,
      issueRevision: reference.revision,
      operationId: randomUUID(),
    },
    201,
  );
  const currentCore = await api(`/issues/${core.id}`);
  await api(`/issues/${core.id}/resources/${first.id}`, "DELETE", {
    issueRevision: currentCore.issue.revision,
    operationId: randomUUID(),
  });
  const update = {
      revision: file.resource.revision,
      operationId: randomUUID(),
    },
    changed = await api(
      `/resources/${file.resource.id}/files`,
      "POST",
      form(update, secondBytes, "reference-v2.bin"),
    );
  assert.deepEqual(
    await api(
      `/resources/${file.resource.id}/files`,
      "POST",
      form(update, secondBytes, "reference-v2.bin"),
    ),
    changed,
  );
  await api(`/resources/${file.resource.id}`, "DELETE", {
    revision: changed.resource.revision,
    operationId: randomUUID(),
  });
}
const references = (await api("/bootstrap")).issues.filter(
  (row) => row.title === referenceTitle,
);
assert.equal(references.length, 1);
assert.equal(references[0].projectId, project.id);
const linked = await api(`/issues/${references[0].id}/resources`);
assert.equal(linked.length, 1);
assert.equal(linked[0].version.version, 1);
assert.equal(linked[0].resource.title, fileTitle);
assert.ok(linked[0].resource.deletedAt);
assert.equal(linked[0].resource.versionId, owningVersion.id);
assert.equal(linked[0].resource.versionAvailable, true);
assert.equal(
  (await api(`/issues/${core.id}/resources`)).length,
  0,
  "Unlinked source issue must stay unlinked",
);
const file = await api(`/resources/${linked[0].resource.id}`);
assert.equal(
  file.current,
  null,
  "Deleted current contents are unavailable, not replaced by a historical version",
);
assert.equal(file.history.length, 2);
assert.deepEqual(
  file.events.map((event) => event.action),
  ["created", "updated", "deleted"],
);
assert.equal(JSON.stringify(file).includes("storageKey"), false);
for (const [version, bytes] of [
  [1, firstBytes],
  [2, secondBytes],
]) {
  const path = `/resources/${file.resource.id}/versions/${version}/file?preview=1`;
  assert.equal(
    (await fetch(`${base}/api${path}`, { signal: AbortSignal.timeout(15000) }))
      .status,
    401,
  );
  const response = await request(path);
  assert.equal(
    await response.text(),
    bytes,
    `Immutable file version ${version} must persist`,
  );
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
}
const listed = await api(`/resources?projectId=${project.id}`);
assert.deepEqual(
  listed.map((resource) => resource.title),
  [guidanceTitle],
);
const guidance = await api(`/projects/${project.id}/guidance`);
assert.equal(guidance.length, 1);
assert.equal(guidance[0].resource.isGuidance, true);
assert.equal(guidance[0].resource.guidanceBy, "owner");
assert.equal(guidance[0].current.markdown, guidanceBytes);
assert.equal(guidance[0].current.authorId, "owner");
assert.equal(guidance[0].history.length, 1);
console.log(`Container resources smoke passed: ${phase}`);
