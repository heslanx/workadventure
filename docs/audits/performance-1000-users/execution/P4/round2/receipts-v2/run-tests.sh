#!/bin/bash
# Runs the PositionDispatcher test file (v2 patch applied) against the change, four mutants and HEAD's production file.
# Usage: run-tests.sh <first container number> <label>... ; labels map to $J/p4-fix/mut/<label>.ts, "change" mounts nothing.
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p4
OUT=$J/p4-fix/receipts
n=$1; shift
for label in "$@"; do
  if [ "$label" = change ]; then mountarg=""; else mountarg="-v $J/p4-fix/mut/$label.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"; fi
  log=$OUT/test-$label-knc.log
  {
    echo "label=$label host=$(hostname) start=$(date -u +%FT%TZ)"
    echo "container=wa-fable-r2-p4-fix-$n image=node:24-trixie --cpus 1 --memory 3g --network none"
    docker run --rm --name wa-fable-r2-p4-fix-$n --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
      -v $T:/work $mountarg -w /work node:24-trixie bash -lc 'set -o pipefail; sha256sum play/src/pusher/models/PositionDispatcher.ts play/tests/pusher/PositionDispatcher.test.ts; cd play && npm test -- --run tests/pusher/PositionDispatcher.test.ts 2>&1'
    echo "exit=$?"
    echo "end=$(date -u +%FT%TZ)"
  } > $log 2>&1
  n=$((n+1))
done
