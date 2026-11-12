set -u
export NODE_OPTIONS=--max-old-space-size=2600
F1=src/front/Chat/Components/Room/RoomTimeline.svelte
F2=src/front/Components/Video/PictureInPicture/childWindow.ts
T1=src/front/Chat/Components/Room/RoomTimelineRowReuse.test.ts
T2=src/front/Components/Video/PictureInPicture/childWindow.test.ts
echo "== sha before"; sha256sum $F1 $F2
cp $F1 /tmp/F1.bak; cp $F2 /tmp/F2.bak
echo "== mutant 1: RoomTimeline returns out without reuseUnchangedRenderItems"
perl -0pi -e 's/previousRenderItems = reuseUnchangedRenderItems\(out, previousRenderItems\);\n\s*return previousRenderItems;/return out;/' $F1
grep -n "reuseUnchangedRenderItems\|return out;" $F1
npx vitest run $T1 2>&1 | grep -v "^\s*$" | tail -40; echo "EXIT_MUTANT1_ROWREUSE=${PIPESTATUS[0]}"
cp /tmp/F1.bak $F1
echo "== mutant 2: delegateSvelteEvents registers no listener"
perl -pi -e 's/const stops = DELEGATED_EVENTS\.map\(\(eventName\) => on\(target\.document, eventName, \(\) => \{\}\)\);/const stops = [target].map(() => () => {});/' $F2
grep -n "const stops" $F2
npx vitest run $T2 2>&1 | grep -v "^\s*$" | tail -40; echo "EXIT_MUTANT2_CHILDWINDOW=${PIPESTATUS[0]}"
cp /tmp/F2.bak $F2
echo "== sha after restore"; sha256sum $F1 $F2
echo "== eslint"; npx eslint $T1 $T2; echo "EXIT_ESLINT=$?"
echo "== prettier"; npx prettier --check $T1 $T2; echo "EXIT_PRETTIER=$?"
