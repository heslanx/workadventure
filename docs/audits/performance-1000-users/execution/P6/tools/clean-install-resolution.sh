#!/usr/bin/env bash
# Reproduce clean installs from the P6 manifests and lockfile only (no sources)
# in a scratch directory and report which package each compiler bin links to.
# --ignore-scripts: only the dependency layout and bin links are under test.
# usage: clean-install-resolution.sh
set -u
S=/tmp/wa-scratch-install
rm -rf "$S"
mkdir -p "$S"
cd /work
find . -name package.json -not -path '*/node_modules/*' -not -path './desktop/*' -not -path './docs/*' -not -path './maps/*' -not -path './messages/*' -not -path './libs/room-api-clients/*' | while read -r f; do
  mkdir -p "$S/$(dirname "$f")"
  cp "$f" "$S/$f"
done
cp package-lock.json "$S/"
mkdir -p "$S/patches"

report() {
  local label=$1
  for b in tsc tsc6 tsserver; do
    if [ -L "$S/node_modules/.bin/$b" ]; then
      echo "$label .bin/$b -> $(readlink "$S/node_modules/.bin/$b")"
    else
      echo "$label .bin/$b ABSENT"
    fi
  done
  for d in typescript @typescript/native @typescript/old; do
    if [ -f "$S/node_modules/$d/package.json" ]; then
      echo "$label node_modules/$d = $(node -p "const p=require('$S/node_modules/$d/package.json'); p.name+'@'+p.version")"
    else
      echo "$label node_modules/$d ABSENT"
    fi
  done
  find "$S" -path '*/node_modules/.bin/tsc*' -not -path "$S/node_modules/*" | sed "s|^|$label workspace-local bin: |"
}

cd "$S"
npm ci --ignore-scripts --no-audit --no-fund >"$S/full.log" 2>&1
echo "full npm ci exit=$?"
report full
[ -x node_modules/.bin/tsc ] && echo "full tsc --version: $(node_modules/.bin/tsc --version 2>&1 | head -1)"
[ -x node_modules/.bin/tsc6 ] && echo "full tsc6 --version: $(node_modules/.bin/tsc6 --version 2>&1 | head -1)"

for ws in workadventureback map-storage workadventure-play; do
  rm -rf "$S/node_modules"
  find "$S" -name node_modules -prune -exec rm -rf {} + 2>/dev/null
  npm ci --workspace="$ws" --ignore-scripts --no-audit --no-fund >"$S/$ws.log" 2>&1
  echo "scoped npm ci --workspace=$ws exit=$?"
  report "scoped:$ws"
  [ -x node_modules/.bin/tsc ] && echo "scoped:$ws tsc --version: $(node_modules/.bin/tsc --version 2>&1 | head -1)"
  [ -x node_modules/.bin/tsc6 ] && echo "scoped:$ws tsc6 --version: $(node_modules/.bin/tsc6 --version 2>&1 | head -1)"
done
cd /
rm -rf "$S"
echo "scratch removed: $([ -e "$S" ] && echo no || echo yes)"
