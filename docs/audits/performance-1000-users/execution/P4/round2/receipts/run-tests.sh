#!/bin/bash
# Runs the PositionDispatcher test file against the change, two mutants and HEAD's production file.
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p4
OUT=$J/p4-receipts
n=1
run() {
  label=$1; mountarg=$2
  log=$OUT/test-$label-knc.log
  {
    echo "label=$label host=$(hostname) start=$(date -u +%FT%TZ)"
    echo "container=wa-fable-r2-20261112-p4-impl-$n image=node:24-trixie --cpus 1 --memory 3g --network none"
    docker run --rm --name wa-fable-r2-20261112-p4-impl-$n --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
      -v $T:/work $mountarg -w /work node:24-trixie bash -lc 'set -o pipefail; sha256sum play/src/pusher/models/PositionDispatcher.ts play/tests/pusher/PositionDispatcher.test.ts; cd play && npm test -- --run tests/pusher/PositionDispatcher.test.ts 2>&1'
    echo "exit=$?"
    echo "end=$(date -u +%FT%TZ)"
  } > $log 2>&1
  n=$((n+1))
}
run change ""
run mutant-topleftonly "-v $J/p4-mut/topleftonly.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"
run mutant-noclear "-v $J/p4-mut/noclear.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"
run head "-v $J/p4-mut/head.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"
echo done > $OUT/tests.done
