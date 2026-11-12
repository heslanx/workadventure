# Phase 2, fourth pass: `RoomTimeline.svelte` (refactoring-patterns)

The user is paying down technical debt in WorkAdventure on the way to 1,000 simultaneous users, responsive weak devices and an answer to the eight-user freeze. Phase 1 put a safety net under `play/src/front/Chat/Components/Room/RoomTimeline.svelte` (1,107 lines, Svelte 5 runes), the chat timeline. This pass moves the code that builds the timeline's rows out of the component without changing what it renders, and touches only code that net pins. First it pins the two Gaps of row P1 that the move would carry: the day labels, and poll, question and system rows inside a sender's run. Then it moves the rows' builder into `RoomTimelineRenderItems.ts`, and deletes a commented-out line in `scrollToTimelineEvent`.

Baseline: `HEAD` = `40f7184b1`. `RoomTimeline.svelte` sha256 `31d1fe306edc2d6cce35a0fc56dead76f3b7380ff6e950fefea9993303281136`, `RoomTimelineRenderItems.ts` `a51c08b32841a4b210b4c960cc0bd43dd28babba71c92d13ca3dd9e4510f14ea`, `RoomTimelineCharacterization.test.ts` `0fc310a11b76ef3848eed645ee1bc5ac74844957f4d9d2c65821be840ebd4879`. No file in the checkout was edited outside this folder.

## Deliverables and stack order

Apply in this order with `git apply` from the repository root. Each patch is the diff between two consecutive stages of a scratch repository built from `git archive HEAD`, one commit per item.

| # | file | kind | smell or gap | sha256 | `RoomTimeline.svelte` after | `RoomTimelineRenderItems.ts` after | characterization test after |
|---|---|---|---|---|---|---|---|
| 1 | `01-characterize-day-labels-and-non-message-rows.patch` | characterization tests (tests only, +84 / -1 lines) | P1 gaps: the day labels (with RT-05), and poll, question and system rows inside a run | `cd955d8d525b7e4d4dfb41b71252e8320de735cd3cbff5e3242ab343376c4364` | `31d1fe30…03281136` (unchanged) | `a51c08b3…4510f14ea` (unchanged) | `646f645af31d1775a13a7147080d9470562fbb9b1d778dc860ded0d7f7ceb0c8` |
| 2 | `02-move-build-render-items.patch` | Move Function | Large component: "the render items (P1) as functions of the room" | `4b158d0f2d197a2482185f7795c7c8ba5133decb78390b38618384bc6152ab45` | `01f8debd86915a5d27091a4743230511fe3263f75dde0f68ea68c847e101a963` | `e0b9ab2cb9f47652ea7a4a6ed2448a40e508e85b4e9b2b00ee6ffe9afb1456c2` | `646f645a…` (unchanged) |
| 3 | `03-remove-dead-highlight-comment.patch` | Remove Dead Code (comment only) | commented-out forced reflow in `scrollToTimelineEvent` | `6c83aa5c200a63d391c506127f158cc5dcc40a33694e7982fcd1518083a136ba` | `fc947c74cfc9d1d0da99fdff39eddae515898e47f189ab2e35bbf1e5e8c60b35` | `e0b9ab2c…` (unchanged) | `646f645a…` (unchanged) |

Also here: `mutants.diff` (the nine mutants below, sha256 `acca5e3fe9b185cf9dcde8a3471ecd7e76a3e7ec56bd8a890abd6dd90595cd05`), `TECH-DEBT.md.rows` (ledger and Smell Inventory updates, new row RT-09), `TESTING.md.rows` (Test Strategy, Safety Net Map and backlog updates for item 1), `checks.raw.log` (every run, ANSI stripped), and the four tools that built or checked the patches: `move_render_items.py` (patch 2), `moved.py` (the multiset check of patch 2), `make_mutants.py` (the mutants) and `compile.mjs` (the Svelte compiler output). The Python scripts run with `python3 -I <script> <args>`; `compile.mjs` runs with `node /tools/compile.mjs <file>` from `play/`.

## The items

