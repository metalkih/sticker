// Disposable API fixture; verifies template provenance across recreate/restore.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const phase = process.argv[2],
  base = process.env.STICKER_SMOKE_API_URL ?? "http://127.0.0.1:8787",
  origin = process.env.APP_ORIGIN;
assert.ok(["initialize", "verify"].includes(phase));
assert.ok(process.env.OWNER_PASSWORD);
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
const name = "Container template fixture",
  title = "Container template provenance fixture";
if (phase === "initialize") {
  const project = await api("/projects", "POST", { name, key: "TPL" });
  const detail = await api(`/projects/${project.id}/templates`, "POST", {
    name,
    body: "Original template body",
    requiredFields: ["verification"],
    defaults: { priority: "high" },
    operationId: randomUUID(),
  });
  const input = {
    projectId: project.id,
    title,
    templateId: detail.template.id,
    templateVersion: 1,
    templateValues: { verification: "Container restart and backup restore" },
    operationId: randomUUID(),
  };
  const issue = await api("/issues", "POST", input);
  assert.equal((await api("/issues", "POST", input)).id, issue.id);
  await api(`/templates/${detail.template.id}`, "PATCH", {
    revision: detail.template.revision,
    name,
    body: "Updated template body",
    requiredFields: [],
    defaults: { priority: "low" },
  });
}
const state = await api("/bootstrap"),
  project = state.projects.find((p) => p.name === name),
  matches = state.issues.filter((i) => i.title === title);
assert.ok(project);
assert.equal(matches.length, 1);
const issue = matches[0];
assert.equal(issue.projectId, project.id);
assert.equal(issue.templateVersion, 1);
assert.equal(issue.priority, "high");
assert.ok(issue.description.includes("Original template body"));
assert.ok(issue.description.includes("Container restart and backup restore"));
assert.equal(issue.description.includes("Updated template body"), false);
const detail = await api(`/templates/${issue.templateId}`);
assert.equal(detail.template.currentVersion, 2);
assert.equal(detail.versions.length, 2);
assert.equal(detail.versions[0].body === detail.versions[1].body, false);
console.log(`Container templates smoke passed: ${phase}`);
