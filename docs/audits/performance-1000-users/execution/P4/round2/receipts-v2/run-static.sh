#!/bin/bash
# Typecheck of play (covers src/pusher and tests/), eslint and prettier --check on the two P4 files (v2 patch applied).
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p4
OUT=$J/p4-fix/receipts
F="src/pusher/models/PositionDispatcher.ts tests/pusher/PositionDispatcher.test.ts"
{
  echo "label=static host=$(hostname) start=$(date -u +%FT%TZ)"
  echo "container=wa-fable-r2-p4-fix-20 image=node:24-trixie --cpus 1 --memory 3g --network none"
  docker run --rm --name wa-fable-r2-p4-fix-20 --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
    -v $T:/work -w /work/play node:24-trixie bash -lc "sha256sum $F; echo '--- npm run typecheck'; npm run typecheck 2>&1; echo typecheck_exit=\$?; echo '--- eslint'; npx eslint $F 2>&1; echo eslint_exit=\$?; echo '--- prettier --check'; npx prettier --check $F 2>&1; echo prettier_exit=\$?"
  echo "docker_exit=$?"
  echo "end=$(date -u +%FT%TZ)"
} > $OUT/static-knc.log 2>&1
