#!/usr/bin/env bash
# Container entrypoint: install the desktop's public key, create this container's own host keys, run sshd.
set -euo pipefail

public_key="${ORCA_SSH_PUBLIC_KEY:-}"
case "$public_key" in
  ssh-ed25519\ * | ssh-rsa\ * | ecdsa-sha2-nistp*\ *) ;;
  *)
    echo "ORCA_SSH_PUBLIC_KEY is missing or invalid" >&2
    exit 1
    ;;
esac

umask 077
install -d -m 0700 -o node -g node /home/node/.ssh
printf '%s\n' "$public_key" >/home/node/.ssh/authorized_keys
chown node:node /home/node/.ssh/authorized_keys

# First start creates unique host keys; restarts (suspend/resume) keep them.
ssh-keygen -A >/dev/null
install -d -m 0755 /run/sshd
/usr/sbin/sshd -t

exec /usr/bin/tini -g -- /usr/sbin/sshd -D -e
