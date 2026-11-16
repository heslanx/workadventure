#!/usr/bin/env bash
# Orca recipe `suspend`: stop the workspace container; its filesystem and host keys persist.
set -euo pipefail
# shellcheck source=scripts/orca-vm/docker-common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/docker-common.sh"

resource_id="$(payload_resource_id "$(cat)")"
[ -n "$resource_id" ] || die "no resource id in lifecycle payload"
docker stop "$resource_id" >/dev/null
log "stopped $resource_id"
