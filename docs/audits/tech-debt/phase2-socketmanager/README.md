# Phase 2, first pass: `SocketManager.ts` (refactoring-patterns)

The user is paying down technical debt in WorkAdventure on the way to 1,000 simultaneous users, responsive weak devices and an answer to the eight-user freeze. Phase 1 put a safety net under `play/src/pusher/services/SocketManager.ts` (1,822 lines), the pusher's hub between each browser socket and the back. This pass makes the connection code easier to read without changing what it does, and touches only code that net pins. First it pins the one P1 handler the net missed, the back stream's `error` handler. Then it extracts the three inline stream handlers of `handleConnectToRoom` into named methods, deletes commented-out code, fixes a misleading comment and types the constructor parameter as its interface.

Baseline: `HEAD` = `08040b7e0`. `SocketManager.ts` sha256 `de35ca77ede250a94ab9ec44bb9baa32febb07b6ffd7e9b0904384fb09c68673`, `SocketManagerRoomTraffic.test.ts` `b134cb30208ec6c0a696ec578bf9ba7f370190120d90f37fa77aa53ab8b87674`. No file in the checkout was edited outside this folder.

## Deliverables and stack order

Apply in this order with `git apply` from the repository root. Each patch is the diff between two consecutive stages of a scratch repository built from `git archive HEAD`, one commit per item.

| # | file | kind | smell or gap | sha256 | `SocketManager.ts` after | test file after |
|---|---|---|---|---|---|---|
| 1 | `01-characterize-back-stream-error-handler.patch` | characterization test (tests only, +20 lines) | P1 gap "the back stream's `error` handler" | `26bef11614cead0d1e0170c41a396eb58492a8a53077a6674cd1cc242f7a7478` | `de35ca77…09c68673` (unchanged) | `4226acd7fb0a4d9987ca56d8173a33fc12a0d15deeba7442925871d50e488e83` |
| 2 | `02-extract-back-stream-handlers.patch` | Extract Method, three times | long method with three inline stream handlers | `8aa5bd9992c879aac12baf0f384cc0567f2b45ce38be5a406accdab190ee4bae` | `6b1c2d74f2b99a14d5ac292ebd8c55d93539c1ad5e0aecd93c38ed71c47b6a3f` | `4226acd7…` (unchanged) |
| 3 | `03-remove-commented-out-code.patch` | Remove Dead Code (8 comment lines deleted) | commented-out code | `ede0d0f324f0247d36ea74c380af8f8420ead3bfb795480147b6994c3c821ee9` | `f95e6c47b7af69fa208ece157a795ed0a7d54848092977b2a87faa641ff32fb7` | `4226acd7…` (unchanged) |
| 4 | `04-handleSetPlayerDetails-comment.patch` | comment corrected (1 line) | misleading comment | `9eb1d738b68c3f5365a2c02d278e6d0cee83934661c88c94f118a738ff5c659f` | `1971079921dd5a704aba08451efdf8bcaeeb0a8b7a1352387ae9612be3b43e6c` | `4226acd7…` (unchanged) |
| 5 | `05-extract-space-connection-interface.patch` | Extract Interface (type-only), test cast removed | constructor parameter typed as the class | `7cc82aafa365630dadd6f6d0f7b1acae42a498112dc8b2c5b3e6cc946b186963` | `4c6ffd630ca6d2aa1960776fddf59bcc9a9678259f98f5100648091acc5dae64` | `f8b7e36007edbc646ae2f7e6f6324cc92c1003fa0b5de742f6d7852c131f243d` |

Also here: `mutants.diff` (the eight mutants below, sha256 `212c2ea1f3cd57e4985f9a5aacb93b30aa45ba18c5c800164eefdf84a54b5283`), `TECH-DEBT.md.rows` (Smell Inventory updates), `TESTING.md.rows` (Safety Net Map, Test Strategy and backlog updates for item 1) and `checks.raw.log` (every run, ANSI stripped).

## The items

### 1. Characterization test: the back stream's `error` handler

New test in `SocketManagerRoomTraffic.test.ts`, after the `end` test: "closes the socket once when its back stream fails, and relays nothing afterwards". It connects and joins one socket, then the socket's back stream emits `error`, then a late `roomJoinedMessage`, then a second `error`. It asserts what the handler (`HEAD` `:347-370`) does today:

- The socket is closed once, with `WS_CLOSE_CODE_SESSION_DESTROYED` (4000) and `"Error while connecting to back server"`. The second `error` closes nothing more, because the handler skips a disconnecting socket.
- The cleanup runs once: the socket's back stream is ended once, its zone (0,0) is unsubscribed, the room stream is cancelled once and the room is removed.
- Nothing is relayed after the error: the socket received only the first `roomJoinedMessage`.

