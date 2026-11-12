#!/bin/sh
# usage: run-all.sh   (runs every check, mutant and probe of round 6, one container at a time; runs 12 and 13 were added after the first pass and ran as the same checks.sh commands)
set -u
cd "$HOME/wa-jobs/wa-fable-20261112/receipts-cpu-r6" || exit 1
rm -f done.marker
T="npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose"
F=QuotaAwareCpuTracker.fix.ts
X=CpuTracker.final.test.ts
./checks.sh 1 pins-on-round3-round4-round5-source 0.5 QuotaAwareCpuTracker.r5.ts $X "$T"
./checks.sh 2 fix-final-tests 0.5 $F $X "$T"
./checks.sh 3 mutantA1-unreadable-process-uses-mount-root 0.5 mutantA1-unreadable-process-uses-mount-root.ts $X "$T"
./checks.sh 4 mutantA2-missing-entry-uses-mount-root 0.5 mutantA2-missing-entry-uses-mount-root.ts $X "$T"
./checks.sh 5 mutantB-ascent-with-named-root-is-ancestor 0.5 mutantB-ascent-with-named-root-is-ancestor.ts $X "$T"
./checks.sh 6 mutantC-same-ascent-without-prefix-check 0.5 mutantC-same-ascent-without-prefix-check.ts $X "$T"
./checks.sh 7 mutantD-lower-ascent-is-walked 0.5 mutantD-lower-ascent-is-walked.ts $X "$T"
./checks.sh 12 alt-missing-entry-yields-no-directory 0.5 altE-missing-entry-yields-no-directory.ts $X "$T"
./checks.sh 13 mutantF-ascent-only-from-the-namespace-root 0.5 mutantF-ascent-only-from-the-namespace-root.ts $X "$T"
./checks.sh 8 prettier-check 0.5 $F $X "npx prettier --check src/Services/CpuTracker.ts src/Services/QuotaAwareCpuTracker.ts tests/CpuTracker.test.ts"
./checks.sh 9 eslint-heap960 0.5 $F $X "DEBUG= NODE_OPTIONS=--max-old-space-size=960 npx eslint src/Services/CpuTracker.ts src/Services/QuotaAwareCpuTracker.ts tests/CpuTracker.test.ts"
./checks.sh 10 typecheck-heap960 0.5 $F $X "NODE_OPTIONS=--max-old-space-size=960 npm run typecheck"
./checks.sh 11 back-whole-suite 0.5 $F $X "npm test -- --run"
./probe.sh 1 private-cgroupns -
./probe.sh 2 cgroupns-host - --cgroupns host
./probe.sh 3 private-bind-host-cgroupfs-over-default - -v /sys/fs/cgroup:/sys/fs/cgroup:ro
./probe.sh 4 private-bind-host-cgroupfs-elsewhere - -v /sys/fs/cgroup:/host-cgroup:ro
./probe.sh 5 cgroupns-host-bind-host-cgroupfs-over-default - --cgroupns host -v /sys/fs/cgroup:/sys/fs/cgroup:ro
date -u > done.marker
