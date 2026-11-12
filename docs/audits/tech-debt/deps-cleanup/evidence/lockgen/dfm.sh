#!/bin/bash
# Container 3 (network on): the scoped installs the back and map-storage Dockerfiles run, on the stacked tree, plus a module resolution probe.
set -u
W=/w; OUT=$W/out-final; export CI=true
: > $OUT/dfm.log
for svc in back map-storage; do
  R=$W/dfm-$svc; rm -rf $R; mkdir -p $R/$svc; cd $R
  cp $W/final/package.json $W/final/package-lock.json .; cp $W/final/$svc/package.json $svc/
  for l in messages map-editor math-utils tailwind store-utils shared-utils desktop-api; do mkdir -p libs/$l; cp $W/final/libs/$l/package.json libs/$l/; done
  if [ $svc = back ]; then CMD="npm ci --omit=dev --workspace workadventureback --no-audit --no-fund"; MODS="uuid @workadventure/map-editor @workadventure/messages @workadventure/shared-utils"
  else CMD="npm ci --workspace map-storage --no-audit --no-fund"; MODS="@smithy/types @aws-sdk/client-s3 @workadventure/messages @workadventure/map-editor @workadventure/shared-utils"; fi
  echo "### $svc: $CMD" >> $OUT/dfm.log
  $CMD >> $OUT/dfm.log 2>&1; rc=$?; echo "npm-ci-exit=$rc" >> $OUT/dfm.log
  (cd $svc && for m in $MODS; do node -e "console.log('$m', require.resolve('$m/package.json').replace(process.cwd(),'.'))" 2>&1 | tail -1; done) >> $OUT/dfm.log
  echo -e "dockerfile-install-$svc\t$svc\t$rc\t0s" >> $OUT/results-dfm.tsv
  rm -rf $R
done