The test silences `console.error` (the handler logs the error with a timestamp) and does not assert on it. It does not pin the SM-02 remainder: the late join still writes `userId` and calls the stubbed `analyticsTimedEventTracker.open`, and nothing checks either. No product file was edited to pin it; the fake streams of Phase 1 already emit `error`. Mutants E1, E2 and E3 below each fail it.

### 2. Extract Method: the three stream handlers of `handleConnectToRoom`

The `data`, `end` and `error` handlers became private methods placed right after `handleConnectToRoom`. The registration now reads as three steps:

```ts
streamToBack
    .on("data", (message: ServerToClientMessage) =>
        this.handleMessageFromBack(client, socketData, message, backConnectionClose),
    )
    .on("end", () => this.closeSocketWhenBackEnds(client, socketData, apiClient, backConnectionClose))
    .on("error", (err: Error) => this.closeSocketWhenBackFails(client, socketData, apiClient, err));
```

- `handleMessageFromBack(client, socketData, message, backConnectionClose)` holds the old `data` body: the empty-message return, the `switch` (join, refresh, close reason with its `return`), then the relay guarded by `isDisconnecting()`.
- `closeSocketWhenBackEnds(client, socketData, apiClient, backConnectionClose)` holds the old `end` body with its `try`/`catch`.
- `closeSocketWhenBackFails(client, socketData, apiClient, err)` holds the old `error` body with its `try`/`catch`.

The data shape that needed a decision: the `data` handler wrote a `let backConnectionCloseReason` that the `end` handler read later, in another event. A method cannot share a local, so the `let` became a holder object, `const backConnectionClose: BackConnectionClose = { reason: undefined }`, created at the same point in `handleConnectToRoom` and passed to both methods. `BackConnectionClose` is a one-field module type (`{ reason: string | undefined }`, after `:106`). The write and the read changed from `backConnectionCloseReason` to `backConnectionClose.reason`, and nothing else in them.

What stays the same, and how each is shown:

- **Statements and their order.** A multiset check of the patch file (`moved.py`, whitespace stripped) lists every removed line that was not re-added. They are the three `.on(…) => {` openers and their three closers, the `let` declaration, the close-reason write and read (re-added as `backConnectionClose.reason …`), the `SocketData` import line (re-added with `SocketData`), and the two-line `socketData.spaceUserId = …` statement, which `prettier` joins into one line once it is 12 spaces less indented. Every other line of the three bodies is re-added unchanged, in the same order, with the same early `return`s and `try`/`catch` blocks. The check's output is in `checks.raw.log` (section `moved-lines`).
- **`this`.** Each listener is an arrow function written inside `handleConnectToRoom`, as before, so its `this` is the `SocketManager` that `handleConnectToRoom` ran on. It calls the new method on that same `this`. The tests check the binding at run time: `handleMessageFromBack` calls `this.handleViewport` and both close methods call `this.closeWebsocketConnection`, so a wrong `this` would throw on the first join or close, and the join, `end` and `error` tests pass on stages 2 to 5. Mutants R1 and R4 below act through those calls inside the new methods and fail tests.
- **`socketData` is passed, not re-read.** The bodies use the `socketData` that `handleConnectToRoom` read once at the start. `PusherWebSocket.getUserData()` delegates to the uWS socket (`PusherWebSocket.ts:51-52`), so re-reading it inside the `end` or `error` method, which can run after the socket closed, would add a call that did not exist before. The methods take it as a parameter instead.
- **`apiClient` is passed, not resolved early.** The `end` and `error` bodies call `apiClient.getChannel().getTarget()` inside their `try`, at event time, as before. `apiClient` is typed `RoomManagerClient`, which is what `apiClientRepository.getClient` resolves to (`libs/shared-utils/src/ApiClientRepository.ts:18`).
- **No public API changed.** The three methods are `private`; no name was renamed.

`eslint`'s `listeners/no-inline-function-event-listener` is already disabled from `:138` to the end of the file by the comment above the admin handlers, so the inline arrows need no new disable. The admin stream handlers (`HEAD` `:138-233`) were not touched.

| stage | `handleConnectToRoom` lines | extracted methods (lines) | `SocketManager.ts` lines |
|---|---|---|---|
| `HEAD` | 148 (`:257-404`) | none | 1,822 |
| after patch 2 | 59 (`:261-319`) | `handleMessageFromBack` 45 (`:321-365`), `closeSocketWhenBackEnds` 34 (`:367-400`), `closeSocketWhenBackFails` 29 (`:402-430`) | 1,848 |
| after patch 5 | 59 (`:262-320`) | 45 (`:322-366`), 34 (`:368-401`), 29 (`:403-431`) | 1,841 |