### 1. Characterization tests: day labels, RT-05, and non-message rows in a run

Three tests in `RoomTimelineCharacterization.test.ts`, after the first P1 test, with the existing harness. The harness gains three stand-ins, for `PollCard.svelte`, `QuestionCard.svelte` and `MessageSystem.svelte`, written like the four stand-ins already there, so a test can put those rows in the list without their stores. It also gains `separatorLabels()`, the text of each row without a `data-event-id`, and `vi.useRealTimers()` in `afterEach`, which undoes `vi.setSystemTime`. With fake timers off, Vitest 4.1.7's `setSystemTime` mocks `Date` only (`FakeTimers.setSystemTime`, `mockDate`), so `settle()` and `wait()` keep their real `setTimeout`.

- "ends a sender's run at a poll, a question or a system row: the message before it shows its time, the one after its header". Alice sends `a1`, a poll `p1`, `a2`, a question `q1`, `a3`, a system row `s1`, `a4` and `a5`, one minute apart; the poll, the question and the system message all have Alice as sender. The rows come in that order under one separator. `a1`, `a2` and `a3` each show their header and their time. `a4` shows its header and hides its time, and `a5` hides its header and shows its time. A non-message row resets the run because the row builder (`renderItems`, and `buildRenderItems` after patch 2) takes `currentMessage` only from a `"message"` item, so the next message has no previous message to join. The header and time flags of the three non-message rows themselves are always `true` and reach no card; only row reuse reads them, so they stay a gap.
- "labels the day separators Today, Yesterday, and an older day by its weekday, day and month". The clock is set to Wednesday 7 January 2026, 12:00 local time, and Alice has a message on the 2nd, the 6th and the 7th. The labels are the older day's `Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })` form, then "Yesterday", then "Today". The expected older label is computed in the test with the runtime's locale, because `dayLabel` passes no locale. In the container it is "Fri, Jan 2" (seen in the E1 log); computing it keeps the test passing on a machine with another default language.
- "RT-05 (pinned): computes the day labels when the timeline changes, not when the day does". At 23:59 on the 7th, one message from 23:58 sits under "Today". The clock moves to 00:01 on the 8th and the test waits 10 ms; the label still reads "Today". Bob's message at 00:01 then changes the timeline, and the labels become "Yesterday" and "Today".

The assertions were written from a reading of the code and all three passed on their first run against `HEAD`'s code, so each records an observed value; mutants E1 to E5 show that they can fail. The RT-05 test pins a known quirk as it is; it is not fixed here. One observation went to `TECH-DEBT.md.rows` under RT-05: "Today" and "Yesterday" follow the chat's locale (`LL`), and an older day follows the runtime's locale. No product file was edited to pin them.

### 2. Move Function: `buildRenderItems`

The body of `renderItems`' `$derived.by` (`HEAD` `RoomTimeline.svelte:283-338`) and everything only it used moved into `RoomTimelineRenderItems.ts`, next to `reuseUnchangedRenderItems`: `TIME_GAP_THRESHOLD` and its comment (`:85-86`), `isValidDate`, `getTimelineItemDate`, `isSameLocalDay`, `dayLabel` and `dayKey` (`:243-280`). The new exported function:

```ts
export function buildRenderItems(currentTimelineItems: readonly ChatTimelineItem[]): RoomTimelineRenderItem[] {
```

The component's derived now reads:

```ts
let renderItems = $derived.by(() => {
    const out = buildRenderItems($timelineItems ?? []);
    previousRenderItems = reuseUnchangedRenderItems(out, previousRenderItems);
    return previousRenderItems;
});
```

