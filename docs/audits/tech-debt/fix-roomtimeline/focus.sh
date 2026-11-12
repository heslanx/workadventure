#!/usr/bin/env bash
# usage: focus.sh <suffix> <stage> [extra test files]: the four RoomTimeline test files, heap 2700
D=src/front/Chat/Components/Room
suffix=$1; stage=$2; shift 2
exec /srv/ci-jobs/wa-fable-20261112/fixrt/run.sh "$suffix" "$stage" 2700 "node -e 'console.log(\"runtime locale:\", Intl.DateTimeFormat().resolvedOptions().locale)' && npx vitest run $D/RoomTimelineCharacterization.test.ts $D/RoomTimelineRowReuse.test.ts $D/RoomTimelineRenderItems.test.ts $D/RoomTimelineNewMessages.test.ts $*"
