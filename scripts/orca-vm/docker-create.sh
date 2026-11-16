#!/usr/bin/env bash
# Orca recipe `create`: boot one container per workspace from the authenticated image, print SSH target JSON.
set -euo pipefail
# shellcheck source=scripts/orca-vm/docker-common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/docker-common.sh"

instance_id="${ORCA_VM_INSTANCE_ID:-}"
[ -n "$instance_id" ] || die "ORCA_VM_INSTANCE_ID is not set"
name="$(container_name "$instance_id")"

docker image inspect "$auth_image" >/dev/null 2>&1 \
  || die "authenticated image $auth_image missing; run docker-base-image.sh, then docker-auth-image.sh start/commit"
ensure_ssh_key

created=0
cleanup_on_error() {
  if [ "$created" = 1 ]; then
    log "create failed; removing $name"
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
}
trap cleanup_on_error ERR

# Idempotent per instance id: a retried create reuses the same container.
if docker container inspect "$name" >/dev/null 2>&1; then
  log "reusing container $name"
  docker start "$name" >/dev/null
else
  log "starting $name from $auth_image"
  docker run -d --name "$name" \
    --label "io.orca.recipe=workadventure-docker" \
    --label "io.orca.instance=$instance_id" \
    -p 127.0.0.1::22 \
    -e "ORCA_SSH_PUBLIC_KEY=$(cat "$ssh_key.pub")" \
    "$auth_image" >/dev/null
  created=1
fi

wait_for_sshd "$name"
port="$(container_ssh_port "$name")"
[ -n "$port" ] || die "no published SSH port for $name"
record_host_key "$name" "$port"

# Git credentials: the desktop's gh token goes in over stdin, never into a file we write or an argv.
if gh_token="$(gh auth token 2>/dev/null)" && [ -n "$gh_token" ]; then
  printf '%s\n' "$gh_token" \
    | docker exec -i -u node "$name" gh auth login --hostname github.com --git-protocol https --with-token >&2
  docker exec -u node "$name" gh auth setup-git >&2
  unset gh_token
else
  log "warning: no desktop gh token; the environment can fetch the public repo but cannot push"
fi

# Bring the primary checkout to the latest $repo_ref; Orca creates the workspace worktree from it.
docker exec -u node "$name" bash -lc "$(printf \
  'set -euo pipefail; export GIT_TERMINAL_PROMPT=0; cd %q; git fetch --quiet upstream; git fetch --quiet origin %q; git checkout --quiet -B %q FETCH_HEAD' \
  "$project_root" "$repo_ref" "$repo_ref")" >&2

ssh_smoke_test "$port"
trap - ERR
emit_result "$name" "$port"
