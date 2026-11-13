#!/usr/bin/env bash
# Build the base image: toolchain, sshd, claude + codex CLIs (not signed in), and a clone of the repo.
# Run by hand from the repo root. Local and free, but takes ~10-20 minutes.
set -euo pipefail
# shellcheck source=scripts/orca-vm/docker-common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/docker-common.sh"

log "building $base_image from $repo_url ($repo_ref)"
docker build \
  --build-arg "REPO_URL=$repo_url" \
  --build-arg "UPSTREAM_URL=$upstream_url" \
  --build-arg "REPO_REF=$repo_ref" \
  --build-arg "PROJECT_ROOT=$project_root" \
  --tag "$base_image" \
  "$orca_vm_dir" >&2

# The image must not carry host keys or a signed-in agent.
if docker run --rm --entrypoint sh "$base_image" -c 'ls /etc/ssh/ssh_host_* 2>/dev/null' | grep -q .; then
  die "base image ships SSH host keys"
fi

docker image inspect "$base_image" --format '{"baseImage":"{{index .RepoTags 0}}","imageId":"{{.Id}}"}'
