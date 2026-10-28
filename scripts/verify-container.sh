#!/usr/bin/env bash
# Disposable end-to-end verification: never use an operator's Compose project/data.
set -euo pipefail
script_dir=${BASH_SOURCE[0]%/*}
[[ "$script_dir" != "${BASH_SOURCE[0]}" ]] || script_dir=.
source "$script_dir/host-tools.sh"
sticker_require_commands verification docker bash dirname tar date mkdir mv rm grep awk mktemp chmod mkfifo
cd "$script_dir/.."
root=$PWD
docker compose version >/dev/null
project="sticker-portability-$$-$RANDOM"
temporary=$(mktemp -d "${TMPDIR:-/tmp}/sticker-container.XXXXXX")
export COMPOSE_PROJECT_NAME=$project COMPOSE_FILE="$root/compose.yaml" COMPOSE_PATH_SEPARATOR=:
unset COMPOSE_ENV_FILES
export COMPOSE_PROFILES= COMPOSE_DISABLE_ENV_FILE=1
export STICKER_IMAGE="$project:fixture" STICKER_PORT=0
export OWNER_PASSWORD="fixture-only-$RANDOM-$RANDOM-$RANDOM-$RANDOM"
export APP_ORIGIN=http://localhost:8787 SECURE_COOKIES=false AGENT_CONFIG_PATH=
export STICKER_AGENT_TOKEN= STICKER_AGENT_CONFIG=
mcp_pid=
compose() { docker compose --env-file /dev/null "$@"; }
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$mcp_pid" ]]; then
    docker rm -f "$project-mcp" >/dev/null 2>&1 || true
    kill "$mcp_pid" 2>/dev/null || true
    wait "$mcp_pid" 2>/dev/null || true
  fi
  if (( status != 0 )); then compose logs --no-color --tail=80 sticker >&2 || true; fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$STICKER_IMAGE" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose config --quiet
compose build --pull sticker
# Launcher boundary tests use only built-in Node APIs and Bash in the image.
docker run --rm --network none --entrypoint node \
  --mount "type=bind,source=$root,target=/verification,readonly" --workdir /verification \
  "$STICKER_IMAGE" --test tests/container.test.mjs tests/host-tools.test.mjs
# Generated only in this disposable test; never persisted in the checkout/logs.
OWNER_PASSWORD=$(docker run --rm --network none --entrypoint node "$STICKER_IMAGE" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
export OWNER_PASSWORD
compose up -d --wait --wait-timeout 90 sticker
compose exec -T sticker node --input-type=module - initialize < tests/container-smoke.mjs
compose up -d --force-recreate --wait --wait-timeout 90 sticker
compose exec -T sticker node --input-type=module - verify < tests/container-smoke.mjs
bash scripts/backup.sh "$temporary/fixture.tar.gz"
compose exec -T sticker node --input-type=module - mutate < tests/container-smoke.mjs
bash scripts/restore.sh "$temporary/fixture.tar.gz" --replace-data
compose up -d --wait --wait-timeout 90 sticker
compose exec -T sticker node --input-type=module - verify < tests/container-smoke.mjs

# Agent access is optional. Add a generated read-only grant only after core tests.
STICKER_AGENT_TOKEN=$(docker run --rm --network none --entrypoint node "$STICKER_IMAGE" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
export STICKER_AGENT_TOKEN STICKER_AGENT_CONFIG="$temporary/agents.json"
docker run --rm --network none -e STICKER_AGENT_TOKEN --entrypoint node "$STICKER_IMAGE" -e 'const crypto=require("node:crypto"); process.stdout.write(JSON.stringify([{id:"container-fixture",name:"Container fixture",tokenHash:crypto.createHash("sha256").update(process.env.STICKER_AGENT_TOKEN).digest("hex"),projectIds:null,canWrite:false}]))' > "$STICKER_AGENT_CONFIG"
chmod 644 "$STICKER_AGENT_CONFIG" # Contains only the disposable fixture hash.
export COMPOSE_FILE="$root/compose.yaml:$root/compose.agents.yaml"
compose up -d --force-recreate --wait --wait-timeout 90 sticker
# Open both FIFOs read/write first so neither container blocks while opening stdin.
mkfifo "$temporary/to-mcp" "$temporary/from-mcp"
exec 3<>"$temporary/to-mcp" 4<>"$temporary/from-mcp"
compose run --name "$project-mcp" --rm --no-deps -T -e STICKER_AGENT_TOKEN mcp <&3 >&4 &
mcp_pid=$!
# The client itself needs no Docker socket, credentials, host Node or network.
docker run --rm -i --network none --entrypoint node \
  --mount "type=bind,source=$root/tests/container-mcp.mjs,target=/app/container-mcp.mjs,readonly" \
  "$STICKER_IMAGE" /app/container-mcp.mjs <&4 >&3
docker rm -f "$project-mcp" >/dev/null
wait "$mcp_pid" 2>/dev/null || true
mcp_pid=
exec 3>&- 4>&-
printf 'Container verification passed: clean build, private API, persisted SQLite/uploads, backup/restore and optional STDIO MCP.\n'
