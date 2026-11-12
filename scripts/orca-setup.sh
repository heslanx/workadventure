#!/usr/bin/env bash
# Orca `scripts.setup`: prepare a fresh worktree so builds, type checks and tests can run.
# Mirrors the install and codegen steps of .github/workflows/continuous_integration.yml.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."

echo "[setup] npm ci (all workspaces)"
npm ci --no-audit --no-fund

echo "[setup] npm ci (messages)"
(cd messages && npm ci --no-audit --no-fund)

# messages' ts-proto script post-processes with GNU `sed -i '1i…'`, which BSD sed (macOS) rejects.
if sed --version >/dev/null 2>&1; then
  echo "[setup] generate protobuf TypeScript"
  (cd messages && npm run ts-proto)
else
  echo "[setup] warning: skipped 'npm run ts-proto' (needs GNU sed; on macOS: brew install gnu-sed and put gnubin first on PATH)" >&2
fi

echo "[setup] generate i18n types"
(cd play && npm run typesafe-i18n)

echo "[setup] done"
