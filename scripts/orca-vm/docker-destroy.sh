#!/usr/bin/env bash
# Orca recipe `destroy`: remove the workspace container and its known_hosts entry.
set -euo pipefail
# shellcheck source=scripts/orca-vm/docker-common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/docker-common.sh"

resource_id="$(payload_resource_id "$(cat)")"
[ -n "$resource_id" ] || die "no resource id or instance id in lifecycle payload"

if ! docker container inspect "$resource_id" >/dev/null 2>&1; then
  log "$resource_id already gone"
  exit 0
fi

# Capture the endpoint identity while the container still exists (start it if stopped).
port=""
host_key=""
if [ "$(docker inspect -f '{{.State.Running}}' "$resource_id")" = "true" ]; then
  port="$(container_ssh_port "$resource_id" || true)"
  host_key="$(container_host_key "$resource_id" || true)"
fi

docker rm -f "$resource_id" >/dev/null
[ -n "$port" ] && [ -n "$host_key" ] && forget_host_key "$port" "$host_key"
log "removed $resource_id"
