# Phase 1 gate: `RoomTimeline.svelte` (working-with-legacy-code)

Date: 2026-11-12, 05:08-06:14 UTC (hard stop 06:40). Component: `play/src/front/Chat/Components/Room/RoomTimeline.svelte` (1,096 lines), the conversation view of the chat: it renders a room's messages, opens the room on the right line, follows new messages, fetches older pages on scroll, sends the read receipt, and shows the event a search result or a poll asks for. Baseline: `HEAD` = `87b3c6e03`. `HEAD`'s `RoomTimeline.svelte` has sha256 `e1743a01d947aac33efcff244112f961ef40591744e1969b004f1ffcf57fae69`. No file in the checkout was edited outside this folder. The patches were made in the scratch repo `/tmp/wa-rt1/repo`, built from `git archive HEAD`.

## Deliverables and stack order

| order | patch | sha256 | kind | summary |
|---|---|---|---|---|
| - | `seams.patch` | - | not produced | No seam needed a product edit (see "Seams"). |
| 1 | `characterization-tests.patch` | `c6ef5702e9e84f05f95f3b0ea035cfa76bc0ecf3e26fcdc3c3bbfd4ad10b3994` | tests only | Adds `play/src/front/Chat/Components/Room/RoomTimelineCharacterization.test.ts`: 9 tests at six pinch points. RT-01, RT-02 and RT-03 are pinned as they behave today. |
| 2 | `fix-RT-01.patch` | `538ca8ae7df6edd18532e43d051250b66cfa910bddec1f665a7d33c01e34ef64` | behavior + flipped test | The timeline hands the read receipts to the user's own message rows only. The RT-01 test flips from "every row" (20 of 20) to "the user's own rows" (2 of 20). |
| 3 | `fix-RT-03.patch` | `213fa428fcc17703095284f4e50803d1f757316825fd6c1873d2b52f2d8d43ce` | behavior + flipped test | `focusTimelineEvent` focuses one request at a time. The RT-03 test flips from two `scrollIntoView` calls to one. |
| - | `mutants.diff` | `483d0644cb5fa89d4dc87cb85b9a04f94645ee13b732a173c7fe13c200813485` | evidence, not to land | The 14 mutants as unified diffs against `HEAD`, one hunk each. |
| - | `checks.raw.log` | `eceafcafd9fe9f2b8b7d9956e195447bb97ea0170d148e4ce52964864ef0e8cc` | evidence, not to land | Every run on sbh, ANSI colors stripped, one section per log; the per-file pass lines of the whole-suite run are dropped. |
| 1 (lands) | `characterization-tests.v2.patch` | `9b8fb1179979a51bf3f0a8aa8b10e2eae4fef0487e511655bb55d30da3ba0215` | tests only | Replaces patch 1 (see "Coordinator round"): the same 9 tests plus a scroll-anchor test, 10 in all. |
| 2 (lands) | `fix-RT-01.v2.patch` | `a21564bfb2d9eb7c12a69b0b7c60aaf12c5596c391c7f1b10c10d9ab6f056be4` | behavior + flipped test | Patch 2 rebased on the v2 test file; same patch-id. |
| 3 (lands) | `fix-RT-03.v2.patch` | `cd95adc764bea29065048ada3982c98efe01e97cd68b1b2fcd797d177fdb5a7c` | behavior + flipped test | Patch 3 rebased on the v2 test file; same patch-id. |
| - | `mutants-v2.diff` | `bbb50b0a9229e7b6478a4400115d29202c66955e8b94ca2299ea51ffa858bad6` | evidence, not to land | M13, M15 and M16 against `HEAD`'s `RoomTimeline.svelte`. |
| - | `checks-v2.raw.log` | `2581dc315d894fdd594d60f28ae962fec784840d124bbda6d5ee0d6458d1fdb0` | evidence, not to land | The six v2 runs on sbh, ANSI colors stripped. |

