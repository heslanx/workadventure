#!/bin/bash
# Experiment: what the lockfile does when map-storage drops tsconfig-paths (base snapshot, no other change).
set -u; W=/w; OUT=$W/out-exp; rm -rf $OUT $W/lock-exp; mkdir -p $OUT $W/lock-exp
git config --global --add safe.directory "*"
cd $W/lock-exp && tar --no-same-owner -xzf $W/src.tgz && find . -name '._*' -type f -delete
cp package-lock.json $OUT/lock.before.json
echo '[{"name":"exp-tsconfig-paths","pkg":"map-storage","remove":["tsconfig-paths"]}]' > $W/steps-exp.json
python3 $W/editpkg.py $W/steps-exp.json 0
npm install --package-lock-only --ignore-scripts --no-audit --no-fund > $OUT/npm.log 2>&1; echo "npm-exit=$?" > $OUT/exit.txt
python3 $W/lockdiff.py $OUT/lock.before.json package-lock.json > $OUT/lockdiff.txt
python3 - <<'P' >> $OUT/lockdiff.txt
import json
b=json.load(open('/w/out-exp/lock.before.json'))['packages']; a=json.load(open('package-lock.json'))['packages']
for k in sorted(set(b)|set(a)):
    if 'tsconfig-paths' in k: print('tsconfig-paths entry', k, 'before', b.get(k,{}).get('version'), 'after', a.get(k,{}).get('version'))
P
