#!/bin/bash
# Container 1 (network on): fresh extract of the snapshot, apply the stack in order, real npm ci.
set -u
W=/w; OUT=$W/out-final; ROOT=$W/final; rm -rf $OUT $ROOT; mkdir -p $OUT/logs $ROOT
export CI=true
{ node -v; npm -v; nproc; git --version; } > $OUT/env.txt 2>&1
tar --no-same-owner -xzf $W/src.tgz -C $ROOT; cd $ROOT; find . -name '._*' -type f -delete
: > $OUT/results.tsv
for n in dep02-back dep02-shared-utils dep02-map-storage dep01-back dep01-map-storage dep01-libs-messages dep01-libs-store-utils dep01-play; do
  git apply --check --whitespace=nowarn $W/patches/$n.patch 2>>$OUT/logs/apply.log; c=$?
  git apply --whitespace=nowarn $W/patches/$n.patch 2>>$OUT/logs/apply.log; a=$?
  echo -e "apply-$n\t.\tcheck=$c apply=$a\t0s" >> $OUT/results.tsv
done
start=$(date +%s)
npm ci --no-audit --no-fund > $OUT/logs/npm-ci.full.log 2>&1; rc=$?
echo -e "npm-ci\t.\t$rc\t$(( $(date +%s)-start ))s" >> $OUT/results.tsv
tail -c 20000 $OUT/logs/npm-ci.full.log > $OUT/logs/npm-ci.log
cat $OUT/results.tsv
