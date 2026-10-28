#!/usr/bin/env bash
# One foreground STDIO adapter. The owner starts the HTTP service separately.
set -euo pipefail
cd "$(dirname "$0")/.."
token=${STICKER_AGENT_TOKEN:-}
if [[ ${#token} -lt 16 ]]; then
  echo 'STICKER_AGENT_TOKEN must contain an owner-configured agent token (at least 16 characters).' >&2
  exit 2
fi
export STICKER_AGENT_TOKEN
exec docker compose run --rm --no-deps -T -e STICKER_AGENT_TOKEN mcp
