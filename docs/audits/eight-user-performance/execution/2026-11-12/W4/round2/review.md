# Review: chat-render-items-reuse.patch (lane chat, round 2)

Reviewer: independent, did not write the change. Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-chat`, container `wa-fable-r2-chat-review-1` (removed; 0 left). Raw log: `review.raw.log`.

Verdict: **PASS_WITH_NITS** (no blocker or major; two minor findings to fix in a follow-up).

## What was checked

| Check | Result |
|---|---|
| `git apply --check` of the patch on the checkout | exit 0, checkout unchanged |
| Remote tree matches patch | sha256 of `RoomTimelineRenderItems.ts` in src-chat equals the patch content (`24e52982...`); RoomTimeline.svelte has the import and the two `previousRenderItems` lines at 48/241/340-341 |
| vitest `RoomTimelineRenderItems`, `RoomTimelineNewMessages`, `RoomTimelineHeaderLayout` | 15 passed |
| Mutant 1: helper never reuses (`return item`) | tests 1 and 3 fail (killed) |
| Mutant 2: ignore `showTime` | test 2 fails (killed) |
| Mutant 3: ignore payload identity | tests 2 and 3 fail (killed) |
| Helper restored after mutants | sha256 back to `24e52982...` |
| eslint on the 3 changed files | exit 0 |
| prettier --check on the 3 changed files | exit 0 |

Not rerun by the reviewer (time box, deadline 01:52 UTC): the W4 harness measurements and `svelte-check`. The author's raw logs (`base.raw.log`, `after.raw.log`, `svelte-check.raw.log`) are the only evidence for those.

## Correctness

- The derived still builds rows, separators, sender grouping and `showTime` exactly as before; the helper only swaps a new row for the previous object when key, label (separator) or showHeader, showTime, kind, id, date time and payload identity (item) match. Ordering comes from `next`, so it is kept.
- `firstUnreadKey`, `lastRenderedKey` and scroll effects still see a new array on each change, so unread divider, scroll-to-bottom and anchors keep working.
- Assigning a plain `let` inside `$derived.by` is allowed (only `$state` writes are rejected); the variable is intentionally not reactive.
- Root-cause claim is consistent with the code: the proximity store rebuilds every `ChatTimelineItem`, so before the patch each row value changed identity on every append, and the keyed each re-ran every row's effects.

## Findings

1. **minor - in-place mutated fields no longer refresh incidentally.** `ProximityChatPoll.update()` (`play/src/front/Chat/Connection/Proximity/ProximityChatPoll.ts:71`) mutates `this.sender` and returns early when the poll is otherwise unchanged; `ProximityChatQuestion.ts:74` does the same. `PollCard.svelte:30` reads `poll.sender`. Before the patch, any later timeline change re-ran the row and picked up the new sender; now the row is reused while the poll object identity is unchanged, so the author label can stay stale. Plausible, not reproduced dynamically. Fix: expose sender through a store in the poll/question model, or include the sender identity in the reuse comparison, with a test.
2. **minor - no regression test at the component level.** Removing the `reuseUnchangedRenderItems` call in `RoomTimeline.svelte` makes no test fail (author acknowledges it). The helper tests are good (all three mutants are killed), but the wiring is unguarded. Fix: a RoomTimeline render test that appends one item and asserts an existing row's child is not re-rendered (for example a spy on a child prop read or a DOM node identity plus effect count).
3. **nit - measurement conditions.** Baseline and patched trees ran concurrently on the same host (1 CPU each); the 2000-item patched run 3 is an outlier (224 ms vs 101/109). Medians are still a ~9x gain, but a sequential rerun would make the spread trustworthy. jsdom script time only, no browser trace (stated by the author).
4. **nit - svelte-check needed a 2600 MB heap.** The default-heap run OOMed with no diagnostics; the passing run used `NODE_OPTIONS=--max-old-space-size=2600`. Fine as evidence, but say so wherever "svelte-check passed" is quoted.
5. **nit - redundant alias.** `type RenderItem = RoomTimelineRenderItem;` in the component could be dropped in favour of the imported name.

## Brief coverage

- Root cause found and fixed for the identity churn: yes.
- Remaining O(N) per append (derive, keyed reconcile, `querySelectorAll` in `syncContentResizeObservations`) and all-mounted DOM: correctly left open (needs virtualization/history cap, A05).
- Docs claims checked against code: the helper's doc comment and the README's list of compared fields match the implementation.
