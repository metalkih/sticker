import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
void test("the application has a real React entrypoint, not an absent preview", () => {
  assert.ok(
    existsSync(new URL("../../client/main.tsx", import.meta.url)),
    "React entrypoint must exist",
  );
});
