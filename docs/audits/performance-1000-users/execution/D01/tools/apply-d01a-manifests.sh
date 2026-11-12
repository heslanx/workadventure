#!/usr/bin/env bash
# D01a: move every workspace of the root lockfile that pins typescript from the
# 5.9 line to the 6.0 line. Workspaces with their own lockfile (messages/,
# libs/room-api-clients/room-api-client-js, desktop/electron) are not touched.
set -eu
cd /work
for f in \
  package.json \
  play/package.json \
  back/package.json \
  map-storage/package.json \
  libs/map-editor/package.json \
  libs/math-utils/package.json \
  libs/messages/package.json \
  libs/shared-utils/package.json \
  libs/store-utils/package.json \
  benchmark/package.json \
  contrib/tools/e2e-report/package.json \
  contrib/tools/generate-env-docs/package.json; do
  sed -i 's/"typescript": "\^5\.9\.3"/"typescript": "^6.0.3"/' "$f"
  printf '%s: %s\n' "$f" "$(grep -n '"typescript":' "$f")"
done
