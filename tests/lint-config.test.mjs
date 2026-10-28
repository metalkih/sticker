import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
test("strict lint catches unsafe types, unhandled promises, hooks", async () => {
  const results = await eslint.lintText(
    `import { useState } from 'react';
export function Probe({ active }: { active: boolean }) {
  const unsafe: any = JSON.parse('{}');
  if (active) useState(0);
  Promise.resolve(unsafe);
  return <img src="example.png" />;
}`,
    { filePath: "client/App.tsx" },
  );
  const rules = new Set(
    results.flatMap((result) =>
      result.messages.map((message) => message.ruleId),
    ),
  );
  for (const rule of [
    "@typescript-eslint/no-explicit-any",
    "@typescript-eslint/no-floating-promises",
    "react-hooks/rules-of-hooks",
  ]) {
    assert.ok(
      rules.has(rule),
      `Expected active rule ${rule}; received ${[...rules].join(", ")}`,
    );
  }
});
test("source, tests and config are included while generated artifacts are excluded", async () => {
  for (const file of [
    "server/domain.ts",
    "client/App.tsx",
    "tests/domain.test.ts",
    "eslint.config.mjs",
  ]) {
    assert.equal(await eslint.isPathIgnored(file), false, file);
  }
  for (const file of [
    "dist/server/index.js",
    "node_modules/example/index.js",
    "test-results/output.js",
  ]) {
    assert.equal(await eslint.isPathIgnored(file), true, file);
  }
});

test("hooks also apply to non-JSX TypeScript modules", async () => {
  const [result] = await eslint.lintText(
    "import { useState } from 'react'; export function useProbe(enabled: boolean) { if (enabled) useState(0); }",
    { filePath: "client/scroll-lock.ts" },
  );
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === "react-hooks/rules-of-hooks",
    ),
  );
});
test("JavaScript environment globals do not leak between server and browser", async () => {
  const [server] = await eslint.lintText("console.log(document.title);", {
    filePath: "server/probe.mjs",
  });
  const [client] = await eslint.lintText("console.log(process.pid);", {
    filePath: "client/probe.js",
  });
  assert.ok(server.messages.some((message) => message.ruleId === "no-undef"));
  assert.ok(client.messages.some((message) => message.ruleId === "no-undef"));
});

test("typed lint enforces server and test files, not only React UI", async () => {
  for (const filePath of ["server/domain.ts", "tests/domain.test.ts"]) {
    const [result] = await eslint.lintText(
      "export const unsafe: any = JSON.parse('{}'); Promise.resolve(unsafe);",
      { filePath },
    );
    assert.ok(
      result.messages.some(
        (message) => message.ruleId === "@typescript-eslint/no-explicit-any",
      ),
      filePath,
    );
    assert.ok(
      result.messages.some(
        (message) =>
          message.ruleId === "@typescript-eslint/no-floating-promises",
      ),
      filePath,
    );
  }
});
