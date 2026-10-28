#!/usr/bin/env bash
# Read-only prerequisite check. Source this before creating files or invoking Docker.
sticker_require_commands() {
  local operation=$1 tool
  shift
  local missing=()
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if (( ${#missing[@]} )); then
    printf 'Sticker %s: Missing required host tools: %s\n' "$operation" "${missing[*]}" >&2
    printf '%s\n' 'Install Docker Engine/Desktop with Compose v2 and standard POSIX tools; use Bash on Linux/macOS/WSL. See docs/INSTALL.md.' >&2
    return 2
  fi
}
