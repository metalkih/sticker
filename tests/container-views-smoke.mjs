// Fixture-only lifecycle check; no provider, token, or external account required.
import assert from "node:assert/strict";
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
const before = await api("/bootstrap"),
  project = before.projects.find((p) => p.name === "Portable fixture"),
  issue = before.issues.find((i) => i.title === "Persisted container issue");
assert.ok(project && issue, "Only the disposable core fixture is accepted");
const query = {
  projectId: project.id,
  query: "Persisted container issue",
  sort: "key_asc",
  mode: "list",
};
if (phase === "initialize") {
  const one = await api("/views", "POST", {
      name: "Container persisted view",
      query,
    }),
    two = await api("/views", "POST", {
      name: "Container favorite view",
      query: {
        projectId: project.id,
        sort: "priority_desc",
        mode: "board",
        inputRequested: false,
      },
    });
  const prefs = await api(`/view-preferences/${project.id}`);
  await api(`/view-preferences/${project.id}`, "PUT", {
    revision: prefs.revision,
    defaultViewId: one.id,
    favoriteIds: [two.id, one.id],
  });
}
const views = await api(`/views?projectId=${project.id}`),
  one = views.find((v) => v.name === "Container persisted view"),
  two = views.find((v) => v.name === "Container favorite view");
assert.ok(one && two);
assert.deepEqual(one.query, query);
assert.equal(one.actorId, "owner");
assert.equal(two.query.inputRequested, false);
const prefs = await api(`/view-preferences/${project.id}`);
assert.equal(prefs.defaultViewId, one.id);
assert.deepEqual(prefs.favoriteIds, [two.id, one.id]);
const matches = await api("/issues/query", "POST", one.query);
assert.deepEqual(matches.warnings, []);
assert.deepEqual(
  matches.issues.map((i) => i.id),
  [issue.id],
);
const after = await api("/bootstrap");
assert.deepEqual(after.issues, before.issues);
assert.equal(after.projects.length, before.projects.length);
assert.equal(after.versions.length, before.versions.length);
console.log(`Container saved views smoke passed: ${phase}`);
