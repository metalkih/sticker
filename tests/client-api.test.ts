import test from "node:test";
import assert from "node:assert/strict";
import { api, ApiError } from "../client/api.js";

for (const headers of [
  new Headers({ authorization: "Bearer fixture" }),
  [["authorization", "Bearer fixture"]],
  { authorization: "Bearer fixture" },
] satisfies HeadersInit[]) {
  void test("API preserves every HeadersInit form and caller Content-Type", async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const sent = new Headers(init?.headers);
        assert.equal(sent.get("authorization"), "Bearer fixture");
        assert.equal(sent.get("content-type"), "application/json");
        assert.equal(init?.credentials, "same-origin");
        return Promise.resolve(new Response("{}"));
      },
    );
    await api("/fixture", { method: "POST", body: "{}", headers });
  });
}
void test("API does not force JSON headers on FormData and honors explicit media types", async (t) => {
  const seen: Headers[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  );
  await api("/fixture", { method: "POST", body: new FormData() });
  await api("/fixture", {
    method: "POST",
    body: "{}",
    headers: new Headers({ "content-type": "application/custom+json" }),
  });
  assert.equal(seen[0].get("content-type"), null);
  assert.equal(seen[1].get("content-type"), "application/custom+json");
});
void test("API rejects malformed error fields without surfacing objects as messages", async (t) => {
  for (const body of [
    "null",
    '"failure"',
    '{"error":{},"code":42}',
    "not json",
  ]) {
    t.mock.method(globalThis, "fetch", () =>
      Promise.resolve(new Response(body, { status: 400 })),
    );
    await assert.rejects(
      api("/fixture"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "REQUEST_FAILED" &&
        error.message === "요청을 처리하지 못했어요 (400).",
    );
    t.mock.restoreAll();
  }
});

void test("typed API responses validate JSON and never return undefined for a required schema", async (t) => {
  const { projectSchema } = await import("../server/response-schemas.js");
  t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  await assert.rejects(api("/projects/fixture", undefined, projectSchema));
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response('{"id":42}')),
  );
  await assert.rejects(api("/projects/fixture", undefined, projectSchema));
});
