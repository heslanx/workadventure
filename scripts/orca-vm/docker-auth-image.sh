#!/usr/bin/env bash
# Build the authenticated image in two phases around an interactive login the user runs.
#   docker-auth-image.sh start   -> boots an auth container from the base image and prints login commands
#   docker-auth-image.sh commit  -> verifies both agents are signed in, then commits the auth image
set -euo pipefail
# shellcheck source=scripts/orca-vm/docker-common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/docker-common.sh"

phase="${1:-}"

case "$phase" in
  start)
    docker image inspect "$base_image" >/dev/null 2>&1 \
      || die "base image $base_image missing; run scripts/orca-vm/docker-base-image.sh first"
    if docker container inspect "$auth_container" >/dev/null 2>&1; then
      log "reusing running auth container $auth_container"
    else
      docker run -d --name "$auth_container" --entrypoint sleep "$base_image" infinity >/dev/null
    fi
    cat >&2 <<EOF
Run these in your own terminal, then run: scripts/orca-vm/docker-auth-image.sh commit
  docker exec -it -u node $auth_container claude auth login
  docker exec -it -u node $auth_container codex login --device-auth
EOF
    jq -n --arg c "$auth_container" '{authContainer: $c, phase: "awaiting-login"}'
    ;;
  commit)
    docker container inspect "$auth_container" >/dev/null 2>&1 \
      || die "auth container $auth_container not found; run '$0 start' first"
    # Exit codes, not text: both CLIs exit non-zero when signed out.
    docker exec -u node "$auth_container" claude auth status >&2 \
      || die "claude is not signed in inside $auth_container; refusing to commit"
    docker exec -u node "$auth_container" codex login status >&2 \
      || die "codex is not signed in inside $auth_container; refusing to commit"
    # No host keys, desktop keys or Git token may be baked into the shared image.
    docker exec "$auth_container" sh -c 'rm -f /etc/ssh/ssh_host_* /home/node/.ssh/authorized_keys /home/node/.config/gh/hosts.yml'
    docker commit \
      --change 'ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]' \
      --change 'CMD []' \
      --change 'USER root' \
      "$auth_container" "$auth_image" >/dev/null
    docker rm -f "$auth_container" >/dev/null
    log "committed $auth_image and removed $auth_container"
    docker image inspect "$auth_image" \
      --format '{"authImage":"{{index .RepoTags 0}}","imageId":"{{.Id}}","entrypoint":{{json .Config.Entrypoint}}}'
    ;;
  *)
    die "usage: $0 start|commit"
    ;;
esac