The data shape did not change: an array of `ChatTimelineItem` in, an array of `RoomTimelineRenderItem` (separators and items with `showHeader` and `showTime`) out, the type the module already exported. The parameter takes the name of the old local `currentTimelineItems`, so the loop line is the old line. `move_render_items.py` did the move: it asserts each boundary line of `HEAD`, copies the moved lines 4 spaces less indented, and makes the import edits. The multiset check (`moved.py` on the patch, section `moved-lines-02` of `checks.raw.log`) lists what was removed and not re-added: the `const currentTimelineItems = $timelineItems ?? [];` line (now the parameter and the call's argument), the two type imports the component no longer uses (`ChatMessage`, `ChatTimelineItem`), the old one-line imports of both files, and one `eslint-disable-next-line svelte/prefer-svelte-reactivity` directive. Everything else added is the new imports (`get`, `LL`, `ChatMessage`), the function's doc comment, signature, `return out;` and closing brace, and the new call.

What stays the same, and how each is shown:

- **When the clock and the locale are read.** `dayLabel` is the old function, unchanged: it still evaluates `new Date()` twice and `get(LL)` once per separator, on each run of `renderItems`, because `buildRenderItems` runs synchronously inside the `$derived.by`, as the inline body did. The module imports `LL` from the same `i18n-svelte` module the component imports, so `get(LL)` reads the same store. The RT-05 test and mutant R3 show the labels still follow the clock at that point.
- **What the derived depends on.** The derived still reads `$timelineItems` first, then builds, then reuses. Svelte 5 tracks the signals read while a derived runs, whatever function reads them; the moved body read no signal (`get(LL)` subscribes and unsubscribes a plain store, the same before and after). The order of the reads changed in one place: `$timelineItems` is now read before `out`, `lastDayKey` and `previousMessage` are created, which allocates nothing observable.
- **Rows, keys, labels, headers and times.** The four test files pass unchanged (byte-identical to stage 1), and the Phase 1 mutants M1 and M2 fail the same test when re-applied inside the moved function (R1, R2).
- **The eslint directive.** It disabled `svelte/prefer-svelte-reactivity` for `const yesterday = new Date();`. That rule runs on `.svelte` files; `eslint --max-warnings 0` on the `.ts` module without the directive reports nothing, so keeping it would only have added an unused directive.

| stage | `RoomTimeline.svelte` lines (script) | P1 code in the component | `buildRenderItems` | `RoomTimelineRenderItems.ts` lines |
|---|---|---|---|---|
| `HEAD` | 1,107 (788, `:1-788`) | 101 lines: constant `:85-86`, helpers `:243-280`, derived `:282-342` (61) | none | 68 |
| after patch 1 | 1,107 (788) | same | none | 68 |
| after patch 2 | 1,011 (692) | derived `:242-246` (5) | 59 (`:54-112`), helpers and constant `:9-48`, doc comment `:50-53` | 175 |
| after patch 3 | 1,009 (690) | same | same | 175 |

The script is 98 lines shorter. Its next candidates are the header and its unread-elsewhere popover, the scroll engine and the open sequence (see "Left out").

### 3. Remove Dead Code: the commented-out reflow

`scrollToTimelineEvent` (`HEAD` `:784-785`) had two commented lines between `target.classList.remove("highlight-message")` and `target.classList.add("highlight-message")`: `// // Force the highlight animation to restart when the same poll is clicked again.` and `// target.offsetWidth;`. Patch 3 deletes them and nothing else.

Does the highlight restart when the same message is focused twice today? No (inferred from the code and the CSS, not seen in a browser). Nothing removes `highlight-message` except the `remove` right before the `add`, in the same task, so the browser never computes a style without the class, and `highlight-pulse` (2 s, run once, `:995-1008` after) does not start again. The P6 test checks only that the class is present after a focus, and jsdom runs no CSS animations, so it cannot see a restart. The commented `target.offsetWidth` was the forced reflow that would have restarted it; it came in commented out with the code (`b94fa79f8`). `TECH-DEBT.md.rows` adds RT-09 (P3) for it, with a backlog item to check it in a browser first.

## Checks

Host sbh, image `node:24-trixie`, `docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none --label owner=wa-fable-20261112`, names `wa-fable-p2rt-<run>`, one at a time. The dependency tree `~/wa-jobs/wa-fable-20261112/src-review` was mounted read-only and not modified; `tmpfs` on `play/node_modules/.vite` and `.vite-temp`. The tree predates `HEAD`, so the runner (`~/wa-jobs/wa-fable-20261112/p2rt/run.sh`, copied from `rt1/run.sh`) bind-mounts `HEAD`'s copies read-only over the same paths as the MediaStore pass: `play/src/pusher`, `play/tests`, `Game.ts`, `GameScene.ts`, `MediaStore.ts`, `childWindow.test.ts`, and map-editor's `MapValidator.ts` and its test (`overlay/`, a `git archive HEAD` of exactly those paths and the `Room` directory, piped to sbh; its `Room` directory equals `p2md`'s, `diff -rq`). Over that, each run mounts one full `Room` directory, `v/<stage>` or `v/<mutant>`, like `rt1`; the stages are `git archive`s of the scratch commits, and each mutant is its stage's directory with one file replaced. Every focused run prints, from inside the container, the sha256 of `RoomTimeline.svelte`, `RoomTimelineRenderItems.ts` and the four test files. `NODE_OPTIONS=--max-old-space-size=2700` for the focused runs, 3072 for the static checks and the whole suite. Raw output: `checks.raw.log`.

| check | stage (`RoomTimeline.svelte` / characterization test) | command (in `/work/play`) | exit | result |
|---|---|---|---|---|
| 1. before any change | `HEAD` `31d1fe30…` / `0fc310a1…` | `npx vitest run` on the four files (`focus.sh`) | 0 | 4 files, 25 passed (10 + 1 + 4 + 10); `Duration` 37.95 s, of which transform 22.64 s and import 33.22 s |
| 2. after patch 1 | `31d1fe30…` / `646f645a…` | same | 0 | 28 passed (characterization 13) |
| 2. after patch 2 | `01f8debd…` / `646f645a…` | same | 0 | 28 passed |
| 2. after patch 3 | `fc947c74…` / `646f645a…` | same | 0 | 28 passed |
| 3. whole play suite | stage 3 | `npm test -- --run` | 0 | 259 files passed; 1,682 passed, 10 skipped (1,692); `Duration` 449.23 s. The MediaStore pass counted 1,679 passed on the same tree; the three more are item 1's tests (characterization file 13 tests) |
| 4. prettier | stage 3 (also stage 2, and stage 1's test file) | `npx prettier --check` on `RoomTimeline.svelte`, `RoomTimelineRenderItems.ts`, `RoomTimelineCharacterization.test.ts` | 0 | `All matched files use Prettier code style!` |
| 4. eslint | stage 3 | `npx eslint --max-warnings 0` on the same three files | 0 | no output (0 errors, 0 warnings) |
| 4. typecheck | stage 3 | `npm run typecheck` (`tsc --noEmit`) | 0 | no diagnostics |
| 4. svelte-check | stage 3 | `npm run svelte-check` (`--fail-on-warnings`) | 0 | `svelte-check found 0 errors and 0 warnings` |
| 5. mutants | see below | the focused command | 1 each | 9 of 9 killed |
| 6. compiled output | stages 0 to 3 | `node /tools/compile.mjs src/front/Chat/Components/Room/RoomTimeline.svelte` (Svelte 5.57.3 `compile`, client, not dev) | 0 each | stage 0 `c16eae52…`, stage 1 `c16eae52…` (same: patch 1 touches tests only), stage 2 `d3ce584d…`, stage 3 `59bc4b2c…`. Stage 2 to 3 differs only in the removed comment (below) |
| 7. `git apply --check` on a fresh `git archive HEAD` of `play/src/front/Chat/Components/Room` (Mac) | each patch in order, each applied after its check | `git apply --check <patch>`, then `git apply` | 0 for all six | after each apply, the three files have the stage hashes above; after patch 3 they equal the scratch stage 3 files byte for byte (`cmp`) |

After patches 2 and 3 the test files are byte-identical to stage 1: every run prints `646f645af31d1775a13a7147080d9470562fbb9b1d778dc860ded0d7f7ceb0c8` for the characterization test, `a643e7309b6db6034f6d31c35c20bad79bbbffac28936518820f9a3b548360c8` for `RoomTimelineRowReuse.test.ts`, `730ce10434f0dddd304b57280c15b0bb44e0e43b49cb67b01deb14dd03834c4a` for `RoomTimelineRenderItems.test.ts` and `b91a8d2fac594571caf83a46e741a0051610d63e42c1590994b7a3f5bb4144b8` for `RoomTimelineNewMessages.test.ts`, the last three unchanged from `HEAD`.

The compiled output of patch 3 (section `cmp-diff.txt` of `checks.raw.log`). The compiler keeps script comments, so the output changes by exactly the deleted lines and the blank line its printer puts before a comment:

```diff
807,809d806
<
< 		// // Force the highlight animation to restart when the same poll is clicked again.
< 		// target.offsetWidth;
```

The same comparison for patch 1 finds no difference, and for patch 2 a 105-line `diff`, as a moved body must (the component now calls the imported `buildRenderItems`). The saved outputs end with the runner's `EXIT 0` appended to their last line, so the comparison drops that line from each; it is `$.delegate(['click', 'touchstart']);` in all four, and the sha256 above were taken inside the container before the runner wrote anything.

## Mutant evidence

Each mutant is one change (`mutants.diff`, built by `make_mutants.py`, which asserts that the old text occurs exactly once in its stage file before changing it), run with the four test files (28 tests). E1 to E5 are against stage 1 (`HEAD`'s code, the new tests): one or more per new test, each in the branch that test pins. R1 to R4 are against stage 2, inside the moved code in `RoomTimelineRenderItems.ts`: R1 and R2 are Phase 1's M1 and M2 (`docs/audits/tech-debt/phase1-roomtimeline/mutants.diff`) re-applied there, R3 breaks a day label in the moved `dayLabel` (E1's change), and R4 changes the moved constant.

| mutant | change (stage, file, line) | counterpart | exit | failing tests and message |
|---|---|---|---|---|
| E1 | `dayLabel` returns `yesterday()` for today (s1, `RoomTimeline.svelte:265`) | none | 1 | 2 failed / 26 passed: the label test (`[ 'Fri, Jan 2', 'Yesterday', 'Yesterday' ]` instead of `… 'Today' ]`) and RT-05 (`[ 'Yesterday' ]` instead of `[ 'Today' ]`) |
| E2 | yesterday is computed as two days back (`- 2`, s1, `:262`) | none | 1 | 2 failed / 26 passed: the label test (`'Tue, Jan 6'` instead of `'Yesterday'`) and RT-05 (`[ 'Wed, Jan 7', 'Today' ]` instead of `[ 'Yesterday', 'Today' ]`) |
| E3 | an older day's weekday is `"long"` (s1, `:269`) | none | 1 | 1 failed / 27 passed: the label test, `'Friday, Jan 2'` instead of `'Fri, Jan 2'` |
| E4 | `reuseUnchangedRenderItems` keeps a separator whose label changed (`return next.kind === "separator";`, s1, `RoomTimelineRenderItems.ts:37`) | none | 1 | 2 failed / 26 passed: RT-05 (`[ 'Today', 'Today' ]` instead of `[ 'Yesterday', 'Today' ]`: the relabel on the next message is lost) and `RoomTimelineRenderItems.test.ts` "gives a new row when its grouping, time, payload or day label changes" |
| E5 | a non-message row keeps the run (`previousMessage = currentMessage ?? previousMessage;`, s1, `RoomTimeline.svelte:329`) | none | 1 | 1 failed / 27 passed: the non-message rows test, `a2`, `a3` and `a4` lose their header (`showHeader` `false` instead of `true`) |
| R1 | drop the reset of `previousMessage` after a day separator (the 3-line `if (insertedSeparator)` block, s2, `RoomTimelineRenderItems.ts:76-78`) | M1 | 1 | 1 failed / 27 passed: the first P1 test, `b3` (past midnight) loses its header, as M1 did |
| R2 | never hide the time of a message whose run continues (`… && !next.showHeader && index < 0`, s2, `:106`) | M2 | 1 | 2 failed / 26 passed: the first P1 test (`a1` shows its time, as M2 did) and the non-message rows test (`a4` shows its time) |
| R3 | E1's change inside the moved `dayLabel` (s2, `:33`) | E1 | 1 | 2 failed / 26 passed: the same two tests and messages as E1 |
| R4 | `TIME_GAP_THRESHOLD` is 10 minutes (s2, `:10`) | none (the moved constant) | 1 | 1 failed / 27 passed: the first P1 test, `a3` (6 minutes after `a2`) joins the run: `a2` hides its time and `a3` its header |

Each new test is killed by at least one mutant in its own branch: the label test by E1, E2 and E3, the RT-05 test by E4 (and by E1 and E2), the non-message rows test by E5. Each re-applied mutant fails the same test inside `buildRenderItems` as its counterpart did inline; R2 fails one more because the suite now has the non-message rows test, whose `a4` and `a5` form a run. The other test files pass in every mutant run except where named.

## Left out, and why

- The scroll engine and its state machine, the header and its unread-elsewhere popover, and the open sequence (P2) stay in the component: they were outside this pass's scope. They are the rest of the "Large component" row.
- RT-05 is pinned, not fixed; RT-02, RT-04, RT-06, RT-07 and RT-08 are untouched. RT-09 is filed, not fixed.
- The moved code keeps its redundant checks as they were (`d && isValidDate(d)` after `getTimelineItemDate` already checked it; `timelineItem?.date` on a non-optional item). Removing them is a separate cleanup; a Move Function moves.
- The header and time flags of poll, question and system rows, items without a date, and a locale change while the room is open stay gaps (see `TESTING.md.rows`). `buildRenderItems` is now a function a plain test could call for them, but item 2 had to leave the tests unchanged, so no test calls it yet.
- No independent review of the patches was run in this pass; the coordinator's verdict step applies.

## Suggested commit messages

1. `test(front): pin RoomTimeline's day labels and the rows that end a sender's run` / Today, Yesterday and an older day's short weekday, day and month with a fixed clock; RT-05 pinned as it is; a poll, a question or a system row ends a sender's run.
2. `refactor(front): move RoomTimeline's row builder into RoomTimelineRenderItems` / buildRenderItems holds the body of renderItems and its helpers unchanged; the component builds the rows from $timelineItems and reuses the unchanged ones.
3. `refactor(front): remove a commented-out reflow from scrollToTimelineEvent` / The highlight does not restart when the same message is focused twice (RT-09); the comment described a fix that never ran.

## Resources

- sbh containers started by this task: `wa-fable-p2rt-s0` to `-s3`, `-fmt-s1`, `-lint-s3`, `-fmt-s2`, `-cmp-s0` to `-cmp-s3` (twice), `-e1` to `-e5`, `-r1` to `-r4`, `-static` and `-suite`, all `--rm` and run one at a time. The first `-cmp-*` round failed (`ERR_MODULE_NOT_FOUND`: `compile.mjs` imported `svelte/compiler` relative to `/tools`); `compile.mjs` now resolves it from the working directory, and the second round overwrote those four logs. Left: 0 (`docker ps -a --filter name=wa-fable-p2rt` lists none at 08:37 UTC).
- Kept on sbh as evidence: `~/wa-jobs/wa-fable-20261112/p2rt/` (`run.sh`, `focus.sh`, `batch1.sh`, `batch2.sh`, `assemble.sh`, `tools/compile.mjs`, `overlay/`, the stage and mutant directories under `v/`, `mutsrc/`, the tarballs `s2.tar`, `s3.tar`, `mut.tar`, `logs/`, `checks.remote.log`). No other job dir was edited.
- `mut.tar` was made with macOS `tar` and `COPYFILE_DISABLE=1`; GNU `tar` on sbh printed `Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'` and wrote no `._*` file (`find` counts 0 in `p2rt`). None was created in this folder.
- `src-review` was not modified: it was mounted read-only in every run, and every mount under `/work` targets a path that already exists in the tree (`/tools` is outside it).
- The Mac scratch `/tmp/wa-p2rt` was deleted after the deliverables were copied. Nothing was committed or staged in the checkout; only this folder was written.