### 3. Remove Dead Code: the commented-out statements

Eight comment lines deleted, no statement touched:

- In `leaveRoom` (`HEAD` `:859-862`): `//Client.leave(Client.roomId);` and `//delete Client.roomId;`, two statements on a `Client` identifier that the file no longer declares, both present since `4c1e566a6` (2020, the commit that created the pusher), and `//user leave previous room`, the label of the first one. The live block above it keeps its own label, `//user leaves room`. The brief said to keep explanatory prose; this line was deleted because, once the call under it is gone, it explains nothing that remains. Put it back if that reading is wrong.
- In `handleRemoveSpaceFilterMessage` (`HEAD` `:1316`, `:1324-1327`): `//await this.checkClientIsPartOfSpace(…)` and the `/*console.error(…); Sentry.captureException(…);*/` block. The prose comments that explain why the method skips the membership check and the error stay, so the `else` branch now holds only those three comment lines.

`handleRemoveSpaceFilterMessage` is not in the Safety Net Map. Only comments changed there, which the compiled-output check below confirms.

### 4. The misleading comment on `handleSetPlayerDetails`

"Useless now, will be useful again if we allow editing details in game" is wrong. The browser sends `SetPlayerDetailsMessage` for every status, voice-indicator, chat-ID and outline-color change (`play/src/front/Connection/RoomConnection.ts:940-965`). The method keeps the status for spaces joined later (pinned by `SocketManagerSetPlayerDetails.test.ts`), forwards the message to the back, and updates the user in every space the socket is in. The method's name does not say where the details go, so the comment was replaced, not deleted: "Sends the new details (the status, for instance) to the back and to every space the user is in."

### 5. Extract Interface: the constructor parameter

`constructor(private _spaceConnection = new SpaceConnection())` became `constructor(private _spaceConnection: SpaceConnectionInterface = new SpaceConnection())`, with `import type { SpaceConnectionInterface }`. The default is the same object, and `Space`, the only consumer of the field (`HEAD` `:536`, after `:563`), already takes `SpaceConnectionInterface` (`Space.ts:112`). The test's cast became removable, so this patch removes it: `} satisfies SpaceConnectionInterface as unknown as SpaceConnection);` is now `});`, and the comment that explained the cast and the unused `SpaceConnection` type import are gone. The `satisfies` went with the cast, because the parameter's type now does the same excess-property check. The test passes the same fake object, so its behavior is unchanged (16 of 16 pass on stage 5, same as stage 4).

## Checks

Host sbh, image `node:24-trixie`, `docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none --label owner=wa-fable-20261112`, names `wa-fable-p2sm-<run>`, one at a time. The dependency tree `~/wa-jobs/wa-fable-20261112/src-review` was mounted read-only and not modified; `tmpfs` on `play/node_modules/.vite` and `.vite-temp`. The tree predates `HEAD`, so the runner (`~/wa-jobs/wa-fable-20261112/p2sm/run.sh`, written after `p2gs/run.sh`) bind-mounts `HEAD`'s copies read-only over the same paths as p2gs: `play/src/pusher`, `play/tests`, `play/src/front/Chat/Components/Room`, `Game.ts`, `GameScene.ts`, `MediaStore.ts`, `childWindow.test.ts`, map-editor's `MapValidator.ts` and its test. Those copies come from `git archive HEAD` of exactly those paths (`overlay.tgz`). p2gs's blob comparison found this list on `052f2d840`; `git diff --stat 052f2d840 HEAD` changes only `GameScene.ts`, which the overlay now carries at `HEAD` (`699f7356…`). Over that, each run mounts its stage's `SocketManager.ts` and `SocketManagerRoomTraffic.test.ts` from `v/<stage>/`. `NODE_OPTIONS=--max-old-space-size=2700` for the focused runs, 3072 for the static checks and the whole suite. Raw output: `checks.raw.log`.

The four test files of every focused run are `SocketManagerRoomTraffic.test.ts`, `SocketManagerClientGauge.test.ts` (`5faed84b…`), `SocketManagerSpaceStateQuery.test.ts` (`872b3466…`) and `SocketManagerSetPlayerDetails.test.ts` (`6e0a9cbb…`); each run prints their sha256 from inside the container. The last three are `HEAD`'s bytes in every run.

