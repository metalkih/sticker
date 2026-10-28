import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "sticker-mcp-launcher-"));
  mkdirSync(join(directory, "scripts"));
  mkdirSync(join(directory, "bin"));
  copyFileSync("scripts/mcp.sh", join(directory, "scripts/mcp.sh"));
  writeFileSync(
    join(directory, "bin/docker"),
    `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' "$PWD" "$@" > "$FIXTURE_CALL"\nprintf '%s' "\${STICKER_AGENT_TOKEN:-}" > "$FIXTURE_TOKEN"\nexit "\${FIXTURE_EXIT:-0}"\n`,
    { mode: 0o755 },
  );
  const environment = {
    ...process.env,
    PATH: `${join(directory, "bin")}:${process.env.PATH}`,
    STICKER_AGENT_TOKEN: "fixture-only-not-a-live-grant",
    FIXTURE_CALL: join(directory, "call"),
    FIXTURE_TOKEN: join(directory, "token"),
  };
  return {
    directory,
    environment,
    run: () =>
      spawnSync("bash", [join(directory, "scripts/mcp.sh")], {
        cwd: tmpdir(),
        env: environment,
        encoding: "utf8",
      }),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("MCP launcher refuses absent or undersized tokens without invoking Docker", () => {
  const f = fixture();
  try {
    for (const token of [undefined, "", "short"]) {
      if (token === undefined) delete f.environment.STICKER_AGENT_TOKEN;
      else f.environment.STICKER_AGENT_TOKEN = token;
      const result = f.run();
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /STICKER_AGENT_TOKEN/);
      assert.throws(() => readFileSync(f.environment.FIXTURE_CALL));
    }
  } finally {
    f.close();
  }
});

test("MCP launcher runs one disposable non-TTY adapter from its installation, forwarding token only by environment", () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const call = readFileSync(f.environment.FIXTURE_CALL, "utf8")
      .trim()
      .split("\n");
    assert.deepEqual(call, [
      f.directory,
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "-e",
      "STICKER_AGENT_TOKEN",
      "mcp",
    ]);
    assert.equal(
      readFileSync(f.environment.FIXTURE_TOKEN, "utf8"),
      f.environment.STICKER_AGENT_TOKEN,
    );
    assert.ok(!call.includes(f.environment.STICKER_AGENT_TOKEN));
  } finally {
    f.close();
  }
});

test("MCP launcher propagates adapter failure for the client to observe", () => {
  const f = fixture();
  try {
    f.environment.FIXTURE_EXIT = "43";
    assert.equal(f.run().status, 43);
  } finally {
    f.close();
  }
});