The test file is sha256 `ac33569bd73dbe45609ab9774720bdccd37f9adbcee603b196a234226e396aef` after patch 1, `fd5631fa8b8b3be706447ab7e71724c1677ddf6aedcb33f07d21d0732393d97e` after patch 2 and `56b4f2ce1394d5bec97a25e5e10e79ec7c994510a3975f24552e6a5071912453` after patch 3. `RoomTimeline.svelte` is `b6bf8fc0b4adab886069ecd8b5332d7874808ea0237150fb8b660e5131da3b5e` after patch 2 and `31d1fe306edc2d6cce35a0fc56dead76f3b7380ff6e950fefea9993303281136` after patch 3. `git -C <checkout> apply --check characterization-tests.patch` exits 0. The stack check is in "Checks".

## Change points chosen

Heuristic: changing next, churn, core. `RoomTimeline.svelte` had 24 commits in the last three months and 33 in six (111 in all), nearly all chat features and their fixes from 2026-10-28 on: the jump button (`f435d69a9`, `2d7b54073`), the read receipt on arrival (`a93d1eeab`), read receipts (`12953630e`), typing members (`866852bdf`), the time in the bubble (`0c1c6c841`), the loading skeleton (`4162287f4`) and row reuse (`636ea5e9b`, today). Three parents mount it: `RoomList.svelte`, `CompactConversation.svelte` and `ThreadPanel.svelte`. The freeze and weak-device work will change what each timeline change and each receipt costs, so the change points are the paths that run per change.

- **C1: the rows a timeline change produces** (`renderItems`, `:281-341`). Recent churn: the time on the last message of a run (`0c1c6c841`), row reuse (`636ea5e9b`).
- **C2: the open** (`onMount`, `initMessages`, `fillViewport`, `loadUntilReadMarker`, `:355-449`). Recent churn: the skeleton and the history error (`4162287f4`), the "New messages" line (`f435d69a9`).
- **C3: following new messages, and the read receipt they trigger** (`:488-559`). Recent churn: `a93d1eeab`, `f435d69a9`, `12953630e`. Changing next: the eight-user freeze asks what each arriving message and each receipt costs.
- **C4: back-pagination and focus requests** (`:675-777`, `:233-237`). The scroll code that the jump fixes keep touching.

Not chosen: the header (back arrow, unread-elsewhere popover, side-panel buttons, `:144-232`, `:794-923`). `RoomTimelineHeaderLayout.test.ts` already pins its layout rules; it is in "Gaps".

## Effect sketch

```
room prop (ChatConversation)                         chat stores
 timelineItems ─┐                                     roomTimelineFocusStore ─► C4 focus effect
 hasPreviousMessage, initializationState              selectedRoomStore, roomSidePanelStore (header)
 readReceipts ──────────────────────┐                 gameManager.chatConnection, game scene rooms (header)
 typingMembers ─► TypingUsers        │
                │                    │                DOM and timers
                ▼                    │                 scroll, wheel, touchstart ─► handleScroll
 C1 renderItems (separators, headers, times, reuse)    visibilitychange ─► pageVisible
     │      │       │        │                         ResizeObserver (rows, list) ─► pin or anchor
     │      │       │        └─► firstUnreadKey ─► "New messages" line
     │      │       └─► lastOwnMessageId ─► showReaders
     │      └─► lastRenderedKey ─► P4 read effect ─► room.setTimelineAsRead()   ◄── RT-02
     │                                                 (Matrix: sendReadReceipt to every member)
     ├─► {#each} rows ─► Message(readReceipts = $readReceipts on every row)    ◄── RT-01
     └─► P3 last-item effect ─┬─ own message ─► scroll to bottom
                              ├─ pinned (autoScroll) ─► scroll to bottom
                              └─ reading history ─► newMessagesCount ─► jump button

 C2 onMount ─► initMessages ─► ensureTimelineInitialized ─► fillViewport (≤5 pages)
              ─► loadUntilReadMarker (≤3 pages) ─► initialMessagesLoaded
              ─► .finally focusPending… ─┬─ pending request ─► focusTimelineEvent   ◄── RT-03
                                         ├─ unread does not fit ─► scroll to the line
                                         └─ else ─► scroll to bottom ("auto")
              initialMessagesLoaded ─► focus effect ─► focusTimelineEvent            ◄── RT-03

 C4 handleScroll ─► 100 ms ─► loadMorePreviousMessages (one at a time) ─► capture and restore anchor
```

