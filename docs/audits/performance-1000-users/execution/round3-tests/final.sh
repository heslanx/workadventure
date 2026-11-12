set -u
export NODE_OPTIONS=--max-old-space-size=2600
F1=src/front/Chat/Components/Room/RoomTimeline.svelte
T1=src/front/Chat/Components/Room/RoomTimelineRowReuse.test.ts
T2=src/front/Components/Video/PictureInPicture/childWindow.test.ts
echo "== test sha"; sha256sum $T1 $T2 $F1
echo "== vitest childWindow"; npx vitest run $T2 2>&1 | grep -v "^\s*$" | tail -8; echo "EXIT_VITEST_CHILDWINDOW=${PIPESTATUS[0]}"
echo "== vitest row reuse"; npx vitest run $T1 2>&1 | grep -v "^\s*$" | tail -8; echo "EXIT_VITEST_ROWREUSE=${PIPESTATUS[0]}"
cp $F1 /tmp/F1.bak
echo "== mutant 1 rerun"
perl -0pi -e 's/previousRenderItems = reuseUnchangedRenderItems\(out, previousRenderItems\);\n\s*return previousRenderItems;/return out;/' $F1
grep -n "return out;" $F1
npx vitest run $T1 2>&1 | grep -v "^\s*$" | grep -i "AssertionError\|Tests \|failed\|passed" | head -6; echo "EXIT_MUTANT1_ROWREUSE=${PIPESTATUS[0]}"
cp /tmp/F1.bak $F1; sha256sum $F1
echo "== eslint"; npx eslint $T1 $T2; echo "EXIT_ESLINT=$?"
echo "== prettier"; npx prettier --check $T1 $T2; echo "EXIT_PRETTIER=$?"
