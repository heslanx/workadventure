#!/usr/bin/env bash
# Orca recipe `resume`: restart the container and re-emit the SSH target (the published port changes).
set -euo pipefail
# shellcheck source=scripts/orca-vm/docker-common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/docker-common.sh"

resource_id="$(payload_resource_id "$(cat)")"
[ -n "$resource_id" ] || die "no resource id in lifecycle payload"
ensure_ssh_key

docker start "$resource_id" >/dev/null
wait_for_sshd "$resource_id"
port="$(container_ssh_port "$resource_id")"
[ -n "$port" ] || die "no published SSH port for $resource_id"
record_host_key "$resource_id" "$port"
ssh_smoke_test "$port"
emit_result "$resource_id" "$port"
