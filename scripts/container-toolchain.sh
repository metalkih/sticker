#!/usr/bin/env bash
# Validate this repository's canonical three-stage Dockerfile, then emit CI outputs.
# No network, Docker daemon, package manager or mutable tag lookup is performed.
set -euo pipefail
script_dir=${BASH_SOURCE[0]%/*}
[[ "$script_dir" != "${BASH_SOURCE[0]}" ]] || script_dir=.
dockerfile=${1:-"$script_dir/../Dockerfile"}
fail() { printf '%s\n' 'Expected one pinned official Node 24 patch + multi-architecture index digest AS base, with build/runtime inheriting base. See docs/REPRODUCIBILITY.md.' >&2; exit 2; }
[[ -r "$dockerfile" ]] || fail
base_count=0 build_count=0 runtime_count=0
node_version= node_image= node_digest=
while IFS= read -r line || [[ -n "$line" ]]; do
  read -r directive reference keyword stage extra <<< "$line"
  [[ "$directive" == FROM ]] || continue
  [[ "$keyword" == AS && -z "$extra" ]] || fail
  if [[ "$reference" =~ ^node:(24\.[0-9]+\.[0-9]+)-bookworm-slim@sha256:([a-f0-9]{64})$ ]]; then
    [[ "$stage" == base && "$base_count" == 0 ]] || fail
    node_version=${BASH_REMATCH[1]}
    node_digest=${BASH_REMATCH[2]}
    node_image=$reference
    base_count=1
  elif [[ "$reference" == base && "$base_count" == 1 ]]; then
    case "$stage" in
      build) (( build_count += 1 ));;
      runtime) (( runtime_count += 1 ));;
      *) fail;;
    esac
  else fail
  fi
done < "$dockerfile"
[[ "$base_count" == 1 && "$build_count" == 1 && "$runtime_count" == 1 ]] || fail
printf 'node_version=%s\nnode_image=%s\nnode_index_digest=sha256:%s\n' "$node_version" "$node_image" "$node_digest"