| check | stage (`SocketManager.ts` / RoomTraffic test) | command (in `/work/play`) | exit | result |
|---|---|---|---|---|
| 1. before any change | `HEAD` `de35ca77…` / `b134cb30…` | `npx vitest run` on the four files | 0 | 4 files, 15 passed (9 + 3 + 2 + 1) |
| 2. after patch 1 | `de35ca77…` / `4226acd7…` | same | 0 | 16 passed (RoomTraffic 10) |
| 2. after patch 2 | `6b1c2d74…` / `4226acd7…` | same | 0 | 16 passed |
| 2. after patch 3 | `f95e6c47…` / `4226acd7…` | same | 0 | 16 passed |
| 2. after patch 4 | `19710799…` / `4226acd7…` | same | 0 | 16 passed |
| 2. after patch 5 | `4c6ffd63…` / `f8b7e360…` (cast removed) | same | 0 | 16 passed |
| 3. whole play suite | `4c6ffd63…` / `f8b7e360…` | `npm test -- --run` | 0 | 259 files passed; 1,677 passed, 10 skipped (1,687); `Duration` 408.4 s. Phase 2 for GameScene counted 1,676 passed on the same tree before this pass; the one more is the new test |
| 4. eslint | stage 5 | `npx eslint --max-warnings 0 src/pusher/services/SocketManager.ts tests/pusher/SocketManagerRoomTraffic.test.ts` | 0 | no output (0 errors, 0 warnings) |
| 4. prettier | stage 5 | `npx prettier --check` on the same two files | 0 | `All matched files use Prettier code style!` |
| 4. typecheck | stage 5 | `npm run typecheck` (`tsc --noEmit`) | 0 | no diagnostics |
| 5. mutants | see below | the focused command | 1 each | see below |
| 6. `git apply --check` on a fresh `git archive HEAD` of `play/src/pusher` and `play/tests` | each patch in order, each applied after its check | `git apply --check <patch>`, then `git apply` | 0 for all ten | after each apply, both files have the stage hashes above; after patch 5 they equal the stage 5 files byte for byte (`cmp`) |

Two more checks of the structure-only claims:

- **Moved lines (patch 2).** `moved.py` on the patch file, described under item 2. Section `moved-lines` of `checks.raw.log`.
- **Compiled output (patches 3 to 5).** `npx esbuild src/pusher/services/SocketManager.ts --format=esm | sha256sum` per stage. esbuild drops types and the comments inside function bodies, and keeps the comments in front of class members. Stage 2 and stage 3 give the same output (`f9b967ca…`), so patch 3 deleted only comments. Stage 4 and stage 5 give the same output (`ccd41e06…`), so patch 5 changed only types. Stages 3 and 4 differ in one output line, the comment in front of `handleSetPlayerDetails` (sections `esb-*` and `esb-s3-s4` of `checks.raw.log`), so patch 4 changed only that comment. Stage 1 differs from stage 2 (`82812cf8…`), as an Extract Method must.

## Mutant evidence

