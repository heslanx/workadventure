#!/usr/bin/env bash
# Builds the bench trees on knc from the Mac checkout. Run from the repository root on the Mac.
# bench-base = ddbe245a8; bench-v1 = base + a589e9fdf's PositionDispatcher; bench-v2 = v1 + cpu-quota-aware.v2.patch;
# bench-v3 = v1 + v3-coalesce-group-updates.patch; bench-genpkg = HEAD's benchmark/ (the generator, shared by every variant).
# node_modules are hard links into src-cpu (npm ci for the current lockfile); a file that differs is unlinked before it is written.
set -euo pipefail
export COPYFILE_DISABLE=1
J=/root/wa-jobs/wa-fable-20261112
LOOP=docs/audits/performance-1000-users/execution/bench-loop
ssh knc "test ! -e $J/bench-base && mkdir -p $J/bench-base $J/bench-genpkg $J/bench-up/v1/play/src/pusher/models $J/bench-up/v1/play/tests/pusher $J/bench-loop $J/bench-out"
git archive ddbe245a8 | ssh knc "tar -x -C $J/bench-base"
tar -c --no-xattrs libs/messages/src/ts-proto-generated play/src/i18n/i18n-*.ts | ssh knc "tar -x -C $J/bench-base"
git archive HEAD benchmark | ssh knc "tar -x -C $J/bench-genpkg"
git show a589e9fdf:play/src/pusher/models/PositionDispatcher.ts | ssh knc "cat > $J/bench-up/v1/play/src/pusher/models/PositionDispatcher.ts"
git show a589e9fdf:play/tests/pusher/PositionDispatcher.test.ts | ssh knc "cat > $J/bench-up/v1/play/tests/pusher/PositionDispatcher.test.ts"
cat docs/audits/eight-user-performance/execution/2026-11-12/W3/round2/cpu-quota-aware.v2.patch | ssh knc "cat > $J/bench-up/cpu-quota-aware.v2.patch"
cat "$LOOP/v3-coalesce-group-updates.patch" | ssh knc "cat > $J/bench-up/v3.patch"
tar -c --no-xattrs -C "$LOOP" docker-compose.bench.yaml run-one.sh matrix.sh resume.sh cdp-prof.mjs plan.txt | ssh knc "tar -x -C $J/bench-loop"
ssh knc bash -s <<EOF
set -euo pipefail
cd $J
for d in node_modules play/node_modules back/node_modules; do cp -al src-cpu/\$d bench-base/\$d; done
find bench-base bench-genpkg bench-up -name '._*' -delete
apply_patch() { # tree patch: unlink every file the patch touches, then apply it
  (cd "\$1" && for f in \$(grep '^+++ b/' "\$2" | sed 's#^+++ b/##'); do if [ -f "\$f" ]; then cp "\$f" "\$f.x" && rm "\$f" && mv "\$f.x" "\$f"; fi; done && patch -p1 < "\$2")
}
cp -al bench-base bench-v1
for f in play/src/pusher/models/PositionDispatcher.ts play/tests/pusher/PositionDispatcher.test.ts; do rm bench-v1/\$f; cp bench-up/v1/\$f bench-v1/\$f; done
cp -al bench-v1 bench-v2 && apply_patch bench-v2 $J/bench-up/cpu-quota-aware.v2.patch
cp -al bench-v1 bench-v3 && apply_patch bench-v3 $J/bench-up/v3.patch
for t in bench-v1 bench-v2 bench-v3; do mkdir -p \$t/play/node_modules/.vite \$t/play/node_modules/.vite-temp \$t/back/node_modules/.vite-temp; done
EOF
echo "trees ready; start the matrix with: ssh knc 'cd $J/bench-loop && nohup bash matrix.sh plan.txt > $J/bench-out/matrix.log 2>&1 < /dev/null &'"
