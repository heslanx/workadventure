#!/bin/bash
# Container 2 (network none): the CI mirror lanes of /tmp/wa-ci4/run.sh on the stacked tree, plus npm ls and negative controls.
set -u
export CI=true NODE_OPTIONS=--max-old-space-size=3072
W=/w; OUT=$W/out-final; ROOT=$W/final; cd $ROOT
chk() { local n=$1 dir=$2; shift 2; local s=$(date +%s)
  ( cd "$ROOT/$dir" && timeout 1700 "$@" ) > $OUT/logs/$n.full.log 2>&1; local rc=$?
  tail -c 30000 $OUT/logs/$n.full.log > $OUT/logs/$n.log; rm -f $OUT/logs/$n.full.log
  echo -e "$n\t$dir\t$rc\t$(( $(date +%s)-s ))s" >> $OUT/results.tsv; }
lsq() { local n=$1; shift; ( cd $ROOT && "$@" ) > $OUT/logs/$n.log 2>&1; echo -e "$n\t.\t$?\t0s" >> $OUT/results.tsv; }
lsq npm-ls-back-uuid-mapeditor npm ls uuid @workadventure/map-editor --workspace workadventureback
lsq npm-ls-shared-utils-messages npm ls @workadventure/messages --workspace @workadventure/shared-utils
lsq npm-ls-map-storage-smithy npm ls @smithy/types --workspace map-storage
lsq npm-ls-removed-roots npm ls google-protobuf mkdirp query-string uuidv4 busboy hyper-express live-directory ts-proto-descriptors webpack ts-loader nodemon reflect-metadata @livekit/track-processors @types/dom-mediacapture-transform @types/dom-webcodecs
lsq npm-ls-all-problems bash -c "npm ls --all > /tmp/npmls.all 2>&1; echo npm-ls-all-exit=\$?; echo invalid=\$(grep -c ' invalid' /tmp/npmls.all) missing=\$(grep -c 'missing:' /tmp/npmls.all) extraneous=\$(grep -c 'extraneous' /tmp/npmls.all) unmet-required=\$(grep 'UNMET DEPENDENCY' /tmp/npmls.all | grep -vc OPTIONAL) unmet-optional=\$(grep -c 'UNMET OPTIONAL' /tmp/npmls.all); grep -E ' invalid|missing:|extraneous|UNMET DEPENDENCY' /tmp/npmls.all | head -20"
{ echo "uuid types: $(node -p "require('$ROOT/node_modules/uuid/package.json').types || 'none'")"; echo "uuid version: $(node -p "require('$ROOT/node_modules/uuid/package.json').version")"; ls -d $ROOT/node_modules/@types/uuid $ROOT/node_modules/@types/dom-mediacapture-transform $ROOT/node_modules/tsconfig-paths 2>&1; node -p "require('$ROOT/node_modules/tsconfig-paths/package.json').version"; } > $OUT/logs/facts.log 2>&1
chk play-i18n-check play npm run i18n:check
chk play-typecheck play npm run typecheck
chk play-svelte-check play npm run svelte-check
chk play-lint play npm run lint
chk play-pretty-check play npm run pretty-check
chk play-test play env PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run
chk back-typecheck back npm run typecheck
chk back-lint back npm run lint
chk back-test back env PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run
chk back-pretty-check back npm run pretty-check
chk map-storage-typecheck map-storage npm run typecheck
chk map-storage-lint map-storage npm run lint
chk map-storage-test map-storage npx vitest run
chk map-storage-pretty-check map-storage npm run pretty-check
chk messages-typecheck libs/messages npm run typecheck
chk store-utils-typecheck libs/store-utils npm run typecheck
chk store-utils-svelte-check libs/store-utils npm run svelte-check
chk store-utils-lint libs/store-utils npm run lint
chk store-utils-test libs/store-utils npx vitest run
chk shared-utils-typecheck libs/shared-utils npm run typecheck
chk shared-utils-lint libs/shared-utils npm run lint
chk shared-utils-test libs/shared-utils npx vitest run
chk map-editor-typecheck libs/map-editor npm run typecheck
chk map-editor-lint libs/map-editor npm run lint
chk map-editor-test libs/map-editor npx vitest run
chk math-utils-typecheck libs/math-utils npx tsc --noEmit -p .
chk benchmark-test benchmark npm test
chk benchmark-typecheck benchmark npm run typecheck
chk play-build play bash -c "npm run typesafe-i18n && NODE_ENV=production NODE_OPTIONS=--max-old-space-size=4096 npm run build && echo marker-files=\$(grep -rl WA_DATA_PRECISION dist | wc -l)"
echo "total done $(date -u +%H:%M:%S)" >> $OUT/results.tsv
cat $OUT/results.tsv
