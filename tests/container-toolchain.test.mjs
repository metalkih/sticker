import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const digest = "a".repeat(64);
function readToolchain(source) {
  const root = mkdtempSync(join(tmpdir(), "sticker toolchain "));
  try {
    const dockerfile = join(root, "Dockerfile");
    writeFileSync(dockerfile, source);
    return spawnSync("bash", ["scripts/container-toolchain.sh", dockerfile], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("toolchain reader exposes exact Node patch and immutable shared base for CI", () => {
  const result = readToolchain(
    `FROM node:24.22.1-bookworm-slim@sha256:${digest} AS base\nFROM base AS build\nFROM base AS runtime\n`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `node_version=24.22.1\nnode_image=node:24.22.1-bookworm-slim@sha256:${digest}\nnode_index_digest=sha256:${digest}\n`,
  );
});
for (const image of [
  "node:24-bookworm-slim",
  "node:24.22.1-bookworm-slim",
  `node:26.12.1-bookworm-slim@sha256:${digest}`,
  `untrusted/node:24.22.1-bookworm-slim@sha256:${digest}`,
  "node:24.22.1-bookworm-slim@sha256:short",
]) {
  test(`toolchain reader rejects unsupported or mutable reference ${image}`, () => {
    const result = readToolchain(
      `FROM ${image} AS base\nFROM base AS build\nFROM base AS runtime\n`,
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /pinned official Node 24 patch/);
  });
}
for (const source of [
  `FROM node:24.22.1-bookworm-slim@sha256:${digest} AS build\nFROM node:24.22.1-bookworm-slim@sha256:${digest} AS runtime\n`,
  `FROM node:24.22.1-bookworm-slim@sha256:${digest} AS base\nFROM base AS build\nFROM alpine:latest AS runtime\n`,
  "FROM base AS build\nFROM base AS runtime\n",
])
  test("toolchain reader rejects independent or missing build/runtime bases", () => {
    const result = readToolchain(source);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
  });

// Exercise the real consumer against the checked-in artifact, not a grep of its text.
test("checked-in Dockerfile is consumable as an immutable shared toolchain", () => {
  const result = spawnSync("bash", ["scripts/container-toolchain.sh"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^node_version=24\.\d+\.\d+\nnode_image=node:24\.\d+\.\d+-bookworm-slim@sha256:[a-f0-9]{64}\nnode_index_digest=sha256:[a-f0-9]{64}\n$/,
  );
});
