#!/bin/bash
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p4
R=$J/p4-review
F="src/pusher/models/PositionDispatcher.ts tests/pusher/PositionDispatcher.test.ts"
{
  echo "label=static host=$(hostname) start=$(date -u +%FT%TZ)"
  echo "container=wa-fable-r2-p4-review-20 image=node:24-trixie --cpus 1 --memory 3g --network none"
  docker run --rm --name wa-fable-r2-p4-review-20 --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
    -v $T:/work -w /work/play node:24-trixie bash -lc "sha256sum $F; echo '--- npm run typecheck'; npm run typecheck 2>&1; echo typecheck_exit=\$?; echo '--- eslint'; npx eslint $F 2>&1; echo eslint_exit=\$?; echo '--- prettier --check'; npx prettier --check $F 2>&1; echo prettier_exit=\$?"
  echo "docker_exit=$?"
  echo "end=$(date -u +%FT%TZ)"
} > $R/receipts/static-knc.log 2>&1
echo done > $R/receipts/static.done
