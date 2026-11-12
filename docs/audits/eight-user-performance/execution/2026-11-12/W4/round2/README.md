# W4 round 2 - chat lane: per-append cost of `RoomTimeline.svelte` (2026-11-12)

Current patch: `chat-render-items-reuse.v2.patch` (3 files, +158/-5). It fully replaces `chat-render-items-reuse.patch` (do not apply both). `git -C <checkout> apply --check` exit 0. The checkout was not modified.

## v2: review findings (review.md)

| Id | Finding | Action |
|---|---|---|
| R1 | A reused poll/question row keeps a stale author: `ProximityChatPoll.update()` and `ProximityChatQuestion.update()` set `this.sender` in place before their early return | Fixed. The helper records, in a `WeakMap` keyed by row, the payload `sender` each row was rendered with; a row is reused only while the current `payload.sender` is the same object. New test "gives a new row when a poll or question gets a new sender on the same object". Mutant (sender check removed, file overlaid read-only in container `-fix-3`): that test fails, the 3 others pass (`mutant-v2.raw.log`). |
| R2 | No component-level test fails if `RoomTimeline.svelte` stops calling the helper | Not fixed in this stage (time box). A product test needs the room/store mocks that only the W4 harness has today; see Open. |
| R3 | Before/after ran concurrently; 2000-item after-run 3 is an outlier | One sequential run of the v2 tree, alone on the lane's containers: see "v2 re-measure" below. A full sequential 3x2 rerun stays open. |
| R4 | svelte-check passes only with a larger heap | Stated here: `npm run svelte-check` passes only with `NODE_OPTIONS=--max-old-space-size=2600`; at the default V8 heap (about 1.5 GiB in a 3 GiB container) it aborts with no diagnostics. v2 result: 0 errors, 0 warnings, exit 0 (`svelte-check-v2.raw.log`). |
| R5 | Redundant `type RenderItem = RoomTimelineRenderItem` alias | Fixed: the alias is removed and the component uses `RoomTimelineRenderItem` directly. |

v2 checks (container `wa-fable-r2-chat-fix-1`, `-2`; `checks-v2.raw.log`, `svelte-check-v2.raw.log`):

| Check | Exit |
|---|---|
| `vitest run` RoomTimelineRenderItems (4 tests), RoomTimelineHeaderLayout, RoomTimelineNewMessages, both ProximityTimelineItemsStore tests: 5 files, 20 tests | 0 |
| `eslint` on the 3 changed files | 0 |
| `prettier --check` on the 3 changed files | 0 |
| `NODE_OPTIONS=--max-old-space-size=2600 npm run svelte-check` (play) | 0, "0 errors and 0 warnings" |
| Mutant: sender comparison removed | test run exit 1, only the new R1 test fails |
| `git apply --check chat-render-items-reuse.v2.patch` on the checkout | 0 |

v2 re-measure (R3): one run of the same W4 harness (sha256 `499210658c9f004e...`, `-t RoomTimeline`, `NODE_OPTIONS=--max-old-space-size=2600`) on the v2 tree, container `wa-fable-r2-chat-fix-4`, with no other lane container running (`after-v2.raw.log`). Append-one median 11.9 / 29.1 / 108.9 ms (max 52.1 / 52.7 / 184.8 ms) at 20 / 500 / 2000 items; prepend 20: 135.8 / 112.4 / 193.4 ms; DOM size unchanged (475 / 11,755 / 47,010 element nodes). This matches the v1 after-medians (10.6 / 28.6 / 109.4 ms), so the sender check costs nothing measurable, and the 224 ms 2000-item v1 outlier did not repeat in a run without a concurrent baseline. It is one run, not 3, so it gives no spread. jsdom script time only. The harness copy was deleted from `src-chat` afterwards.

The sections below describe v1; v2 keeps them and adds the sender condition to "same item".

## Root cause

`renderItems` in `play/src/front/Chat/Components/Room/RoomTimeline.svelte` is a `$derived.by` that builds a **new object for every row** on each change of `room.timelineItems`. The `{#each renderItems as item (item.key)}` block is keyed, so DOM nodes are not recreated, but Svelte 5 stores each row's value in a source and updates it whenever the value changes identity. A new object for every row means every row's source changes, so every row's template effects and every `Message`/`MessageSystem`/`PollCard`/`QuestionCard` prop read re-run for one appended message. The timeline stores make this unavoidable upstream: `createProximityTimelineItemsStore` rebuilds every `ChatTimelineItem` object on each change (`Proximity/ProximityTimelineItemsStore.ts:10`), so identity is lost before the view.

Ruled out as the main cost: the keyed `each` is present (`RoomTimeline.svelte:988`); store projection and unread helpers are about 0.1 ms at 2000 items (W4 run 2); date grouping and the `showTime` pass are plain O(N) loops; the per-append `querySelectorAll("li[data-event-id]")` in `syncContentResizeObservations` and the reconcile are O(N) but small (see what remains below).

## Change

