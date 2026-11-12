#!/bin/bash
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p4
R=$J/p4-review
TM="-v $R/suggested.test.ts:/work/play/tests/pusher/PositionDispatcher.test.ts:ro"
n=30
run() {
  label=$1; mountarg=$2
  log=$R/receipts/suggested-$label-knc.log
  {
    echo "label=suggested-$label host=$(hostname) start=$(date -u +%FT%TZ)"
    docker run --rm --name wa-fable-r2-p4-review-$n --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
      -v $T:/work $TM $mountarg -w /work node:24-trixie bash -lc 'sha256sum play/src/pusher/models/PositionDispatcher.ts play/tests/pusher/PositionDispatcher.test.ts; cd play && npm test -- --run tests/pusher/PositionDispatcher.test.ts 2>&1; echo test_exit=$?; npx eslint tests/pusher/PositionDispatcher.test.ts; echo eslint_exit=$?; npx prettier --check tests/pusher/PositionDispatcher.test.ts; echo prettier_exit=$?'
    echo "docker_exit=$?"
    echo "end=$(date -u +%FT%TZ)"
  } > $log 2>&1
  n=$((n+1))
}
run change ""
for m in nobottomj setbefore; do run mutant-$m "-v $R/mut/$m.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"; done
run head "-v $J/p4-mut/head.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"
echo done > $R/receipts/suggested.done
