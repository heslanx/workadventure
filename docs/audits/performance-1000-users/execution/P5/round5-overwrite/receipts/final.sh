#!/bin/bash
# Final stack: whole map-storage suite, typecheck, eslint and prettier on the four changed files. Usage: final.sh <container number>
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p5
W=$J/ovw5
d=$W/states/e12-f
name=wa-fable-ovw5-$1-final
files="src/MapsManager.ts src/Upload/UploadController.ts src/tests/MapsManagerAutosave.test.ts src/tests/UploadController.test.ts"
{
  echo "container $name"
  docker run --rm -e NO_COLOR=1 --name $name --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
    -v $T:/w:ro --tmpfs /w/map-storage/node_modules/.vite-temp --tmpfs /w/map-storage/node_modules/.vite \
    -v $d/MapsManager.ts:/w/map-storage/src/MapsManager.ts:ro \
    -v $d/UploadController.ts:/w/map-storage/src/Upload/UploadController.ts:ro -v $d/tests:/w/map-storage/src/tests:ro \
    -v $W/MapValidator.ts:/w/libs/map-editor/src/GameMap/MapValidator.ts:ro \
    -w /w/map-storage node:24-trixie bash -c "sha256sum $files src/tests/MapStorageServer.test.ts ../libs/map-editor/src/GameMap/MapValidator.ts
      echo '== npx vitest run'; npx vitest run 2>&1 | tail -8; echo VITEST_EXIT=\${PIPESTATUS[0]}
      echo '== npm run typecheck'; npm run typecheck 2>&1 | tail -5; echo TYPECHECK_EXIT=\${PIPESTATUS[0]}
      echo '== npx eslint'; npx eslint $files 2>&1 | tail -20; echo ESLINT_EXIT=\${PIPESTATUS[0]}
      echo '== npx prettier --check'; npx prettier --check $files 2>&1 | tail -10; echo PRETTIER_EXIT=\${PIPESTATUS[0]}"
  echo "EXIT=$?"
} > $W/receipts/final.log 2>&1
