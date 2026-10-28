#!/usr/bin/env bash
# Offline, consistent backup of the named data volume. No credentials are archived.
set -euo pipefail
script_dir=${BASH_SOURCE[0]%/*}
[[ "$script_dir" != "${BASH_SOURCE[0]}" ]] || script_dir=.
source "$script_dir/host-tools.sh"
sticker_require_commands backup docker dirname tar date mkdir mv rm
cd "$script_dir/.."
archive=${1:-"backups/sticker-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"}
if [[ -e "$archive" || -e "$archive.tmp" ]]; then echo "Refusing to overwrite $archive" >&2; exit 1; fi
mkdir -p "$(dirname "$archive")"
umask 077
was_running=$(docker compose ps --status running --quiet sticker)
restart() { if [[ -n "$was_running" ]]; then docker compose start sticker >&2; fi; }
trap 'status=$?; rm -f "$archive.tmp"; restart; exit "$status"' EXIT
# Wait for the application process to close SQLite before copying DB + uploads together.
docker compose stop -t 30 sticker >&2
docker compose run --rm --no-deps -T --entrypoint tar sticker -C /app/data -czf - . > "$archive.tmp"
tar -tzf "$archive.tmp" >/dev/null
mv "$archive.tmp" "$archive"
printf 'Backup saved: %s\n' "$archive"
