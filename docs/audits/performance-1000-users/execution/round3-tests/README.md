# Round 3: missing `play` tests (chat R2, P2 F2)

Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-chat` (RoomTimeline v2 applied, `._*` files deleted first), image `node:24-trixie`, every container `--cpus 1 --memory 3g --network none`, label `owner=wa-fable-20261112`. Containers created: `wa-fable-r3-tests-1` to `-5`, all `--rm`; 0 left (`docker ps -a --filter name=wa-fable-r3-tests` is empty). Nothing ran on the Mac except reads, `git diff` and `git apply --check`.

## Patches

| Patch | File | Finding |
|---|---|---|
| `chat-roomtimeline-row-reuse-test.patch` | new `play/src/front/Chat/Components/Room/RoomTimelineRowReuse.test.ts` | chat review R2 (finding 2 of `W4/round2/review.md`) |
| `pip-childwindow-delegation-test.patch` | `play/src/front/Components/Video/PictureInPicture/childWindow.test.ts` (adds one `describe`) | P2 F2 |

Both are test-only; no product file changes. Final file sha256 (Mac scratch = sbh tree): `RoomTimelineRowReuse.test.ts` `d29fcd1e...`, `childWindow.test.ts` `e42bbca6...`.

Dependency: the row-reuse test needs the RoomTimeline v2 change (`eight-user-performance/.../W4/round2/chat-render-items-reuse.v2.patch`). At 02:12 UTC the checkout's `RoomTimeline.svelte` (sha256 `c84ec1b3...`) did not have it yet; the patch applies anyway (new file only), but the test fails on that file exactly like mutant 1 below until v2 lands.

## What the tests prove

- Row reuse: mounts the real `RoomTimeline.svelte` with a mocked room (mocks from the W4 harness). `Message.svelte` is replaced by a stand-in that subscribes a `toStore` of its props, so every time a row hands its props again it counts one read per message id. The store then rebuilds every `ChatTimelineItem` around the same messages plus one new one, as the proximity store does. Asserts the 5 existing `li` rows are the same DOM nodes, the new row is rendered, and no existing row's props were re-read.
- Delegation: mounts the real `Button.svelte` with `onclick` in the page, moves the `<button>` into an iframe's document, calls `delegateSvelteEvents(iframe window)`, clicks: the handler runs. After `stop()`, a second click does not run it (nothing else forwards the child document's clicks).

## Checks (all on sbh, `NODE_OPTIONS=--max-old-space-size=2600`)

| Check | Exit | Log |
|---|---|---|
| vitest both files in one run, default heap | 134 (V8 heap OOM before any test result; superseded) | `tests-run1.raw.log` |
| vitest `childWindow.test.ts` (first version) | 0, 2 passed | `tests-run2.raw.log` |
| vitest `RoomTimelineRowReuse.test.ts` (first version) | 0, 1 passed | `tests-run2.raw.log` |
| Mutant 1: `RoomTimeline.svelte` derive returns `out` (no `reuseUnchangedRenderItems` call) | 1, killed: `row m0 was updated: expected 4 to be 3` | `mutants-lint.raw.log` |
| Mutant 2: `delegateSvelteEvents` registers no listener | 1, killed: `expected "vi.fn()" to be called 1 times, but got 0 times` | `mutants-lint.raw.log` |
| Product files restored after mutants | sha256 back to `e1743a01...` (RoomTimeline) and `9f385f09...` (childWindow.ts) | both logs |
| eslint, first version | 1 (3 errors in the new test: promise executor return, 2 unbound-method); fixed | `mutants-lint.raw.log` |
| prettier --check, first version | 1; fixed with `prettier --write` on sbh | `mutants-lint.raw.log` |
| vitest `childWindow.test.ts` (final) | 0, 2 passed | `final-checks.raw.log` |
| vitest `RoomTimelineRowReuse.test.ts` (final) | 0, 1 passed | `final-checks.raw.log` |
| Mutant 1 rerun on final test | 1, killed (same message) | `final-checks.raw.log` |
| eslint on both test files (final) | 0 | `final-checks.raw.log` |
| prettier --check on both test files (final) | 0 | `final-checks.raw.log` |
| `git apply --check` of each patch on the checkout | 0, 0 | run on the Mac |

Mutant 2 was not rerun after the final edit: the final edit only touched `RoomTimelineRowReuse.test.ts`; `childWindow.test.ts` is byte-identical to the version that killed it.

Not run: `svelte-check` (test files only; vitest does not type-check). Scripts used: `mutants-lint.sh`, `final.sh` (piped to `bash -s` in the container).

## Notes

- `play` has no `@testing-library/svelte` dependency; existing component tests (`MessageInputChildDocument.test.ts`) use `svelte`'s `mount`, and so do these.
- The RoomTimeline test takes about 47 s per run, almost all of it module import/transform; the test body runs in under 100 ms.
- The two test files stay in the sbh `src-chat` tree (pushed there for the checks).