- New `play/src/front/Chat/Components/Room/RoomTimelineRenderItems.ts`: `reuseUnchangedRenderItems(next, previous)` returns the previous row object for every key whose content is equal (separator: same label; item: same `showHeader`, `showTime`, and same timeline item kind, id, timestamp and payload object `message`/`poll`/`question`). Changed rows get the new object.
- `RoomTimeline.svelte`: the `RenderItem` type comes from that module; the derived still computes the rows, separators, grouping and `showTime` exactly as before, then passes them through `reuseUnchangedRenderItems` against the previous render (a plain non-reactive variable).
- New `RoomTimelineRenderItems.test.ts` (3 tests): unchanged rows keep identity after an append to rebuilt timeline items, order is preserved; a row changes when its grouping, time, payload or day label changes; a poll row is reused only for the same poll.

Behavior kept: ordering, day separators and labels, sender grouping, `showTime`, unread divider (`firstUnreadKey` uses the same keys), scroll-to-bottom and anchor logic (the effect still sees a new array with a new last key), read receipts and `lastOwnMessageId` (unchanged derivations).

## Measurement (W4 harness, unchanged)

Harness `../W4TimelineMeasure.test.ts`, sha256 `499210658c9f004e...` (same as W4 run 4), run with `-t RoomTimeline`, 3 runs per tree, 10 append samples per run. Trees on `sbh`: baseline = hardlink copy `src-chat-r2base` of the lane tree before the edit (`RoomTimeline.svelte` sha256 `c84ec1b3...`, equal to the checkout); after = `src-chat` with the patch (`895800df...`). Containers `wa-fable-r2-chat-impl-9` (baseline) and `-10` (after) ran concurrently, 1 CPU, 3 GiB, `--network none`, `NODE_OPTIONS=--max-old-space-size=2600` (the first attempt, containers `-5`/`-6`, hit the V8 default heap limit of about 1.5 GiB and aborted, exit 134). Svelte is the lane tree's version (P2 upgrade), not W4's 5.55.9. jsdom: script time only, no layout or paint.

Append one message, median of the 3 run medians (min-max of run medians):

| Loaded items | Baseline (ms) | After (ms) | Ratio |
|---:|---:|---:|---:|
| 20 | 35.6 (27.1-49.7) | 10.6 (8.6-16.9) | 3.4x |
| 500 | 298.2 (294.0-312.0) | 28.6 (27.5-32.8) | 10.4x |
| 2000 | 1008.3 (983.3-1019.0) | 109.4 (101.2-224.1) | 9.2x |

Prepend 20 (older page), median of 3 runs: baseline 203.7 / 380.8 / 1110.9 ms, after 155.3 / 104.9 / 170.9 ms at 20 / 500 / 2000. Mount time and DOM size unchanged (475 / 11,755 / 47,010 element nodes; all items stay mounted, 2030 at the end of the 2000 case in both trees). Raw per-run values: `base.raw.log`, `after.raw.log`.

## Checks

| Check | Where | Exit |
|---|---|---|
| `vitest run` RoomTimelineRenderItems, RoomTimelineHeaderLayout, RoomTimelineNewMessages, both ProximityTimelineItemsStore tests (5 files, 19 tests) | `-7` | 0 (`checks.raw.log`) |
| `eslint` on the 3 changed files | `-7` | 0 |
| `prettier --check` on the 3 changed files | `-7` | 0 |
| W4 harness `-t RoomTimeline`, 3 runs x 2 trees | `-9`, `-10` | 0 each (`RUNn_EXIT=0`) |
| `npm run svelte-check` (play), default heap | `-8` | 1: V8 heap out of memory, not a diagnostic (`svelte-check-run1-oom.raw.log`) |
| `npm run svelte-check` (play), 2600 MB heap, run after the measurements | `-11` | 0: "svelte-check found 0 errors and 0 warnings" (`svelte-check.raw.log`, 01:37:01 UTC) |

## Resources

Containers `wa-fable-r2-chat-impl-1..11` all `--rm`; 0 left at 01:40:31 UTC (`docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-chat-impl`). Removed on `sbh`: `src-chat-r2base`, `r2chat-scripts`, `r2chat-logs`, and the harness copy in `src-chat`. The lane tree `src-chat` keeps the patched product files. Containers `-1..-4` were a failed first launch (shell quoting); they exited at once and ran nothing.

## Open

- Linear remainder: about 0.05 ms per loaded item per append in jsdom (O(N) row derivation, keyed reconcile, `querySelectorAll` over every `li` in `syncContentResizeObservations`, and DOM size). Every loaded item stays mounted (about 23.5 nodes each); bounding that needs virtualization or a history cap (A05 proposal), not done here.
- R2 (open): the regression tests cover the helper's contract (each of 4 mutants is caught: never-reuse, ignore `showTime`, ignore payload, ignore sender); there is no component-level test that fails if `RoomTimeline.svelte` stops calling it. The W4 harness shows the effect but is not a product test; promoting its room mocks into `play/tests/front/Chat/` is the next step.
- R3 (open): a sequential 3 runs x 2 trees rerun was not done; see the v2 re-measure note for what was run.
- Browser trace (frames, layout) not measured; jsdom ratios are the evidence, not browser milliseconds.
- Matrix timeline (`MatrixChatRoom.ts`) not measured; the fix applies to it too since it works on keys and payload identity.
