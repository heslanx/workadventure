#!/bin/bash
# Reviewer runs: the PositionDispatcher test file against the change and five independent mutants (bind-mounted :ro).
J=$HOME/wa-jobs/wa-fable-20261112
T=$J/src-p4
R=$J/p4-review
n=1
run() {
  label=$1; mountarg=$2
  log=$R/receipts/test-$label-knc.log
  {
    echo "label=$label host=$(hostname) start=$(date -u +%FT%TZ)"
    echo "container=wa-fable-r2-p4-review-$n image=node:24-trixie --cpus 1 --memory 3g --network none"
    docker run --rm --name wa-fable-r2-p4-review-$n --label owner=wa-fable-20261112 --cpus 1 --cpu-shares 512 --memory 3g --network none \
      -v $T:/work $mountarg -w /work node:24-trixie bash -lc 'sha256sum play/src/pusher/models/PositionDispatcher.ts play/tests/pusher/PositionDispatcher.test.ts; cd play && npm test -- --run tests/pusher/PositionDispatcher.test.ts 2>&1'
    echo "exit=$?"
    echo "end=$(date -u +%FT%TZ)"
  } > $log 2>&1
  n=$((n+1))
}
run change ""
for m in topleftonly noclear nobottomi nobottomj setbefore; do
  run mutant-$m "-v $R/mut/$m.ts:/work/play/src/pusher/models/PositionDispatcher.ts:ro"
done
echo done > $R/receipts/tests.done
