#!/usr/bin/env bash
# Shared helpers for the local Docker + SSH Orca recipe. Sourced, not executed.
# Every lifecycle script keeps stdout for its final JSON; all progress goes to stderr.

orca_vm_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$orca_vm_dir/../.." && pwd)"
state_file="$orca_vm_dir/docker-state.json"
known_hosts_file="${ORCA_VM_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"

log() { printf '[orca-vm] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

# json_value <key>: read a top-level string/number from the state file.
json_value() {
  jq -r --arg k "$1" '.[$k] // empty' "$state_file"
}

# env_value <ENV_NAME> <state-key>: env var wins over state.
env_value() {
  local from_env="${!1:-}"
  if [ -n "$from_env" ]; then printf '%s' "$from_env"; else json_value "$2"; fi
}

# Settings are consumed by the scripts that source this file.
# shellcheck disable=SC2034
load_settings() {
  base_image="$(env_value ORCA_VM_BASE_IMAGE baseImage)"
  auth_image="$(env_value ORCA_VM_AUTH_IMAGE authImage)"
  auth_container="$(env_value ORCA_VM_AUTH_CONTAINER authContainer)"
  container_prefix="$(env_value ORCA_VM_CONTAINER_PREFIX containerPrefix)"
  ssh_username="$(env_value ORCA_VM_USERNAME username)"
  project_root="$(env_value ORCA_VM_PROJECT_ROOT projectRoot)"
  repo_url="$(env_value ORCA_VM_REPO_URL repoUrl)"
  upstream_url="$(env_value ORCA_VM_UPSTREAM_URL upstreamUrl)"
  repo_ref="$(env_value ORCA_VM_REPO_REF repoRef)"
  local key_path
  key_path="$(env_value ORCA_VM_SSH_KEY sshKey)"
  case "$key_path" in
    /*) ssh_key="$key_path" ;;
    *) ssh_key="$repo_root/$key_path" ;;
  esac
}

# container_name <instance-id>: deterministic name so destroy can find a VM without a recipe result.
container_name() {
  local sanitized
  sanitized="$(printf '%s' "$1" | tr -c 'a-zA-Z0-9_.-' '-' | cut -c1-48)"
  [ -n "$sanitized" ] || die "empty instance id"
  printf '%s-%s' "$container_prefix" "$sanitized"
}

ensure_ssh_key() {
  if [ ! -f "$ssh_key" ]; then
    log "generating repo-local SSH key at $ssh_key"
    mkdir -p "$(dirname -- "$ssh_key")"
    chmod 700 "$(dirname -- "$ssh_key")"
    ssh-keygen -q -t ed25519 -N '' -C orca-workadventure-docker -f "$ssh_key" >&2
  fi
}

container_ssh_port() {
  docker port "$1" 22/tcp | awk -F: 'NR==1 {print $NF}'
}

container_host_key() {
  docker exec "$1" cat /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $1" "$2}'
}

wait_for_sshd() {
  local name="$1"
  for _ in $(seq 1 60); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]; then
      docker logs "$name" >&2 || true
      die "container $name is not running"
    fi
    if docker exec "$name" pgrep -x sshd >/dev/null 2>&1 \
      && docker exec "$name" test -s /etc/ssh/ssh_host_ed25519_key.pub; then
      return 0
    fi
    sleep 1
  done
  docker logs "$name" >&2 || true
  die "sshd did not start in $name"
}

# record_host_key <container> <port>: trust exactly this container's key for [127.0.0.1]:port.
# The key comes from trusted local docker exec; only this endpoint's old entry is replaced.
record_host_key() {
  local name="$1" port="$2" endpoint host_key
  endpoint="[127.0.0.1]:$port"
  host_key="$(container_host_key "$name")"
  [ -n "$host_key" ] || die "could not read host key of $name"
  mkdir -p "$(dirname -- "$known_hosts_file")"
  touch "$known_hosts_file"
  if ! grep -qxF "$endpoint $host_key" "$known_hosts_file"; then
    ssh-keygen -R "$endpoint" -f "$known_hosts_file" >/dev/null 2>&1 || true
    rm -f "$known_hosts_file.old"
    printf '%s %s\n' "$endpoint" "$host_key" >>"$known_hosts_file"
  fi
}

# forget_host_key <port> <host_key>: remove the endpoint only if it still holds this container's key.
forget_host_key() {
  local endpoint="[127.0.0.1]:$1" host_key="$2"
  [ -f "$known_hosts_file" ] || return 0
  if grep -qxF "$endpoint $host_key" "$known_hosts_file"; then
    ssh-keygen -R "$endpoint" -f "$known_hosts_file" >/dev/null 2>&1 || true
    rm -f "$known_hosts_file.old"
  fi
}

ssh_smoke_test() {
  local port="$1"
  ssh -i "$ssh_key" -p "$port" \
    -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$known_hosts_file" -o ConnectTimeout=10 \
    "$ssh_username@127.0.0.1" \
    "cd $(printf '%q' "$project_root") && pwd && git rev-parse --short HEAD && claude --version && codex --version" >&2
}

# emit_result <container> <port>: the single recipe-result JSON object on stdout.
emit_result() {
  jq -n \
    --arg name "$1" --argjson port "$2" --arg user "$ssh_username" \
    --arg key "$ssh_key" --arg root "$project_root" \
    '{
      schemaVersion: 1,
      connection: {
        type: "ssh",
        projectRoot: $root,
        target: {
          label: $name,
          host: "127.0.0.1",
          port: $port,
          username: $user,
          identityFile: $key,
          identitiesOnly: true
        }
      },
      userData: { provider: "docker", resourceId: $name }
    }'
}

# payload_resource_id: container name from a lifecycle payload on stdin (recipeResult or instanceId).
payload_resource_id() {
  local payload="$1" resource_id instance_id
  resource_id="$(printf '%s' "$payload" | jq -r '.recipeResult.userData.resourceId // empty')"
  if [ -z "$resource_id" ]; then
    instance_id="$(printf '%s' "$payload" | jq -r '.instanceId // empty')"
    instance_id="${instance_id:-${ORCA_VM_INSTANCE_ID:-}}"
    [ -n "$instance_id" ] && resource_id="$(container_name "$instance_id")"
  fi
  printf '%s' "$resource_id"
}

command -v docker >/dev/null || die "docker CLI not found"
command -v jq >/dev/null || die "jq not found"
[ -f "$state_file" ] || die "state file missing: $state_file"
load_settings
