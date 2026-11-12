#!/bin/sh
# usage: run-all.sh   (runs every check, mutant and probe of round 7, one container at a time)
set -u
cd "$HOME/wa-jobs/wa-fable-20261112/receipts-cpu-r7" || exit 1
rm -f done.marker
T="npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose"
F=QuotaAwareCpuTracker.fix.ts
X=CpuTracker.final.test.ts
./checks.sh 1 pins-on-round3-to-round6-source 0.5 QuotaAwareCpuTracker.r6.ts $X "$T"
./checks.sh 2 fix-final-tests 0.5 $F $X "$T"
./checks.sh 3 mutantG1-first-matching-mount-only 0.5 mutantG1-first-matching-mount-only.ts $X "$T"
./checks.sh 4 mutantG2-last-matching-mount-only 0.5 mutantG2-last-matching-mount-only.ts $X "$T"
./checks.sh 5 mutantG3-loosest-over-mounts 0.5 mutantG3-loosest-over-mounts.ts $X "$T"
./checks.sh 6 mutantG4-reversed-mount-order-equivalent 0.5 mutantG4-reversed-mount-order-equivalent.ts $X "$T"
./checks.sh 7 prettier-check 0.5 $F $X "npx prettier --check src/Services/CpuTracker.ts src/Services/QuotaAwareCpuTracker.ts tests/CpuTracker.test.ts"
./checks.sh 8 eslint-heap960 0.5 $F $X "DEBUG= NODE_OPTIONS=--max-old-space-size=960 npx eslint src/Services/CpuTracker.ts src/Services/QuotaAwareCpuTracker.ts tests/CpuTracker.test.ts"
./checks.sh 9 typecheck-heap960 0.5 $F $X "NODE_OPTIONS=--max-old-space-size=960 npm run typecheck"
./checks.sh 10 back-whole-suite 0.5 $F $X "npm test -- --run"
./probe.sh 1 private-cgroupns -
./probe.sh 2 cgroupns-host - --cgroupns host
./probe.sh 3 private-bind-host-cgroupfs-over-default - -v /sys/fs/cgroup:/sys/fs/cgroup:ro
./probe.sh 4 private-bind-host-cgroupfs-elsewhere - -v /sys/fs/cgroup:/host-cgroup:ro
./probe.sh 5 cgroupns-host-bind-host-cgroupfs-over-default - --cgroupns host -v /sys/fs/cgroup:/sys/fs/cgroup:ro
date -u > done.marker