Each mutant is one changed line (`mutants.diff`), run with the four test files. E1 to E3 are against stage 1 (`HEAD`'s code, the new test), R1 to R5 against stage 2 (the extracted methods). R1, R2 and R3 are Phase 1's M1, M2 and M4 (`docs/audits/tech-debt/phase1-socketmanager/mutants.diff`) re-applied inside `handleMessageFromBack`. R4 is E2 re-applied inside `closeSocketWhenBackFails`. R5 breaks the one new piece of plumbing, the close-reason holder, inside `closeSocketWhenBackEnds`.

| mutant | change (line in its stage file) | counterpart | exit | failing tests and message |
|---|---|---|---|---|
| E1 | `if (!client.isDisconnecting()) {` becomes `if (client.isDisconnecting()) {` in the `error` handler (`:359`): an error never closes the socket | none | 1 | 1 failed / 15 passed: the new test, `expected [ { message: { …(2) } }, …(1) ] to deeply equal [ { message: { …(2) } } ]` (the late `roomJoinedMessage` is relayed) |
| E2 | the same guard becomes `if (true) {` (`:359`): every error closes again | none | 1 | 1 failed / 15 passed: the new test, `expected [ [ 4000, …(1) ], [ 4000, …(1) ] ] to deeply equal [ [ 4000, …(1) ] ]` |
| E3 | `WS_CLOSE_CODE_SESSION_DESTROYED,` becomes `1011,` in the error close (`:362`), the code the admin handler uses | none | 1 | 1 failed / 15 passed: the new test, `expected [ [ 1011, …(1) ] ] to deeply equal [ [ 4000, …(1) ] ]` |
| R1 | drop `this.handleViewport(client, client.getUserData().viewport);` in `handleMessageFromBack` (`:337`) | M1 | 1 | 8 failed / 8 passed: every RoomTraffic test that expects zones after a join (M1 failed 7 of 9; the new test is the eighth), e.g. `expected [] to deeply equal [ { message: { …(2) } }, …(1) ]` |
| R2 | `return;` becomes `break;` after storing the close reason in `handleMessageFromBack` (`:357`) | M2 | 1 | 1 failed / 15 passed: the `end` test, `alice.sent` has 2 messages instead of 1 |
| R3 | drop `socketData.userId = message.message.roomJoinedMessage.currentUserId;` in `handleMessageFromBack` (`:333`) | M4 | 1 | 1 failed / 15 passed: the zone fan-out test, `expected [ 'userJoinedMessage', …(1) ] to deeply equal []` (the user receives its own join) |
| R4 | `if (!client.isDisconnecting()) {` becomes `if (true) {` in `closeSocketWhenBackFails` (`:419`) | E2 | 1 | 1 failed / 15 passed: the new test, the same message as E2 |
| R5 | `backConnectionClose.reason ?? "No close reason…"` becomes `undefined ?? "No close reason…"` in `closeSocketWhenBackEnds` (`:377`): the end handler ignores the reason the data handler recorded | none (new plumbing) | 1 | 1 failed / 15 passed: the `end` test, `expected [ [ 4000, …(1) ] ] to deeply equal [ [ 4000, 'Back lost: Room deleted' ] ]` |

Each re-applied mutant fails the same tests in the extracted method as its counterpart did inline, so the net still covers the moved code. The three other test files pass in every mutant run. Phase 1's M6 and M7 (in `deleteRoomIfEmpty` and `leaveRoom`) sit outside the moved code, so they were not re-applied.

## Left out, and why

- The admin stream handlers in `handleAdminRoom` (`HEAD` `:138-233`) have the same shape and stay inline: nothing pins them.
- `handleMessageFromBack`'s `switch` was not split per `$case`. It is pinned, but one Extract Method per handler was the scope of this pass.
- No behavior fixes. The SM-02 remainder (the late join's `userId` write and analytics `open`), SM-01, SM-03, SM-05 and SM-07 are as they were, and the moved code carries them unchanged.
- The duplicated "thinks he is in space" block, `refreshRoomData` and the God-class split were out of scope.
- No independent review of the patches was run in this pass; the coordinator's verdict step applies.

## Suggested commit messages

1. `test(pusher): pin what SocketManager does when a socket's back stream fails` / The error handler closes the socket once with WS_CLOSE_CODE_SESSION_DESTROYED and "Error while connecting to back server", cleans up once, and relays nothing after it.
2. `refactor(pusher): extract the back stream handlers of handleConnectToRoom` / handleMessageFromBack, closeSocketWhenBackEnds and closeSocketWhenBackFails hold the handler bodies unchanged and in order; the close reason the data handler records for the end handler moves into a holder object.
3. `refactor(pusher): remove commented-out code from SocketManager`
4. `docs(pusher): say what handleSetPlayerDetails does` / The browser sends this message on every status change; the old comment called the method useless.
5. `refactor(pusher): type SocketManager's space connection as its interface` / Tests can pass a fake SpaceConnectionInterface without a cast.

## Resources

- sbh containers started by this task: `wa-fable-p2sm-s0` to `-s5`, `-e1` to `-e3`, `-r1` to `-r5`, `-lint-s2`, `-esb-s1` to `-esb-s5`, `-esbout-s3`, `-esbout-s4`, `-static`, `-suite`, all `--rm` and run one at a time. Left: 0 (`docker ps -a --filter name=wa-fable-p2sm` at 07:29 UTC).
- Kept on sbh as evidence: `~/wa-jobs/wa-fable-20261112/p2sm/` (6.0 MB: `run.sh`, `focus.sh`, `batch.sh`, `batch2.sh`, `assemble.sh`, `overlay.tgz` and `overlay/`, the stage and mutant files under `v/`, `logs/`, `checks.raw.log`). No other job dir was edited.
- `src-review` was not modified: no file under its `play/src`, `play/tests` or `libs/map-editor` is newer than `p2sm/run.sh`. Every directory mount targets a path that already exists in the tree, and the two per-stage file mounts target files inside the overlay, so Docker created no mount-point files in the tree.
- Also in this folder: `extract.py`, the script that built patch 2 from stage 1 (it asserts every boundary line before moving anything; the one `prettier` rewrap described under item 2 was applied after it), and `moved.py`, the multiset check. Both run with `python3 -I <script> <file>`.
- The Mac scratch `/tmp/wa-p2sm` was deleted after the deliverables were copied. Nothing was committed or staged in the checkout; only this folder was written.
