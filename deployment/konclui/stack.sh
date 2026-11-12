#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
STATE="$ROOT/.local/konclui"
mkdir -p "$STATE" "$ROOT/.audit/konclui-runtime"
if [ ! -f "$STATE/local.env" ]; then
    python3 - "$STATE/local.env" <<'PY'
import os
import secrets
import sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    for name in ('SECRET_KEY', 'MAP_STORAGE_API_TOKEN', 'MAP_STORAGE_AUTHENTICATION_TOKEN'):
        out.write(f'{name}={secrets.token_hex(32)}\n')
PY
fi
ACTION=${1:-status}
COMPOSE=(docker compose --project-name konclui-native-baseline --env-file "$STATE/local.env" -f "$ROOT/deployment/konclui/compose.yaml")
case "$ACTION" in
    start)
        test -f "$STATE/front/index.html" || { echo 'Run deployment/konclui/build-front.sh first.' >&2; exit 1; }
        if [ -z "$("${COMPOSE[@]}" ps -q reverse-proxy)" ]; then
            python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 8093))
PY
        fi
        "${COMPOSE[@]}" config --quiet
        "${COMPOSE[@]}" up -d --wait --wait-timeout 180
        "${COMPOSE[@]}" rm -f seed >/dev/null
        "${COMPOSE[@]}" ps --format json > "$ROOT/.audit/konclui-runtime/stack-resources.json"
        echo 'Preview: http://localhost:8093'
        ;;
    stop) "${COMPOSE[@]}" stop ;;
    status) "${COMPOSE[@]}" ps ;;
    *) echo 'Usage: stack.sh start|stop|status' >&2; exit 2 ;;
esac
