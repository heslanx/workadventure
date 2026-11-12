#!/bin/bash
# Runs the map-storage tests of each state in its own container. Usage: run.sh <first container number> <state>...
# A state dir holds MapsManager.ts, UploadController.ts and tests/, mounted read-only over the read-only tree.
# Vite writes its config bundle and cache to tmpfs, so the tree is never written.
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p5
W=$J/ovw5
n=$1; shift
for st in "$@"; do
  d=$W/states/$st
  tests="src/tests/MapsManagerAutosave.test.ts"
  [ -f $d/tests/UploadController.test.ts ] && tests="$tests src/tests/UploadController.test.ts"
  name=wa-fable-ovw5-$n-${st//+/_}
  {
    echo "container $name"
    docker run --rm -e NO_COLOR=1 --name $name --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
      -v $T:/w:ro --tmpfs /w/map-storage/node_modules/.vite-temp --tmpfs /w/map-storage/node_modules/.vite -v $d/MapsManager.ts:/w/map-storage/src/MapsManager.ts:ro \
      -v $d/UploadController.ts:/w/map-storage/src/Upload/UploadController.ts:ro -v $d/tests:/w/map-storage/src/tests:ro \
      -v $W/MapValidator.ts:/w/libs/map-editor/src/GameMap/MapValidator.ts:ro \
      -w /w/map-storage node:24-trixie bash -c "sha256sum src/MapsManager.ts src/Upload/UploadController.ts src/tests/*.ts ../libs/map-editor/src/GameMap/MapValidator.ts; npx vitest run --reporter=verbose $tests 2>&1"
    echo "EXIT=$?"
  } > $W/receipts/$st.log 2>&1
  n=$((n+1))
done
