// Run in the built runtime container against the disposable portability fixture.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const phase = process.argv[2],
  base = process.env.STICKER_SMOKE_API_URL ?? "http://127.0.0.1:8787",
  origin = process.env.APP_ORIGIN;
assert.ok(["initialize", "verify"].includes(phase));
assert.ok(process.env.OWNER_PASSWORD, "Disposable fixture password required");
const login = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ password: process.env.OWNER_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { cookie, origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
}
const bootstrap = await api("/bootstrap"),
  project = bootstrap.projects.find((p) => p.name === "Portable fixture"),
  issue = bootstrap.issues.find((i) => i.title === "Persisted container issue");
assert.ok(project && issue, "Only the disposable core fixture is accepted");
const draftText = "# Verified container release draft\n";
if (phase === "initialize") {
  const source = await api("/versions", "POST", {
      projectId: project.id,
      name: "Container release fixture",
    }),
    next = await api("/versions", "POST", {
      projectId: project.id,
      name: "Container next fixture",
    });
  const updated = await api(`/issues/${issue.id}`, "PATCH", {
    revision: issue.revision,
    targetVersionId: source.id,
    foundVersionId: source.id,
    fixedVersionId: source.id,
  });
  const draft = await api(`/versions/${source.id}/changelog/generate`, "POST", {
    revision: 0,
    selectedIssueIds: [issue.id],
  });
  assert.ok(
    draft.markdown.includes(`#project=${project.id}&issue=${issue.id}`),
  );
  await api(`/versions/${source.id}/changelog`, "PUT", {
    revision: draft.revision,
    selectedIssueIds: [issue.id],
    markdown: draftText,
  });
  const input = {
    revision: source.revision,
    destinationVersionId: next.id,
    destinationRevision: next.revision,
    operationId: randomUUID(),
    issues: [{ issueId: issue.id, revision: updated.revision }],
  };
  assert.equal(
    (await api(`/versions/${source.id}/carryover/preview`, "POST", input))
      .items[0].outcome,
    "ready",
  );
  assert.equal(
    (await api(`/versions/${source.id}/carryover`, "POST", input)).items[0]
      .outcome,
    "moved",
  );
  const confirmation = {
    revision: source.revision,
    operationId: randomUUID(),
    confirm: true,
  };
  const released = await api(
    `/versions/${source.id}/release`,
    "POST",
    confirmation,
  );
  assert.equal(released.version.state, "released");
  assert.deepEqual(
    await api(`/versions/${source.id}/release`, "POST", confirmation),
    released,
  );
} else {
  const source = bootstrap.versions.find(
      (v) => v.name === "Container release fixture",
    ),
    next = bootstrap.versions.find((v) => v.name === "Container next fixture");
  assert.ok(source && next);
  const readiness = await api(`/versions/${source.id}/readiness`);
  assert.equal(readiness.version.state, "released");
  assert.equal(readiness.releaseHistory.length, 1);
  assert.equal(readiness.releaseHistory[0].authorId, "owner");
  assert.equal(readiness.counts.total, 0);
  assert.equal(readiness.foundIssues[0].id, issue.id);
  assert.equal(readiness.fixedIssues[0].id, issue.id);
  assert.equal(issue.targetVersionId, next.id);
  assert.equal(issue.foundVersionId, source.id);
  assert.equal(issue.fixedVersionId, source.id);
  const draft = await api(`/versions/${source.id}/changelog`);
  assert.equal(draft.revision, 2);
  assert.equal(draft.markdown, draftText);
}
console.log(`Container release smoke passed: ${phase}`);