## Pinch points

- **P1: `renderItems`** (`:281-341`). Every timeline change meets here. A test reads its effect as the rows and the props each message row receives.
- **P2: the open sequence** (`:355-449`). It decides the loading, error, empty and message states, and how many pages the open fetches.
- **P3: the last-item effect** (`:511-559`). It decides whether a new message scrolls, is counted, or both.
- **P4: the read effect** (`:488-509`). The only caller of `room.setTimelineAsRead()`.
- **P5: back-pagination** (`:675-729`). The only caller of `room.loadMorePreviousMessages()` after the open.
- **P6: focus requests** (`:233-237`, `:457-470`, `:741-777`). The only caller of `scrollIntoView` and of `room.ensureTimelineEventVisible()`.

`RoomTimelineRowReuse.test.ts` already pins that appending a message does not update the rows already shown. `RoomTimelineRenderItems.test.ts` and `RoomTimelineNewMessages.test.ts` pin the two helper modules alone. These tests pin what the component does with them.

## Seams

No seam needed a product edit, so there is no `seams.patch`. The harness is the one `RoomTimelineRowReuse.test.ts` already uses (Svelte's `mount` in jsdom), extended at the same boundaries.

| seam | technique | enabling point |
|---|---|---|
| The room (`ChatConversation`) | Object seam: a structural fake built per test. Its stores are `writable`s the test drives (`timelineItems`, `initializationState`, `hasPreviousMessage`, `readReceipts`); its methods are `vi.fn` spies (`ensureTimelineInitialized`, `loadMorePreviousMessages`, `ensureTimelineEventVisible`, `setTimelineAsRead`) that a test can hold with a deferred promise. | test `fakeRoom()` |
| `Message.svelte` | Link seam (`vi.mock`): a stand-in that records the `showHeader`, `showTime` and `readReceipts` it is handed, and counts how many times the row is handed its props again. | test top |
| `GameManager`, `UIWebsiteManager` | Link seams, as in `RoomTimelineRowReuse.test.ts`: the chat connection, the game scene flags and an empty room list. Without them the import cycle through `GameScene` fails (RT-08). | test top |
| `MessageInputBar`, `ChatMessageBanner`, `TypingUsers`, `EnteredZoneBanner` | Link seams: empty components. They sit outside the message list. | test top |
| Layout | jsdom has none. `scrollHeight` (1,000 px) and `clientHeight` (300 px) of the list come from a test object, `scrollTop` is stored and clamped, `scroll()` and `scrollIntoView()` are recorded. `ResizeObserver` is a no-op. `document.visibilityState` reads a test variable. | test `beforeEach` |
| Identity and text | `localStorage` holds the user's chat id (`@me:test`), which the component reads when it is created. The `en-US` locale is loaded, so the tests read the user's text ("2 new messages", "Couldn't load the messages"). | test `beforeAll`, `beforeEach` |

`RoomSidePanelStore` (the focus store), `RoomTimelineRenderItems`, `RoomTimelineNewMessages`, `RoomTimelineLoading`, `Button`, i18n and `LocalUserStore` are the real modules. The tests read only what the user and the room can observe: the rows and their order, the props of each message row, the visible text, the scroll calls, and the calls the timeline makes on the room.

## Tests and the behavior each pins

File: `play/src/front/Chat/Components/Room/RoomTimelineCharacterization.test.ts` (9 tests). The expected values were written from the code, then run. All nine passed on the first run (`probe2`), the three ledger pins included; the mutants below show that each one can fail.

| # | test | pinch point | pins |
|---|---|---|---|
| 1 | groups a sender's run under one header and one time, and starts a new run after 5 minutes or at a new day | P1 | Rows `[separator, a1, a2, a3, b1, b2, separator, b3]`. `a1` header and no time, `a2` no header and the time; `a3` (6 minutes later) and `b3` (3 minutes after `b2`, past midnight) start new runs. |
| 2 | opens by initializing the timeline, then fetches older pages while the list does not overflow, five at most | P2 | The skeleton shows and no page is fetched while `ensureTimelineInitialized` is pending. Then 5 pages, then "No message sent yet!", then one instant scroll to the bottom. |
| 3 | fetches up to three more pages to reach the read marker, then opens on the New messages line instead of the bottom | P2 | Page 1 fills the list, page 2 brings the marker: 2 pages in all. The line is on Bob's first message after the marker; no scroll to the bottom; `scrollTop` 0. |
| 4 | shows the load error when a history page fails, and its retry runs the whole open again | P2 | "Couldn't load the messages" and the retry button. The retry initializes again and fetches again, and the empty state replaces the error. |
| 5 | follows new messages at the bottom, counts the others' messages while the user reads history, and jumps back for the user's own | P3 | While the list follows the bottom, a message scrolls smoothly to 1,000 px. After the user scrolls up: no scroll, "2 new messages". The user's own message scrolls to the bottom and hides the button. |
| 6 | marks the room read when it opens and on each new last message, also while the user reads history, but not while the tab is hidden | P4 | `setTimelineAsRead` 1 call at open, 2 after a message, 3 after two messages that the jump button counts as new (RT-02), still 3 after a message in a hidden tab, 4 when the tab comes back. |
| 7 | RT-01 (pinned): a read receipt update hands its props again to every message row, not only to the user's own | P4 | 20 rows, 2 of them the user's. One receipts update hands props again to 20 of 20 rows, and every row holds the new receipts. |
| 8 | fetches one older page 100 ms after the user scrolls near the top, and never a second one while it is pending | P5 | Two scroll events: no page at 50 ms, 1 page by 150 ms. A scroll while it is pending: no page. After it resolves, a scroll fetches one more. |
| 9 | scrolls a focus request's message into view and highlights it, and asks the room for a message it has not loaded | P6 | A request pending at open: `scrollIntoView` on `m1` twice (RT-03), `highlight-message` on its row, no bottom scroll. A request for another room: nothing. A request for `older`: `ensureTimelineEventVisible("older")`, then `scrollIntoView` on it. |

After `fix-RT-01.patch`, test 7 becomes "RT-01 (fixed): a read receipt update hands its props again to the user's own message rows only": the updated rows are `mine1` and `mine2`, and an other's row holds no receipts. After `fix-RT-03.patch`, test 9 expects `scrollIntoView` once on `m1`, then once on `older`.

## The two fixes

`fix-RT-01.patch` changes one attribute: `readReceipts={item.timelineItem.message.isMyMessage ? $readReceipts : undefined}`. `Message.svelte` reads its `readReceipts` prop only through `hasReadReceipt`, which requires `isMyMessage` (`Message.svelte:120-131`, `:266-267`, `:417-421`), and both components read the same `message.isMyMessage` field. So an other's row renders the same with no receipts, and it no longer depends on the receipts store. The user's own rows still receive every update (test 7 checks `mine1` holds the new receipts).

`fix-RT-03.patch` makes `focusTimelineEvent` a single-flight wrapper around the old body, renamed `scrollToTimelineEvent`. A second call for the request already in flight returns at once, and the flag clears when the first one ends, so a later retry of the same request still runs. A first version (`v1-f-stack`) instead removed the focus from the open path and left it to the effect. It passed, but it made the open's bottom scroll depend on the effect not having finished first: if the effect consumed the request before the open's `.finally` ran, the open would scroll to the bottom over the focused message. `HEAD` does not have that ordering dependency, so the first version was dropped and `f-stack` is the run of the delivered one.

## Checks

Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-review` (play with deps), mounted read-only. Image `node:24-trixie`, `--rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none`, label `owner=wa-fable-20261112`, names `wa-fable-rt1-*`, `NODE_OPTIONS=--max-old-space-size=2700` (3072 for the whole suite). One `rt1` container at a time. Vite writes its bundled config and its cache under `play/node_modules`, so the runner puts a `tmpfs` on `play/node_modules/.vite` and `.vite-temp` (`probe1` failed with `EROFS` before that).

The tree predates `HEAD`. A git blob comparison of the 3,399 files `HEAD` tracks under `play/`, `libs/` and the root `package.json` found 32 that differ or are missing in the tree. They are the files under `play/src/front/Chat/Components/Room` (four, `RoomTimeline.svelte` among them), `play/src/pusher` and `play/tests`, plus `Game.ts`, `GameScene.ts`, `MediaStore.ts`, `childWindow.test.ts`, map-editor's `MapValidator.ts` and its test, eight `package.json` files, `play/Dockerfile`, and one character PNG whose non-ASCII name `git ls-tree` quotes, so the comparison could not open it. The runner (`rt1/run.sh`) bind-mounts `HEAD`'s copies read-only over those three directories and six source files (overlay built from the scratch repo), like the MediaStore and SocketManager runners. Each variant is a full copy of `HEAD`'s `Room` directory with its `RoomTimeline.svelte` and test file (`rt1/v/<name>`, made by `rt1/tools/mkvariant.sh`), mounted over that directory. The `package.json` files are not overlaid: they would not match the installed dependencies (see "Gaps"). The tree was not modified.

The runs are in `checks.raw.log`, one section per log file (`f-*` for the final runs). "Stage 1" is the test file after patch 1 on `HEAD`'s code; "stage 2" adds patch 2; "stage 3" is the full stack.

| check | stage | command (in `/work/play`) | exit code |
|---|---|---|---|
| first runs of the new tests | 1, draft | `npx vitest run src/front/Chat/Components/Room/RoomTimelineCharacterization.test.ts` | `probe1`: 1 (`EROFS` writing vite's temp config, no test ran). `probe2`, with the two `tmpfs` mounts: 0 (9/9) |
| vitest, characterization tests on `HEAD` | 1 | the vitest command | 0 (9/9, `Duration` 26.8 s, tests 0.8 s) (`f-pin`) |
| vitest, flipped RT-01 test on `HEAD`'s `RoomTimeline.svelte` | 2 test, 1 code | the vitest command | 1 (the RT-01 test only, 8 passed): `expected [ 'm0', 'm1', 'm2', 'm3', 'm4', …(15) ] to deeply equal [ 'mine1', 'mine2' ]` (`f-flip1`) |
| vitest, fix RT-01 | 2 | the vitest command | 0 (9/9, 27.9 s) (`f-fix1`) |
| vitest, flipped RT-03 test on stage 2's `RoomTimeline.svelte` | 3 test, 2 code | the vitest command | 1 (the focus test only, 8 passed): `expected [ 'm1', 'm1' ] to deeply equal [ 'm1' ]` (`f-flip3`) |
| vitest, stage 3 test file on `HEAD`'s `RoomTimeline.svelte` | 3 test, 1 code | the vitest command | 1 (the RT-01 and the focus tests, 7 passed), the two messages above (`f-flip3h`) |
| vitest, the superseded first RT-03 fix | 3, draft | the vitest command | 0 (9/9) (`v1-f-stack`); dropped, see "The two fixes" |
| eslint, prettier, typecheck, first final round | 1, draft | as in the `f-static1` row below | eslint 1 (`require-atomic-updates` on `scrollCalls = []` after an `await`, test line 376), prettier 0, `tsc` 0 (`v1-f-static1`). Fixed by clearing the two recording arrays in place; every `f-*` run in this table was repeated on the fixed files |
| vitest, fix RT-03 (full stack) | 3 | the vitest command | 0 (9/9, 26.9 s) (`f-stack`) |
| mutants M1-M14 | 1 | the vitest command, each mutant's `RoomTimeline.svelte` in its variant | 1 for 13 of them, 0 for M13 (`f-m1` to `f-m14`; table below) |
| eslint, prettier, typecheck | 1 | `npx eslint --max-warnings 0 <test>`, `npx prettier --check <test>`, `npm run typecheck` (`tsc --noEmit`) | eslint 0, prettier 0, `tsc` 0 (`f-static1`) |
| eslint, prettier, typecheck, svelte-check | 3 | the same on the test file and `src/front/Chat/Components/Room/RoomTimeline.svelte`, then `npm run svelte-check` | eslint 0, prettier 0, `tsc` 0, svelte-check 0 ("0 errors and 0 warnings") (`f-static3`) |
| whole play suite | 3 (full stack) | `npx vitest run`, `--max-old-space-size=3072` | 0 (259 files, 1,675 passed and 10 skipped, 418 s) (`f-suite`). The superseded first round on the lint-failing test file had the same counts (398 s, `logs-v1/f-suite.log` in the sbh job dir) |
| whole play suite, baseline | `HEAD` | the same | 0 (258 files, 1,666 passed and 10 skipped, 413 s) (`f-suite-head`): the stack adds exactly the new file and its 9 tests |
| `git -C <checkout> apply --check characterization-tests.patch` | 1 | - | 0 |
| stack `apply --check` then `apply`, patches 1 to 3, on a fresh `git archive HEAD` copy | 1, 2, 3 | `git apply --check`, `git apply` | 0 for all six; the results match the sha256 values in "Deliverables" (`/tmp/wa-rt1/stackcheck`) |

## Mutant evidence

Each mutant is one plausible regression in `HEAD`'s file, run against the stage 1 test file (`ac33569b…`). The mutants are in `mutants.diff`. The script that wrote them, `make_mutants.py`, replaces one exact string per mutant and fails unless that string occurs once; it is in the sbh job dir (`rt1/files`, `rt1/tools`).

| mutant | pinch point | change (`HEAD` line) | result | failing tests |
|---|---|---|---|---|
| M1 | P1 | drop the reset of `previousMessage` after a day separator (`:304-306`) | exit 1, 1 failed / 8 passed | test 1: `b3`, past midnight, loses its header |
| M2 | P1 | never hide the time of a message whose run continues (`:334`) | exit 1, 1 failed / 8 passed | test 1: `a1` shows its time |
| M3 | P2 | `fillViewport` allows one more round (`remainingRounds > 0`, `:408`) | exit 1, 1 failed / 8 passed | test 2: 6 pages instead of 5 |
| M4 | P2 | drop `loadUntilReadMarker` from the open (`:433`) | exit 1, 1 failed / 8 passed | test 3: 1 page instead of 2 |
| M5 | P2 | a failed page never sets `historyLoadFailed` (`:437`) | exit 1, 1 failed / 8 passed | test 4: "No message sent yet!" instead of the load error |
| M6 | P3 | the user's own message no longer scrolls back (`:541`) | exit 1, 1 failed / 8 passed | test 5: no scroll for the user's message |
| M7 | P3 | a new message scrolls even while the user reads history (`:552`) | exit 1, 2 failed / 7 passed | tests 5 and 6: a smooth scroll, then no jump button |
| M8 | P4 | mark the room read even while the tab is hidden (`:506`) | exit 1, 1 failed / 8 passed | test 6: 4 calls instead of 3 |
| M9 | P5 | drop the one-page-at-a-time guard (`:694`) | exit 1, 1 failed / 8 passed | test 8: a second page while the first is pending |
| M10 | P5 | no debounce: fetch at 0 ms instead of 100 ms (`:690`) | exit 1, 1 failed / 8 passed | test 8: a page before 50 ms |
| M11 | P6 | drop the fallback that asks the room for an event it has not loaded (`:752`) | exit 1, 1 failed / 8 passed | test 9: `ensureTimelineEventVisible` never called |
| M12 | P6 | accept a focus request for another room (`:454`) | exit 1, 1 failed / 8 passed | test 9: `m2` scrolled into view |
| M13 | P5 | drop `restoreScrollAnchor()` after a page (`:705-707`) | exit 0, 9 passed | survives: the anchor is not pinned (see "Gaps") |
| M14 | P4 (RT-01) | hand no receipts to any row (`:1021`) | exit 1, 1 failed / 8 passed | test 7: no row updated |

Each pinch point has at least one killed mutant, and each killed mutant fails only tests that pin its pinch point. The exception is M7, whose extra scroll also pins the user to the bottom, so test 6 then finds no jump button. M13 is the one survivor, and the backlog's first item is the test that would kill it.

## Coordinator round

The cross-family verdict (`gpt-6-luna`, `../../performance-1000-users/execution/verdicts/debt-p1-roomtimeline.md`) returned PASS with no finding. Before landing, the coordinator closed the surviving mutant M13 in the scratch repo `/tmp/wa-rt2/repo`.

M13 drops the restore after a page ends. A second path restores the same anchor: the last-item effect (`:546-550`) runs `restoreScrollAnchor()` when the items change while an anchor is held. In the open and in Matrix back-pagination the older items arrive before the page's promise resolves, so the effect restores first and the `.then` restore finds a zero delta. M13 is equivalent in that flow; the `.then` restore matters only when layout changes between the prepend and the page's end, which jsdom cannot produce. The behavior is now pinned instead: `layOutRows()` fakes `getBoundingClientRect` with 50 px rows stacked in DOM order and moved by the list's `scrollTop`, and the new test holds a page, scrolls by hand to 10 px (not 0, where the loader row would shift the rows by itself), prepends three messages, then ends the page. The message the user was reading keeps its position (`scrollTop` 10 to 160) and does not move when the page ends. `afterEach` now restores spies (`vi.restoreAllMocks()`), so the rect fake and the existing `console.error` spy do not leak into later tests.

| Run | `RoomTimeline.svelte` | test file | Exit | Result |
|---|---|---|---|---|
| `v2-pin` | `HEAD` | v2 stage 1 | 0 | 10 passed |
| `v2-m13` | `HEAD` without the `.then` restore | v2 stage 1 | 0 | 10 passed: equivalent, see above |
| `v2-m15` | `HEAD` without the effect's restore | v2 stage 1 | 1 | the anchor test fails: `expected 10 to be 160` |
| `v2-m16` | `HEAD` without both | v2 stage 1 | 1 | the anchor test fails, same message |
| `v2-stack` | patches 1 to 3 | v2 stage 3 | 0 | 10 passed |
| `v2-static` | patches 1 to 3 | v2 stage 3 | 0 | `eslint --max-warnings 0` and `prettier --check` on the test file 0, `npm run typecheck` 0 |

The fix patches keep their patch-ids, so their flips are unchanged. The whole play suite was not rerun for v2 on sbh; CI run 6 runs it on the landed head.

## Ledger items found

RT-01 to RT-08, in `TECH-DEBT.md.rows`. Three were pinned: RT-01 (performance, fixed by `fix-RT-01.patch`), RT-02 (quirk, a product decision, left as is) and RT-03 (bug, fixed by `fix-RT-03.patch`). RT-04 to RT-08 come from reading the code and building the harness, and are not pinned.

RT-02 is two features that disagree. `a93d1eeab` (2026-10-29) sends the receipt for every message that arrives while the room is open and the tab is visible, because "a hidden tab has not seen anything". `f435d69a9` (2026-10-28) counts the messages that arrive while the user reads history as new. Both are pinned in test 6: the room reports read the two messages that the jump button calls new. Requiring `autoScroll` in the read effect would make the receipt follow the user back to the bottom, but that changes what the other members see, so it is left to the product owner.

## The eight-user freeze

The component takes no user count or presence as an input. Its per-event work runs once per timeline change and once per receipts update. What scales:

- Measured in the fakes (a count, not a cost): one receipts update hands props again to all 20 loaded rows (test 7, RT-01), and `setTimelineAsRead` runs once per new last message while the tab is visible (test 6). These are deterministic counts of what the timeline hands its children and calls on the room; the main-thread time they cost in a browser was not measured.
- Inferred from the code, not measured: in a Matrix room with eight active members, each message makes the seven other clients call `setTimelineAsRead`, which sends a read receipt (`MatrixChatRoom.ts:1953-1964`). Each client then receives up to seven receipts per message. `MatrixChatRoom.readReceipts` coalesces a burst into one update per 250 ms and recomputes the receipts over every live event (`:328-343`, `:1919-1924`), and before `fix-RT-01.patch` each update re-hands props to every loaded row. The arriving message itself (`RoomEvent.Timeline`) triggers the same recompute. The cost per message grows with the members (receipts) times the loaded rows, and with eight people talking it repeats for every message. `fix-RT-01.patch` cuts the row part to the user's own rows; the Matrix recompute is outside this component and stays.
- Inferred: the proximity chat (the bubble) has no `readReceipts` (`ProximityChatRoom.ts` defines none), so RT-01 does not apply there. There each message costs the linear passes of RT-07, which grow with the loaded messages, not with the users.
- Cameras on or off change none of this. None of these is shown to cause the freeze: the browser measurement is the last backlog item in `TESTING.md.rows`.

## Gaps

- The scroll anchor after a prepend is pinned since v2 through faked row rectangles. Mutant M13 (no restore after a page) survives as an equivalent mutant of the tested flow (see "Coordinator round").
- The `ResizeObserver` paths (a pinned list re-pinned by late layout, an anchored list held) are not pinned; the observer is a no-op.
- The header (back arrow, unread-elsewhere popover, side-panel buttons), drag-and-drop of files, `touchstart`, the jump button click, the encrypted room that needs a key, a failed initialization (`initializationState` `"error"`), the thread timeline, the proximity room's empty state, typing members, and poll, question and system rows are not pinned.
- RT-04 to RT-08 are not pinned.
- jsdom has no layout and no smooth scrolling: the geometry is a fixed 1,000 px list in a 300 px viewport, and every room call resolves at once unless a test holds it.
- The sbh tree's installed dependencies predate `HEAD`'s `package.json` files: it has `phaser` 4.2.0 and `@types/node` 25.9.1 where `HEAD` asks for 4.2.1 (`6dae0b409`) and `^24.19.2` (`ee295d729`). Every run here, the type checks and the whole suite included, used the installed versions.
- `TESTING.md.rows` and `TECH-DEBT.md.rows` were the worker's drafts. The coordinator merged them into `docs/TESTING.md` and `docs/TECH-DEBT.md` with the v2 changes.

## Resources

Containers `wa-fable-rt1-*` on sbh, `--rm`, one at a time: 50 runs. They are `probe1` and `probe2`, the first final round (24 runs, logs moved to `logs-v1/`), the final round (23 runs) and `f-suite-head`. The last one ended at 06:10 UTC. Left: 0 (`docker ps --filter label=owner=wa-fable-20261112` lists no `rt1` container). Remote dir `~/wa-jobs/wa-fable-20261112/rt1` stays until the coordinator releases the job dir. It holds the runner `run.sh`, the batches `batch1.sh` to `batch3.sh`, the `HEAD` overlay (`overlay/`, `overlay.tgz`), the variants (`v/`), the inputs (`files/`, `files.tgz`, `pin.test.ts`), the tools (`tools/`: `make_mutants.py`, `mkvariant.sh`, `lintfix.py`, `assemble.sh`), the blob comparison (`head-blobs.tsv`, `tree-blobs.tsv`, `paths.txt`, `differ.txt`, `a`, `b`), the logs (`logs/`, `logs-v1/`) and `checks.raw.log`. No `._*` file was created there (`find` counts 0). One slip: the first `mkdir` over ssh expanded `~` on the Mac side and created an empty `/Users/<mac user>/wa-jobs/wa-fable-20261112/rt1/logs` on sbh at 05:10 UTC. It was removed at once (`ls -d /Users` then reported no such file). Mac scratch `/tmp/wa-rt1` was removed after the deliverables were copied here.
