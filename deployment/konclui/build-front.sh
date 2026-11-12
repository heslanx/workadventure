#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
REF=${1:-HEAD}
COMMIT=$(git -C "$ROOT" rev-parse "$REF^{commit}")
TREE=$(git -C "$ROOT" rev-parse "$REF^{tree}")
OUT="$ROOT/.local/konclui"
AUDIT="$ROOT/.audit/konclui-runtime"
IMAGE='node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d'
mkdir -p "$OUT" "$AUDIT"
if [ -e "$OUT/front" ]; then
    echo 'Existing frontend retained. Move it to a named baseline before rebuilding.' >&2
    exit 1
fi
CID=$(docker run -d --label konclui.owner=native-migration --memory 5g --memory-swap 5g --cpus 3 "$IMAGE" sleep infinity)
cleanup() {
    docker stop -t 5 "$CID" >/dev/null
    docker rm "$CID" >/dev/null
}
trap cleanup EXIT
docker inspect --format '{{.Id}} {{.State.StartedAt}}' "$CID" > "$AUDIT/build-resource.txt"
docker exec "$CID" bash -lc 'apt-get update -qq && apt-get install -y -qq git >/dev/null && mkdir -p /src' > "$AUDIT/build-setup.log" 2>&1
git -C "$ROOT" archive "$COMMIT" | docker exec -i "$CID" tar -x -C /src
docker exec -e NODE_OPTIONS=--max-old-space-size=4096 "$CID" bash -lc '
set -euo pipefail
cd /src/messages
npm ci --no-audit --no-fund --loglevel=error
npm run -s tag-version
npm run -s ts-proto
cd /src
npm ci --no-audit --no-fund --loglevel=error --workspace=workadventure-play --workspace=@workadventure/iframe-api-typings...
cd play
export NODE_ENV=production
npm run -s typesafe-i18n
npm run -s build-iframe-api
npm run -s build
' > "$AUDIT/build-front.log" 2>&1
docker cp "$CID:/src/play/dist/public" "$OUT/front" >/dev/null
docker exec "$CID" node --version > "$AUDIT/build-node-version.txt"
docker exec "$CID" cat /src/libs/messages/src/JsonMessages/ApiVersion.ts > "$AUDIT/generated-api-version.txt"
python3 - "$COMMIT" "$TREE" "$IMAGE" "$OUT/front" "$AUDIT" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys

commit, tree, image, front, audit = sys.argv[1:]
front, audit = Path(front), Path(audit)
protocol = re.search(r'apiVersionHash = "([0-9a-f]+)"', (audit / 'generated-api-version.txt').read_text()).group(1)
files = {str(p.relative_to(front)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(front.rglob('*')) if p.is_file()}
record = {'commit': commit, 'tree': tree, 'nodeImage': image, 'nodeVersion': (audit / 'build-node-version.txt').read_text().strip(), 'protocolHash': protocol, 'files': files}
(audit / 'frontend-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
print(f'Built {commit[:12]} with protocol {protocol}; {len(files)} frontend files.')
PY
