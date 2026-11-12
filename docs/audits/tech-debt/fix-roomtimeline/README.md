# Fix RoomTimeline: RT-10, RT-09, RT-02 (`fixrt`)

The user is paying down technical debt in WorkAdventure on the way to 1,000 simultaneous users, responsive weak devices and an answer to the eight-user freeze. They approved three behavior fixes in the chat timeline (`play/src/front/Chat/Components/Room/`), each already pinned or ledgered: RT-10 (the day separators mix two languages), RT-09 (a second focus of the same message does not replay its highlight) and RT-02 (the room is marked read while the user reads history). This folder holds one patch per fix. Each patch is one behavior commit: it changes the code and flips or adds the test that pins the behavior.

Baseline: `HEAD` = `5deb37fd5`. `RoomTimeline.svelte` sha256 `fc947c74cfc9d1d0da99fdff39eddae515898e47f189ab2e35bbf1e5e8c60b35`, `RoomTimelineRenderItems.ts` `e0b9ab2cb9f47652ea7a4a6ed2448a40e508e85b4e9b2b00ee6ffe9afb1456c2`, `RoomTimelineCharacterization.test.ts` `646f645af31d1775a13a7147080d9470562fbb9b1d778dc860ded0d7f7ceb0c8`. The `ci` dependency tree `src-review` matches `HEAD` for all 88 files of the `Room` directory (`sha256sum -c` against `git show HEAD:<path>`). No file in the checkout was edited outside this folder; nothing was committed, branched or staged.

## Deliverables and stack order

Apply in this order with `git apply` from the repository root. Each patch is the diff between two consecutive commits of a scratch repository made from `git archive HEAD play/src/front/Chat/Components/Room`.

| # | file | fix | sha256 | `RoomTimeline.svelte` after | `RoomTimelineRenderItems.ts` after | characterization test after |
|---|---|---|---|---|---|---|
| 1 | `01-day-separators-in-chat-locale.patch` | RT-10 | `fd04e2ed9b536d0d6dbcc7e21024277fd29a7efa1d92fb6ed86759bc1eb2e87d` | `fc947c74…` (unchanged) | `9c49955446c9568811e084918c91bb7d1f6db4e01eace6567651214d76040b4d` | `b7a7478d4940d46a5c4966fd1d3e80ec6f1feb13feef7063df9d15b51d1b215b` |
| 2 | `02-replay-focus-highlight.patch` | RT-09 | `ac95fb28ee4330d9f71a65085676cc0434a47ecad288ed87e1b14aa80db46194` | `367548d35910472948dd83a1d465e1ac2e101f91de15033aa67d0a4ec11c6386` | `9c499554…` (unchanged) | `622fe8190a424f35ce24191197fb616987155295385113f3d5d449f767f4389c` |
| 3 | `03-mark-read-only-at-bottom.patch` | RT-02 | `dc69d80bc7f9dac7b7c6c3bb348083f50aa8f07f5a4adf29361b4ae477e1c719` | `7e8abfe2c80ab41e1079b46326e16bcc47a05c5747fc8c701c97f72c35b34600` | `9c499554…` (unchanged) | `dc1ead73f50e0fc87fb3dba92dac522ff63aed7bc009e2197f5f834881a49a81` |

