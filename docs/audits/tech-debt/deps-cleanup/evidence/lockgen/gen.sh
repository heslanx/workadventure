#!/bin/bash
# Lockfile generation for the deps-cleanup stack. Runs in node:24-trixie with network. One patch per step, each incremental on the previous.
set -u
W=/w; OUT=$W/out-lock; rm -rf $OUT $W/lock; mkdir -p $OUT $W/lock $W/npm-cache
{ node -v; npm -v; git --version; } > $OUT/env.txt 2>&1
git config --global --add safe.directory "*"
cd $W/lock && tar --no-same-owner -xzf $W/src.tgz && find . -name '._*' -type f -delete
git init -q . && git config user.email deps@local && git config user.name deps
find . -name package.json -not -path '*/node_modules/*' -print0 | xargs -0 git add -f
git add -f package-lock.json && git commit -qm base
cp package-lock.json $OUT/lock.base.json
gen() { npm install --package-lock-only --ignore-scripts --no-audit --no-fund --cache $W/npm-cache > $OUT/$1.npm.log 2>&1; echo "$1 npm-exit=$?" | tee -a $OUT/exit.tsv; }
gen step0-noop
git diff --stat > $OUT/step0.stat; echo "noop drift lines: $(git diff | wc -l)" | tee -a $OUT/exit.tsv
if [ -s $OUT/step0.stat ]; then git diff > $OUT/step0-noop.diff; git checkout -q package-lock.json; fi
N=$(python3 -c "import json;print(len(json.load(open('$W/steps.json'))))")
for i in $(seq 0 $((N-1))); do
  name=$(python3 -c "import json;print(json.load(open('$W/steps.json'))[$i]['name'])")
  prev=$(printf '%s' "$(git rev-parse HEAD)")
  cp package-lock.json $OUT/lock.before.json
  python3 $W/editpkg.py $W/steps.json $i || { echo "$name edit-failed" | tee -a $OUT/exit.tsv; exit 1; }
  gen $name
  git diff --stat > $OUT/$name.stat
  git diff -- . > $OUT/$name.patch
  python3 $W/lockdiff.py $OUT/lock.before.json package-lock.json > $OUT/$name.lockdiff.txt
  git add -f package.json package-lock.json $(find . -name package.json -not -path '*/node_modules/*') && git commit -qm "$name"
done
cp package-lock.json $OUT/lock.final.json
git log --oneline > $OUT/log.txt
echo done | tee -a $OUT/exit.tsv
