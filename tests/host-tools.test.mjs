import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const commands = [
  "dirname",
  "docker",
  "tar",
  "date",
  "mkdir",
  "mv",
  "rm",
  "grep",
  "awk",
  "mktemp",
  "chmod",
  "mkfifo",
  "bash",
];
function fixture(missing) {
  const root = mkdtempSync(join(tmpdir(), "sticker host tools "));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "source"));
  for (const name of [
    "backup.sh",
    "restore.sh",
    "verify-container.sh",
    "host-tools.sh",
  ]) {
    if (existsSync(`scripts/${name}`))
      copyFileSync(`scripts/${name}`, join(root, "scripts", name));
  }
  for (const command of commands) {
    if (command === missing || command === "docker") continue;
    const path = execFileSync(
      "/bin/bash",
      ["-c", 'command -v "$1"', "resolve", command],
      { encoding: "utf8" },
    ).trim();
    symlinkSync(path, join(root, "bin", command));
  }
  if (missing !== "docker")
    writeFileSync(
      join(root, "bin/docker"),
      '#!/bin/bash\nprintf called > "$FIXTURE_DOCKER_CALL"\nexit 91\n',
      { mode: 0o755 },
    );
  writeFileSync(
    join(root, "source", "sticker.sqlite"),
    "fixture must not be read or restored",
  );
  execFileSync("tar", [
    "-czf",
    join(root, "archive.tar.gz"),
    "-C",
    join(root, "source"),
    ".",
  ]);
  return {
    root,
    run: (script, args) =>
      spawnSync("/bin/bash", [join(root, "scripts", script), ...args], {
        cwd: tmpdir(),
        env: {
          ...process.env,
          PATH: join(root, "bin"),
          FIXTURE_DOCKER_CALL: join(root, "docker-called"),
          TMPDIR: root,
        },
        encoding: "utf8",
      }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

for (const [script, required] of [
  ["backup.sh", ["docker", "dirname", "tar", "date", "mkdir", "mv", "rm"]],
  ["restore.sh", ["docker", "tar", "grep", "awk"]],
  [
    "verify-container.sh",
    [
      "docker",
      "bash",
      "dirname",
      "tar",
      "date",
      "mkdir",
      "mv",
      "rm",
      "grep",
      "awk",
      "mktemp",
      "chmod",
      "mkfifo",
    ],
  ],
]) {
  for (const missing of required)
    test(`${script} refuses missing ${missing} before Docker or output mutations`, () => {
      const f = fixture(missing);
      try {
        const args =
          script === "backup.sh"
            ? [join(f.root, "output", "backup.tar.gz")]
            : script === "restore.sh"
              ? [join(f.root, "archive.tar.gz"), "--replace-data"]
              : [];
        const before = readdirSync(f.root).sort();
        const result = f.run(script, args);
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /Missing required host tools/);
        assert.ok(result.stderr.includes(missing), result.stderr);
        assert.match(result.stderr, /docs\/INSTALL\.md/);
        assert.deepEqual(
          readdirSync(f.root).sort(),
          before,
          "No fixture filesystem changes may precede validation",
        );
        assert.ok(
          !existsSync(join(f.root, "docker-called")),
          "No Docker operation may precede tool validation",
        );
        assert.ok(
          !existsSync(join(f.root, "output")),
          "No backup output directory may be created",
        );
        assert.ok(
          !existsSync(join(f.root, "sticker-container")),
          "No verification resources may be created",
        );
      } finally {
        f.close();
      }
    });
}
