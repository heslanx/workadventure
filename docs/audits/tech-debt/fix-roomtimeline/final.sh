#!/usr/bin/env bash
# Final-stage checks on v/s3, one container at a time. Each writes logs/<suffix>.log.
set -u
cd /srv/ci-jobs/wa-fable-20261112/fixrt
D=src/front/Chat/Components/Room
FILES="$D/RoomTimeline.svelte $D/RoomTimelineRenderItems.ts $D/RoomTimelineCharacterization.test.ts"
summary() { printf "%s: " "$1"; grep -E "^ +(Test Files|Tests) |svelte-check found|All matched files|^EXIT" "logs/$1.log" | tr -s " " | tr "\n" " "; echo; }
TAILN=0 ./run.sh final-lint s3 3072 "npx eslint --max-warnings 0 $FILES && echo ESLINT_CLEAN" >/dev/null; summary final-lint
TAILN=0 ./run.sh final-prettier s3 3072 "npx prettier --check $FILES" >/dev/null; summary final-prettier
TAILN=0 ./run.sh final-typecheck s3 3072 "npm run typecheck && echo TYPECHECK_CLEAN" >/dev/null; summary final-typecheck
TAILN=0 ./run.sh final-svelte-check s3 3072 "npm run svelte-check" >/dev/null; summary final-svelte-check
TAILN=0 ./run.sh final-suite s3 3072 "npm test -- --run" >/dev/null; summary final-suite
