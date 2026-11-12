#!/usr/bin/env bash
set -u -o pipefail
export JOB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$JOB_ROOT"
mkdir -p out/logs
cp source-manifest.json out/source-manifest.json
node -e 'const fs=require("fs"); fs.writeFileSync("out/toolchain.json",JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules,glibc:process.report.getReport().header.glibcVersionRuntime},null,2)); if(process.versions.node.split(".")[0]!=="24") process.exit(1)' || exit 1
step() {
    local name=$1
    shift
    "$@" > "$JOB_ROOT/out/logs/$name.log" 2>&1
    LAST_STATUS=$?
    printf '%s\t%s\n' "$name" "$LAST_STATUS" >> "$JOB_ROOT/out/status.tsv"
    echo "$name exit=$LAST_STATUS"
}
step verify-inputs node "$JOB_ROOT/job/offload-inputs.mjs" verify
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
step git-preflight git --version
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
export NODE_OPTIONS=--max-old-space-size=4096
export HUSKY=0
export NODE_ENV=development
step install-locked-dependencies bash -lc 'set -e; cd "$JOB_ROOT/baseline/messages"; npm ci --no-audit --no-fund --loglevel=error; npm run -s tag-version; npm run -s ts-proto; cd "$JOB_ROOT/baseline"; npm ci --no-audit --no-fund --loglevel=error --workspace=workadventure-play --workspace=@workadventure/iframe-api-typings...'
if [ "$LAST_STATUS" -ne 0 ]; then
    printf 'baseline-build\tBLOCKED: dependency setup\ncandidate-build\tBLOCKED: dependency setup\n' >> out/status.tsv
    exit 1
fi
cd "$JOB_ROOT/baseline/play"
export NODE_ENV=production
step baseline-build bash -lc 'set -e; cd "$JOB_ROOT/baseline/play"; npm run -s typesafe-i18n; npm run -s build-iframe-api; npm run -s build'
if [ "$LAST_STATUS" -eq 0 ]; then
    step baseline-artifact node "$JOB_ROOT/job/offload-front.mjs" baseline
fi
step baseline-typecheck timeout 300 npm run typecheck
step baseline-svelte-check timeout 300 npm run svelte-check
step apply-candidate node "$JOB_ROOT/job/offload-inputs.mjs" apply
if [ "$LAST_STATUS" -ne 0 ]; then exit 1; fi
step candidate-tests env NODE_ENV=test timeout 300 npm test -- --run --maxWorkers=1 src/front/Phaser/Game/ThinWallsController.test.ts src/front/Phaser/Game/SeatedPoseController.test.ts src/front/Phaser/Game/TileAnimationRefreshTracker.test.ts src/front/Phaser/Game/MapEditor/EditorPlacement.test.ts tests/front/Utils/PathfindingManager.test.ts tests/front/Stores/KoncluiLayout.test.ts
step candidate-typecheck timeout 300 npm run typecheck
step candidate-svelte-check timeout 300 npm run svelte-check
step candidate-build bash -lc 'set -e; cd "$JOB_ROOT/baseline/play"; rm -rf dist/public; npm run -s typesafe-i18n; npm run -s build-iframe-api; npm run -s build'
if [ "$LAST_STATUS" -eq 0 ]; then
    step candidate-artifact node "$JOB_ROOT/job/offload-front.mjs" candidate
fi
cd "$JOB_ROOT"
node - <<'JS'
const fs=require('fs');
const rows=fs.readFileSync('out/status.tsv','utf8').trim().split('\n').map(line=>{const [step,status]=line.split('\t');return {step,status};});
fs.writeFileSync('out/summary.json',JSON.stringify({statuses:rows,complete:rows.every(row=>row.status==='0'),scope:'Production frontend build and static/focused checks only. Browser, media and performance gates are not exercised.'},null,2));
process.exit(rows.every(row=>row.status==='0')?0:1);
JS