Also here: `TECH-DEBT.md.rows` (the three rows' new status, and two new rows, RT-11 and RT-12), `TESTING.md.rows` (Safety Net Map and backlog updates), `checks.raw.log` (every run, ANSI stripped), `mutants.diff` (the six mutants), `probe.diff` (a probe run, not shipped), and the runners `run.sh`, `focus.sh` and `final.sh`.

## The fixes

The brief placed the RT-10 pin in `RoomTimelineRenderItems.test.ts`; it lives in `RoomTimelineCharacterization.test.ts` (`4ab34f19d` touched only that file), so it was flipped there. All three tests are in that file. `RoomTimelineNewMessages.ts` and its 10 tests were read first and not changed: the jump button counts the others' messages only while `autoScroll` is false and resets the count when it turns true, which is the same condition the receipt now follows.

### 1. RT-10: older day separators in the chat's language (`01-day-separators-in-chat-locale.patch`)

What changes. `dayLabel` in `RoomTimelineRenderItems.ts` formats an older day with `new Intl.DateTimeFormat(get(locale), …)` instead of `new Intl.DateTimeFormat(undefined, …)`. `locale` is the typesafe-i18n store from `i18n-svelte`, the one `PollCard.svelte`, `Message.svelte` and `TypingUsers.svelte` read as `$locale` and `ProximityChatRoom.ts` reads with `get(locale)`. `dayLabel` already reads `get(LL)` for "Today" and "Yesterday", so no signature changes and nothing is threaded from the component. Before `setLocale` runs, the store holds `undefined`, which `Intl` reads as the runtime's locale, as before.

Why. "Today" and "Yesterday" came from the chat's locale and older days from the browser's, so a browser in English showed a French chat's timeline in two languages.

The pin flips. The test "labels the day separators Today, Yesterday, and an older day by its weekday, day and month, all in the chat's language" loads `fr-FR`, sets it, and restores `en-US` with `onTestFinished`, so the later tests keep their English strings. The expected older day is `new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" })`. The container's runtime locale is `en-US` (printed by every focused run), so the test separates the two.

Test-first evidence (run `f-t1`: stage 0's code with stage 1's test file):

```
 FAIL  …/RoomTimelineCharacterization.test.ts > RoomTimeline characterization > labels the day separators Today, Yesterday, and an older day by its weekday, day and month, all in the chat's language
AssertionError: expected [ Array(3) ] to deeply equal [ 'ven. 2 janv.', 'Hier', …(1) ]
-   "ven. 2 janv.",
+   "Fri, Jan 2",
    "Hier",
    "Aujourd'hui",
 ❯ …/RoomTimelineCharacterization.test.ts:387:35
      Tests  1 failed | 27 passed (28)
```

That output is RT-10 itself: one timeline, two languages. Stage 1 (`f-s1`): 28 passed.

### 2. RT-09: the highlight replays on a second focus (`02-replay-focus-highlight.patch`)

What changes. `scrollToTimelineEvent` no longer removes and adds `highlight-message` in one task. It calls `highlightRow(target)`, which adds the class and an `animationend` listener on the row. The listener returns early for an animation that ends inside the message (it bubbles up to the row), and on the row's own `animationend` it removes the class and itself. The next focus of the same message finds no class and adds it, so `highlight-pulse` starts again. The listener is a named `const`, so the `listeners/*` ESLint rules pass (`final-lint`). When a row unmounts before its pulse ends, its listener goes with the element.

Why. The same-task remove and add gave the browser no style change, and nothing else removed the class.

Observable side effect. The class also holds the row's resting style, a 10% white background with an 8 px radius. Before, the row kept it after the pulse until it unmounted; now the row drops it when the pulse ends, at the keyframes' last value, so the end of the pulse is a step from 10% to none. Inferred from the CSS at `RoomTimeline.svelte:1006-1019` (after patch 2), not seen in a browser. If the browser check finds the step visible, ending `highlight-pulse` at `transparent` would make it a fade; that is a style change outside the approved decision, so it is not in this patch.

The new test, "RT-09 (fixed): ends the highlight when its pulse ends, so focusing the same message again plays it again", focuses `m1`, dispatches `animationend` from a `span` inside the row (the class stays), then on the row (the class goes), focuses `m1` again with the next sequence (the class is back) and ends that pulse too (the class goes). jsdom runs no CSS animation, so the test ends the pulse by dispatching the event. It pins the class lifecycle, not the pulse; a browser check that the pulse plays twice stays open.

Test-first evidence (`f-t2`: stage 1's code with stage 2's test file):

```
 FAIL  …/RoomTimelineCharacterization.test.ts > RoomTimeline characterization > RT-09 (fixed): ends the highlight when its pulse ends, so focusing the same message again plays it again
AssertionError: expected true to be false // Object.is equality
 ❯ …/RoomTimelineCharacterization.test.ts:646:31
      Tests  1 failed | 28 passed (29)
```

Line 646 is `expect(highlighted()).toBe(false)` after the row's `animationend`: on the old code the class never goes. Stage 2 (`f-s2`): 29 passed.

### 3. RT-02: the room is marked read only at the bottom (`03-mark-read-only-at-bottom.patch`)

What changes. The receipt effect's condition gains `autoScroll`, the existing "pinned at the bottom" state:

```diff
-        if ($initializationState === "ready" && pageVisible && lastRenderedKey !== undefined) {
+        if ($initializationState === "ready" && pageVisible && autoScroll && lastRenderedKey !== undefined) {
```

`autoScroll` is read reactively, so the effect also runs when it turns `true`: a scroll that reaches the bottom (`handleScroll`, or `cancelProgrammaticScroll` on a wheel or touch), the jump button (`scrollToMessageListBottom`), and the user's own message, which scrolls to the bottom. Each of those also clears the jump button's count (`$effect(() => { if (autoScroll) newMessagesCount = 0; })`), so the receipt and the count change together. The comment above the effect now says when it fires.

Why. The room was marked read on each new last message while the tab was visible, also while the user read history, so the jump button counted as new two messages the receipt already reported as read (approved decision, Key Decisions 2026-11-12).

The pin flips, and one test is added.
- "marks the room read when it opens and on each new last message at the bottom, but not while the tab is hidden or the user reads history" replaces the `30b3a76b8` pin. The hidden-tab steps run first, at the bottom, unchanged: no receipt while hidden, one when the tab is visible again. Then the user scrolls to the top and 2 messages arrive: the jump button reads "2 new messages" and `setTimelineAsRead` stays at 3 calls (it went to 4 on `HEAD`). The order changed because a hidden tab coming back while the user reads history no longer sends a receipt; that is the approved behavior.
- "RT-02 (fixed): marks the room read when the user gets back to the bottom, with the jump button or by scrolling". Open (1 call), scroll to the top, 2 messages: still 1 call. Click the jump button: the button is gone and the call count is 2. Scroll to the top again, 2 messages: still 2. Scroll back to the bottom (`scrollTop` 700 of 1000, list 300): the button is gone and the count is 3.

Test-first evidence (`f-t3`: stage 2's code with stage 3's test file):

```
 FAIL  … > marks the room read when it opens and on each new last message at the bottom, but not while the tab is hidden or the user reads history
AssertionError: expected "vi.fn()" to be called 3 times, but got 4 times
 ❯ …/RoomTimelineCharacterization.test.ts:526:40
 FAIL  … > RT-02 (fixed): marks the room read when the user gets back to the bottom, with the jump button or by scrolling
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
 ❯ …/RoomTimelineCharacterization.test.ts:537:40
      Tests  2 failed | 28 passed (30)
```

Both lines are the assertion that no receipt goes out while the user reads history. Stage 3 (`f-s3`): 30 passed.

## Checks

Host `ci`, image `node:24-trixie`, each container `docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none --label ci-job=wa-fable-20261112 --name wa-fable-fixrt-<run>`, one at a time, after reading `/proc/loadavg` (the runner waits while the 1-minute load is above 24; it waited four times, between 24.6 and 27.9, before `f-t3`). `src-review` was mounted read-only at `/work` and not modified. A copy of its `play/node_modules` (four packages, plus empty `.vite` and `.vite-temp` mount points) was mounted read-only over `play/node_modules`, with `tmpfs` on `.vite` and `.vite-temp`. Each run mounts one full `Room` directory, `v/<stage>`, `v/t<n>` (the previous stage with the next test file), `v/<mutant>` or `v/probe`, read-only over `play/src/front/Chat/Components/Room`, and prints from inside the container the sha256 of `RoomTimeline.svelte`, `RoomTimelineRenderItems.ts` and the four test files. `NODE_OPTIONS=--max-old-space-size=2700` for the focused runs, 3072 for the final checks. Runners: `run.sh`, `focus.sh` (the four test files), `final.sh`. Raw output: `checks.raw.log`, one section per run, ANSI stripped.

| check | run | stage | command (in `/work/play`) | exit | result |
|---|---|---|---|---|---|
| 1. before any change | `c1-head` | `HEAD` (no overlay) | `npx vitest run` on the four files | 0 | 4 files, 28 passed (13 + 1 + 4 + 10); 33.68 s |
| 2. RT-10 test first | `f-t1` | stage 0 + stage 1 test | same | 1 | 1 failed, 27 passed (28); assertion above |
| 2. RT-10 fixed | `f-s1` | stage 1 | same | 0 | 4 files, 28 passed |
| 2. RT-09 test first | `f-t2` | stage 1 + stage 2 test | same | 1 | 1 failed, 28 passed (29) |
| 2. RT-09 fixed | `f-s2` | stage 2 | same | 0 | 4 files, 29 passed |
| 2. RT-02 test first | `f-t3` | stage 2 + stage 3 test | same | 1 | 2 failed, 28 passed (30) |
| 2. RT-02 fixed | `f-s3` | stage 3 | same | 0 | 4 files, 30 passed (characterization 15) |
| 3. mutants | `f-m1a` … `f-m3b` | see below | same | 1 each | 6 of 6 killed |
| probe (RT-11) | `f-probe` | stage 3 + two probe assertions | same | 1 | 2 failed, as expected by the probe; see "Left out" |
| 4. eslint | `final-lint` | stage 3 | `npx eslint --max-warnings 0` on `RoomTimeline.svelte`, `RoomTimelineRenderItems.ts`, `RoomTimelineCharacterization.test.ts` | 0 | no output (0 errors, 0 warnings) |
| 4. prettier | `final-prettier` | stage 3 | `npx prettier --check` on the same three files | 0 | `All matched files use Prettier code style!` |
| 4. typecheck | `final-typecheck` | stage 3 | `npm run typecheck` (`tsc --noEmit`) | 0 | no diagnostics |
| 4. svelte-check | `final-svelte-check` | stage 3 | `npm run svelte-check` (`--fail-on-warnings`) | 0 | `svelte-check found 0 errors and 0 warnings` |
| 4. whole play suite | `final-suite` | stage 3 | `npm test -- --run` | 0 | 259 files passed; 1,684 passed, 10 skipped (1,694); `Duration` 356.61 s. The phase 2 pass counted 1,682 passed on its stage 3, whose `Room` directory equals this `HEAD`'s; the two more match the two tests added here (the RT-09 test and the new RT-02 test; the two flipped pins replace tests). The whole suite was not run on `HEAD` in this job |
| 4. i18n | none | none | none | none | not run: no translation key changed (the test reads the existing `fr-FR` strings) |
| 5. `git apply --check` (Mac) | none | a fresh `git archive HEAD play/src/front/Chat/Components/Room` | `git apply --check <patch>`, then `git apply`, in order | 0 for all six commands (three `--check`, three `apply`) | after each patch the three files have the stage hashes in the table at the top; after patch 3 the directory equals stage 3 (`diff -r`, no output) |

During the job the checkout's `HEAD` moved to `c007401b5` ("docs: add the technical-debt plan, debt ledger and safety-net map"), which changes no file under `Room`. The stack was checked again on a fresh `git archive c007401b5 play/src/front/Chat/Components/Room`: the three `git apply --check` and `git apply` exit 0, and the directory then equals stage 3 (`diff -r`, no output).

The other three test files are byte-identical to `HEAD` at every stage (`a643e730…` `RoomTimelineRowReuse.test.ts`, `730ce104…` `RoomTimelineRenderItems.test.ts`, `b91a8d2f…` `RoomTimelineNewMessages.test.ts`, printed by every run).

## Mutants

Each mutant is its stage's directory with one file changed (`mutants.diff`), run with the focused command.

| id | fix | mutant | run | result |
|---|---|---|---|---|
| R10-A | RT-10 | the browser's language: `new Intl.DateTimeFormat(navigator.language, …)` | `f-m1a` | killed: the day label test gets `"Fri, Jan 2"` (`:387`) |
| R10-B | RT-10 | one formatter built at import, `const olderDayFormat = new Intl.DateTimeFormat(get(locale), …)` at module scope, before the chat sets its locale | `f-m1b` | killed: same assertion, `"Fri, Jan 2"` |
| R09-A | RT-09 | no target check: any `animationend` in the row ends the highlight | `f-m2a` | killed: the class is gone after the animation inside the message (`:644`, `expected false to be true`) |
| R09-B | RT-09 | the listener removes itself but not the class | `f-m2b` | killed: the class stays after the row's `animationend` (`:646`, `expected true to be false`) |
| R02-A | RT-02 | `autoScroll` read with `untrack`, so only a new message reruns the effect | `f-m3a` | killed: no receipt after the jump button (`:542`, `expected … 2 times, but got 1 times`) |
| R02-B | RT-02 | gate on `!farFromBottom` (more than a screen from the bottom) instead of `autoScroll` | `f-m3b` | killed: same assertion. In jsdom the stubbed `scroll()` emits no `scroll` event, so `farFromBottom` stays true after the click; in a browser this mutant would also send a receipt while the user reads history less than a screen from the bottom (inferred from `handleScroll`), which no test pins |

## Left out, and why

- RT-11 (new row): a room that opens away from the bottom is still marked read at open. The receipt effect fires when the room is ready and has a last row, while `autoScroll` still has its initial `true`; the open then un-pins the list for the "New messages" line or a focus request. The probe run (`probe.diff`, run `f-probe`) adds `expect(room.setTimelineAsRead).toHaveBeenCalledTimes(0)` to the two open tests on stage 3, and both fail with "got 1 times". Gating on `initialMessagesLoaded` would not help: setting it in `initMessages`' `finally` queues Svelte's effect flush before the promise callbacks that run `scrollToFirstUnread` (inferred from the microtask order, not run). The fix needs a flag set once the open has chosen where to scroll, which goes beyond the approved one-condition change, so it is ledgered, not done.
- RT-12 (new row): each return to the bottom now sends a receipt, also when nothing new arrived. `MatrixChatRoom.setTimelineAsRead` posts one for the last live event every time, and `matrix-js-sdk`'s `sendReceipt` does not skip a repeat. Before the fix, scrolling sent none, and every new message sent one even while the user read history. A guard keyed on the last row reported read is possible, but a return to a visible tab or to the bottom may also clear unread thread messages that do not change the last row, so it needs its own check. Inferred from the code; not measured.
- RT-09 in a browser: the replayed pulse, and the step at the end of the pulse described above. jsdom runs no CSS animation.
- RT-05 (not in scope): the labels are still computed when the timeline changes, so a locale change while a room is open shows in the separators only at the next timeline change.
- No i18n key, no other file and no refactor changed. RT-05, RT-01 and RT-03 are untouched.

## Suggested commit messages

One commit per patch, in order.

```
fix(play): show older day separators in the chat's language

The timeline's day separators took "Today" and "Yesterday" from the
chat's locale (LL) but formatted older days with Intl.DateTimeFormat
and no locale, that is in the browser's language. A browser in English
showed "Fri, Jan 2", "Hier", "Aujourd'hui" in a French chat. Format
older days with the chat's locale store, as the other chat components
already do, so one timeline shows one language.

The day label test pinned in 4ab34f19d now runs the chat in French and
expects the older day in French ("ven. 2 janv." on Node's ICU). Fixes
RT-10.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```
fix(play): replay the highlight when the same message is focused again

scrollToTimelineEvent removed and added highlight-message in the same
task, and nothing else removed the class. A second focus of the same
message (a poll or a search result clicked again) found it already
there, the browser saw no style change, and highlight-pulse did not
start again.

Add the class with an animationend listener on the row that removes
it, and itself, when the row's own animation ends, so the next focus
adds the class again. An animation that ends inside the message is
ignored. The row no longer keeps the 10% background after the pulse.
jsdom runs no CSS animation, so the new test ends the pulse itself; a
browser check of the replayed pulse is still open. Fixes RT-09.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```
fix(play): mark a chat room read only at the bottom of the timeline

The room was marked read on every new last message while the tab was
visible, also while the user read history. The jump button then said
"2 new messages" for two messages the read receipt already reported as
read, and the other members saw the user as a reader of messages they
had not seen.

Send the receipt only while the timeline is pinned at the bottom
(autoScroll) and the tab is visible. Getting back to the bottom, by
scrolling or with the jump button, sends it then, when the button's
count clears. A hidden tab still sends nothing until it is visible
again.

The pin from 30b3a76b8 flips: while the user reads history, the two
new messages are no longer reported read. A new test covers the return
to the bottom. Fixes RT-02.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Resources

Remote job dir `/srv/ci-jobs/wa-fable-20261112/fixrt` on `ci` is kept: `run.sh`, `focus.sh`, `final.sh`, `v/` (stages, test-first variants, mutants, probe), `nm-play/` (the `play/node_modules` copy) and `logs/` (one log per run, the source of `checks.raw.log`). Containers `wa-fable-fixrt-*` left: 0 (`docker ps -a --filter name=wa-fable-fixrt`). The Mac scratch `/tmp/wa-fixrt` was removed after these files were copied here.
