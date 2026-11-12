# Phase 1 gate: `SocketManager.ts` (working-with-legacy-code)

Date: 2026-11-12, 03:26-04:50 UTC (hard stop 05:00). Module: `play/src/pusher/services/SocketManager.ts` (1,822 lines), the pusher's per-socket hub between the browser sockets and the back over gRPC. Baseline: `HEAD` = `1f48d79d5`, which contains `97f660a7e` ("refactor(pusher): remove code that nothing imports"). `HEAD`'s `SocketManager.ts` has sha256 `de35ca77ede250a94ab9ec44bb9baa32febb07b6ffd7e9b0904384fb09c68673`, and `PusherRoom.ts` has `7d04b48d66d7535c36fb6e5cfce551cd9a744b0867a5540c74e002e0c47ee333`. No file in the checkout was edited. The patches were made in the scratch repo `/tmp/wa-sm1/repo`.

## Deliverables and stack order

| order | patch | sha256 | kind | summary |
|---|---|---|---|---|
| - | `seams.patch` | - | not produced | No seam needed a product edit (see "Seams"). |
| 1 | `characterization-tests.patch` | `8451af9f42c947f79c65f30159b711234582231f1b3a72368add527c7cf2ec7c` | tests only | Adds `play/tests/pusher/SocketManagerRoomTraffic.test.ts`: 9 tests at five pinch points. SM-01 and SM-02 are pinned as they behave today. |
| 2 | `fix-SM-02.patch` | `98dc644349c51e6ff708264d8c0abe798b8a49c550427e325d60dde5e46fadc1` | behavior + flipped test | `PusherRoom.setViewport` ignores a socket that is not in the room. The SM-02 test flips from "the room outlives its last socket" to "the room closes with its last socket". |
| 1 (v2, lands) | `characterization-tests.v2.patch` | `84abbc8ca7e60543a90d8d166e90ba376b9f67727d4e0f2cad7560332ac6ec36` | tests only | Patch 1 plus a second socket in test 1, after the cross-family verdict (see "Cross-family verdict"). Test file sha256 `ee7d0d31…`. |
| 2 (v2, lands) | `fix-SM-02.v2.patch` | `02bfde1adc3b6a51ffc1ba426d6d7e208ddeb63c7e5ce003383476dc83dd2db1` | behavior + flipped test | The same change as patch 2, rebased on patch 1 v2 (identical +/- lines). Test file sha256 `b134cb30…`. |
| - | `mutants.diff` | `39f1ae086d95a04f15fc6aac16e6d358622edb5374e99c6477a605d63d003f42` | evidence, not to land | The nine mutants as unified diffs against `HEAD`, one hunk each. |
| - | `mutant-M10.diff` | `28329ad1cb5e7e51cf4609ea6869d2f46d3124e6ef2e791c444db7f0be8a0ec3` | evidence, not to land | One back stream per manager instead of per socket. |
| - | `checks.raw.log` | `f1ed61eb84d008b8b57874c0c4af05417cdd9c03944022b08bb1b2721f77e882` | evidence, not to land | The final runs, with ANSI colors stripped. |

The test file is sha256 `a3f7624b821f247100ca24dcc8323965c7b2494a8f5d2e18f5d40731ba8f0ded` after patch 1 and `289f9ae7ed695b47834679edc040283b9b368d36db6eafae7ac298cb00c1301f` after patch 2. `PusherRoom.ts` is `a039dd5f2237c1a1f9a43611d9361ec8663cc28e725c3a18448af1a9b07b9950` after patch 2. `git -C <checkout> apply --check characterization-tests.patch` exits 0. On a copy of `HEAD`'s `PusherRoom.ts` (`/tmp/wa-sm1/stackcheck`), `apply --check` then `apply` exit 0 for patch 1 and then patch 2, and the result matches the files above byte for byte.

The fix lands in `PusherRoom.ts`, not in `SocketManager.ts`. `SocketManager.handleViewport` hands the viewport to the room, and the room owns the list of member sockets, so the room is the first place that can tell a socket that already left. The guard drops no viewport that `HEAD` keeps, as far as the code shows: `handleConnectToRoom` and `handleJoinRoom` call `pusherRoom.join(client)` in the same microtask run in which `getOrCreateRoom` resolves, so no back message (a macrotask) can reach `handleViewport` between the room entering `rooms` and the socket joining it. This is inferred from the code, and the whole play suite passes on the stack.

## Change points chosen

The 1,000-user load enters the pusher through these entry points. Each one runs once per socket or once per event, for every socket.

- **E1: `handleConnectToRoom`** (`:257-404`). It opens the per-socket gRPC stream (`connectToRoom`), joins the `PusherRoom`, and relays every back message to the browser.
- **E2: `handleUserMovesMessage` and `handleViewport`** (`:650-689`). Each move goes to the back, and each viewport moves the socket's zone subscriptions.
- **E3: the `ZoneEventListener` callbacks** (`onUserEnters`, `onUserMoves`, `onUserLeaves`, the group callbacks, `:691-728`, `:1046-1097`). Every zone event is fanned out to each watching socket through them.
- **E4: `cleanupSocket` and `leaveRoom`** (`:615-648`, `:840-930`). They release the zones, the room, the back stream and the spaces.
- **E5: `handleJoinSpace` and `leaveSpaces`** (`:510-599`, `:884-922`). Spaces (bubbles, meeting rooms) are shared per name, one per pusher.

## Effect sketch

```
browser socket ──joinRoomFront / userMoves / viewport──► IoSocketController.message
                                                          │
 E1 handleConnectToRoom(client)                           │
   apiClientRepository.getClient(roomId)                  │
   ├─ connectToRoom() ─► per-socket back stream ◄─────────┘ E2 handleUserMovesMessage
   │     write connectToRoomMessage                              write userMovesMessage
   │     on data ─┬─ roomJoinedMessage ─► socketData.userId, spaceUserId
   │              │                       handleViewport(stored viewport) ──┐
   │              │                       analytics session open             │
   │              ├─ backConnectionCloseReasonMessage ─► kept, not relayed   │
   │              └─ relay to client.send unless client.isDisconnecting()    │
   │     on end/error ─► closeWebsocketConnection ─► cleanupSocket + end     │
   └─ getOrCreateRoom(roomId) ─► PusherRoom (one per room URL)               │
         listenRoom() ─► per-room back stream                                │
         join(client) ─► listeners                                           │
                                                                             ▼
 E2 handleViewport ─► rooms.get(roomId).setViewport ─► PositionDispatcher.setViewport
         ─► subscribeZone / unsubscribeZone ─► per-room stream (first and last watcher only)
         ─► Zone.startListening(socket)

 per-room stream on data (batch)
   ├─ zoneMessage ─► PositionDispatcher.handleZoneMessage ─► Zone.notify* (each watcher, minus the user itself)
   │       ─► E3 SocketManager.onUserEnters / onUserMoves / ... ─► listener.emitInBatch   (O(watchers) per event)
   └─ variableMessage, editMapCommand, errorMessage, receivedEvent, areaPropertyVariable, entity
           ─► every room listener.emitInBatch (variables filtered by readableBy tag)

 E4 cleanupSocket (no-op once client.isDisconnecting())
   ├─ leaveRoom ─► room.leave ─► removeViewport ─► unsubscribeZone (last watcher)
   │            ─► deleteRoomIfEmpty ─► room.close ─► per-room stream cancel, rooms.delete
   │            ─► emitClientLeave (if joinedRoom), analytics closeConnection
   │            ─► per-socket back stream end()
   ├─ leaveSpaces ─► Space.forwarder.unregisterUser (removeSpaceUserQuery round trip)
   └─ leaveChatRoomArea ─► matrixProvider.kickUserFromRoom

 E5 handleJoinSpace ─► spaces.get(name) or new Space(..., _spaceConnection) + initSpace
         ─► SpaceConnection.getSpaceStreamToBackPromise (one stream per back, shared)
         ─► forwarder.registerUser ─► query addSpaceUserQuery ─► wait for addSpaceUserAnswer
```

## Pinch points

- **P1: the per-socket back stream handler in `handleConnectToRoom`** (`:276-370`). Every message from the back to one browser passes through its `data` handler. Its `end` and `error` handlers decide when the pusher closes the socket.
- **P2: `handleUserMovesMessage` and `handleViewport`.** Every local move reaches the back here. Every viewport change reaches `PusherRoom` and `PositionDispatcher` here, which decide the zone subscriptions on the per-room stream.
- **P3: the per-room stream into the `ZoneEventListener` callbacks.** A test that feeds one zone event into the room stream covers `PusherRoom`, `PositionDispatcher`, `Zone` and the `SocketManager` callbacks together, and reads what each socket receives. Room-wide broadcasts (`variableMessage`) pass through the same handler.
- **P4: `cleanupSocket`.** It is the only way out for a socket: zones, room, back stream and spaces are all released from here.
- **P5: `handleJoinSpace`.** It is the only place that creates a `Space` and the only place a socket enters one.

`PositionDispatcher` already has 23 tests of its own (`play/tests/pusher/PositionDispatcher.test.ts`), so these tests check only that the zone logic is wired to sockets and to the per-room stream, not the zone geometry.

## Seams

No seam needed a product edit, so there is no `seams.patch`.

| seam | technique | enabling point |
|---|---|---|
| The back (`apiClientRepository.getClient`) | Import seam (`vi.spyOn` on the module singleton). The fake client returns one `FakeStream` per `connectToRoom()` and per `listenRoom()`. | test `fakeBack()` |
| The space back (`SpaceConnectionInterface`) | Parameterize Constructor already exists: `new SocketManager(_spaceConnection = new SpaceConnection())`. The fake records the space it is asked to connect, and the test answers that space's queries through its `dispatcher.handleMessage`, the call the real `SpaceConnection` makes. The parameter is typed as the class, so the test casts its fake (`satisfies SpaceConnectionInterface as unknown as SpaceConnection`). An Extract Interface on that parameter is a structure-only Phase 2 candidate, not needed now. | `new SocketManager(fake)` |
| The browser socket (`PusherWebSocket`) | A structural fake cast to the class type. It records `send`, `emitInBatch` and `end`, and `end()` sets `isDisconnecting()`, as the real class does. An Extract Interface was not needed. | test `fakeSocket()` |
| `analyticsTimedEventTracker.open`, `console.warn` | Import seam, restored in `afterEach` | test `beforeEach` |

`PusherRoom`, `PositionDispatcher`, `Zone`, `Space`, `SpaceToBackForwarder` and `Query` are the real classes. The tests read only messages: what each socket receives (`send`, `emitInBatch`, `end`), what the per-socket, per-room and space streams receive (`write`, `end`, `cancel`), and `getRooms()`.

## Tests and the behavior each pins

File: `play/tests/pusher/SocketManagerRoomTraffic.test.ts` (9 tests). The expected values were written from the code, then run. The first run (the `probe1` section of `checks.raw.log`) failed 2 of 8 tests and showed that `emitInBatch` receives `{ message: { $case, ... } }`, not the bare `$case` object. The helpers were fixed, and the mutants below show that each assertion can fail.

| # | test | pinch point | pins |
|---|---|---|---|
| 1 | opens a back stream per socket and one room stream, and relays the back's messages once the user joined | P1 | (v2) A second socket gets its own stream, distinct from the first, with its own `connectToRoomMessage`, the room stream stays single, and a message on the second stream reaches only that socket. The socket's stream receives exactly `connectToRoomMessage { roomId, tag: [], canEdit: false, lastCommandId: "" }`. The room stream receives `initRoomMessage { roomId }`. An empty back message is not relayed. `roomJoinedMessage` is relayed as is, and the viewport stored at join subscribes zones (0,0) and (1,0) on the room stream. |
| 2 | closes the socket with the back's reason when its back stream ends, and relays nothing afterwards | P1, P4 | `backConnectionCloseReasonMessage` is not relayed. The stream's `end` closes the socket with `WS_CLOSE_CODE_SESSION_DESTROYED` and `"Back lost: Room deleted"`, ends the socket's stream once, unsubscribes zone (0,0), cancels the room stream and removes the room. A message after that is not relayed. |
| 3 | forwards each move to the user's back stream, then moves the zone subscriptions with the viewport | P2 | Each move is written to the socket's stream unchanged. Moving the viewport from zones 0-1 to zones 1-2 subscribes (2,0) and unsubscribes (0,0). The same viewport sent again changes nothing. |
| 4 | SM-01 (pinned): forwards a move without a viewport to the back, then throws and keeps the old zones | P2 | The move is written to the back first, then `Missing viewport in UserMovesMessage` is thrown. The zones stay. |
| 5 | sends a zone event to each socket watching the zone, except the user it is about | P3 | Two sockets in zone (0,0) share one subscription. A far socket subscribes (10,10). A join then a move of user 1 reach the other watcher as `userJoinedMessage` then `userMovedMessage` with the user's id, name and position. User 1's own socket and the far socket get nothing. |
| 6 | sends a room variable to every socket in the room that may read it | P3 | A variable with an empty `readableBy` reaches every socket. One with `readableBy: "admin"` reaches only the socket tagged `admin`. |
| 7 | keeps a room and its shared zone while a socket stays, and closes the room with its last socket | P4 | The first socket's cleanup unsubscribes only the zone nobody else watches (1,0), ends that socket's stream and keeps the room. The last socket's cleanup unsubscribes (0,0), cancels the room stream once and removes the room. |
| 8 | SM-02 (pinned): a join the back confirms after the socket closed still takes zones, and the room outlives its last socket | P1, P2, P4 | The pusher closes a socket (`cleanupSocket` then `end`, as `closeWebsocketConnection` does) while its join is in flight. The back's late `roomJoinedMessage` is not relayed, but it subscribes the closed socket's zone (10,10). After the last real socket leaves, the room stream is not cancelled and the room stays in `getRooms()`. |
| 9 | creates one space per name, shares it between sockets, and sends each join to the space back | P5 | Two sockets joining `world.meeting` share one space and one `getSpaceStreamToBackPromise` call. Each join writes one `addSpaceUserQuery` with that socket's `spaceUserId` and resolves on the answer. A join with another filter type rejects with `Error: Space filter type mismatch` and leaves the socket outside the space. |

After `fix-SM-02.patch`, test 8 becomes "SM-02 (fixed): a join the back confirms after the socket closed takes no zone, and the room closes with its last socket": the room stream gets only `subscribe(0,0)` and `unsubscribe(0,0)`, `cancel` is called once, and the room is removed.

## Checks

Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-review` (play with deps). Image `node:24-trixie`, `--rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none`, label `owner=wa-fable-20261112`, names `wa-fable-sm1-*`, `NODE_OPTIONS=--max-old-space-size=2700` (3072 for the whole suite). One container at a time.

The tree predates `HEAD`. Its `play/src/pusher`, `play/tests` and `play/src/front/Chat/Components/Room` directories, and four files (`GameScene.ts`, `childWindow.test.ts`, map-editor's `MapValidator.ts` and its test), differed from `HEAD`, and `play/src/pusher` still held the seven files `97f660a7e` deleted. The runner (`run.sh`) bind-mounts `HEAD`'s copies read-only over those three directories and four files, and the variant files over single paths. A git blob comparison of every file `HEAD` tracks under `play/` and `libs/` found no other source difference. It could not read about 300 asset paths under `play/public/resources` whose names hold spaces or quotes, and those assets play no part in these checks. The tree was not modified, and no mount point was created in it, since every mounted path already existed there.

The runs are in `checks.raw.log`, one section per log file, under the log name used on sbh (`f-*` for the final runs). "Stage 1" is the test file after patch 1 on `HEAD`'s code. "Stage 2" is the stack after patch 2.

| check | stage | command (in `/work/play`) | exit code |
|---|---|---|---|
| first run of the new tests (8 tests, before SM-02 was added) | 1, draft | `npx vitest run tests/pusher/SocketManagerRoomTraffic.test.ts` | 1 (2 failed, 6 passed): the helpers read `$case` at the wrong depth (`expected [ undefined, undefined ] to deeply equal [ 'userJoinedMessage', …(1) ]`) |
| vitest, characterization tests on `HEAD` | 1 | same | 0 (9/9, 5.4 s) |
| vitest, flipped SM-02 test on `HEAD`'s `PusherRoom.ts` | 2 test, 1 code | same | 1 (the SM-02 test only, 8 passed): `expected [ …(3) ] to deeply equal [ …(2) ]`, the late `subscribe(10,10)` |
| vitest, fix SM-02 | 2 | same | 0 (9/9) |
| eslint, test file | 1, 2 | `npx eslint --max-warnings 0 <test>`, plus `src/pusher/models/PusherRoom.ts` at stage 2 | 0, 0 |
| prettier, test file | 1, 2 | `npx prettier --check <test>`, plus `PusherRoom.ts` at stage 2 | 0, 0 |
| typecheck | 1, 2 | `npx tsc --noEmit` (= `npm run typecheck`) | 0 (22 s), 0 (25 s) |
| whole play suite | 2 (full stack) | `npx vitest run`, `--max-old-space-size=3072` | 0 (255 files, 1,646 passed and 10 skipped, 428 s). HEAD has 254 files and 1,637 passed, so the new file and its 9 tests are the difference (`f-suite` section) |
| `git -C <checkout> apply --check characterization-tests.patch` | 1 | - | 0 |
| stack `apply --check` then `apply`, patches 1 and 2, on a copy of `HEAD`'s `PusherRoom.ts` | 1, 2 | `git apply --check`, `git apply` | 0, 0, 0, 0 |

Earlier rounds failed and were fixed in the test file only. eslint flagged `unbound-method` on `expect(spaceConnection.getSpaceStreamToBackPromise)` (exit 1). Prettier flagged five long lines (exit 1). `tsc` flagged a stub returning `undefined` where `open` returns `boolean`, and the fake passed where the constructor expects the `SpaceConnection` class (exit 2). Those runs are the `static-s1`, `static-s2` and `aborted2/f-static-s1` sections of `checks.raw.log`. Every check in the table ran on the final files.

## Mutant evidence

Each mutant is one plausible regression in `HEAD`'s file, run against the stage 1 test file (`a3f7624b…`). The mutants are in `mutants.diff`.

| mutant | pinch point | change (`HEAD` line) | result | failing tests |
|---|---|---|---|---|
| M1 | P1 | drop `this.handleViewport(client, client.getUserData().viewport);` in the `roomJoinedMessage` case (`:289`) | exit 1, 7 failed / 2 passed | every test that expects zones after a join |
| M2 | P1 | `return;` becomes `break;` after storing the close reason (`:309`), so the reason message is relayed | exit 1, 1 failed / 8 passed | test 2: `alice.sent` has 2 messages instead of 1 |
| M3 | P2 | drop `this.handleViewport(client, viewport);` from `handleUserMovesMessage` (`:688`) | exit 1, 1 failed / 8 passed | test 3: the zones do not follow the move |
| M4 | P3 | drop `socketData.userId = …currentUserId;` (`:284`) | exit 1, 1 failed / 8 passed | test 5: the user receives its own `userJoinedMessage` |
| M5 | P3 | `onUserMoves` calls `this.onUserEnters(user, listener)` and returns (`:1055`), as `onGroupMoves` does for groups | exit 1, 1 failed / 8 passed | test 5: a move arrives as a second `userJoinedMessage` |
| M6 | P4 | drop `room.close();` from `deleteRoomIfEmpty` (`:926`) | exit 1, 2 failed / 7 passed | tests 2 and 7: the room stream is never cancelled |
| M7 | P4 | drop `socketData.backConnection.end();` from `leaveRoom` (`:879`) | exit 1, 2 failed / 7 passed | tests 2 and 7: the socket's back stream is never ended |
| M8 | P5 | drop `this.spaces.set(spaceName, space);` (`:541`) | exit 1, 1 failed / 8 passed | test 9, by test timeout (5,003 ms): each join builds a new space, so the third join sees no filter mismatch and waits for an answer |
| M9 | P3 (room broadcast, `PusherRoom.ts`) | `if (!readableBy \|\| userData.tags.includes(readableBy))` becomes `if (true)` (`PusherRoom.ts:145`) | exit 1, 1 failed / 8 passed | test 6: the guest receives `secret` |

Each pinch point has at least one mutant, and each mutant fails only tests that pin its pinch point. The exception is M1, which breaks the join that seven tests start from. The mutant files' sha256: M1 `a3ee2432…`, M2 `00be7e67…`, M3 `4e2e979e…`, M4 `7b39cb90…`, M5 `600de70a…`, M6 `d3b4092f…`, M7 `60d76d0e…`, M8 `e9e77a8d…`, M9 `55b76f8a…`.

## Ledger items found

SM-01 to SM-07, in `TECH-DEBT.md.rows`. One bug was pinned and fixed: SM-02. SM-01 was pinned as a quirk and left as is: no browser build omits the viewport (`RoomConnection.sharePosition` always sends one). The others come from reading the code and are not pinned.

SM-02 is reachable when the pusher itself closes a socket whose `joinRoomMessage` is still unanswered. `closeWebsocketConnection` runs `cleanupSocket`, ends the socket's gRPC stream and calls `client.end()`. Ending a gRPC duplex stream closes only the pusher's side, so the back's answer still arrives. The `data` handler checks `isDisconnecting()` only before the relay, so it still sets `userId`, opens an analytics session and calls `handleViewport`. The `end` handler that follows does nothing for a disconnecting socket, so no second cleanup removes the zones. This analysis of reachability is inferred from the code. No production log or load test shows it. In the client-initiated close (codes 1000 and 1001), `cleanupSocket` runs without setting `isDisconnecting()`, and the back stream's later `end` runs `closeWebsocketConnection`, which cleans up a second time (SM-03). That second cleanup would release such zones, so the leak needs a close started by the pusher.

## Gaps

- The group callbacks (`onGroupEnters`, `onGroupMoves`, `onGroupLeaves`, `onGroupUsersUpdated`), `onEmote`, `onPlayerDetailsUpdated` and `onError` are not pinned. Only the user join and move fan-out is.
- `handleJoinRoom`'s `joinRoomMessage` content is not pinned. The existing `SocketManagerClientGauge.test.ts` pins only its join and leave events.
- `leaveSpaces` and `handleLeaveSpace` (the `removeSpaceUserQuery` round trip) are not pinned. Test 9 covers only the join.
- The double cleanup on a client-initiated close (SM-03) is inferred, not pinned.
- `PusherRoom`'s own back `error` and `close` handlers, which close every socket of the room through `socketManager.cleanupSocket`, are not pinned. They use the module singleton, not the instance under test (SM-07).
- The admin room (`handleAdminRoom`), the query handlers, chat areas and ban paths are outside the 1,000-user change points. Ban and global messages already have tests.
- `TESTING.md.rows` and `TECH-DEBT.md.rows` are drafts for the coordinator to merge. `docs/TESTING.md`, `docs/TECH-DEBT.md` and the tracker were not edited.

## Resources

Containers `wa-fable-sm1-*` on sbh, `--rm`, one at a time, last one at 03:57 UTC. Left: 0 (`docker ps --filter label=owner=wa-fable-20261112` lists none). Remote dir `~/wa-jobs/wa-fable-20261112/sm1` (runner, overlay, logs) stays until the coordinator releases the job dir. Mac scratch `/tmp/wa-sm1`. The coordinator filled this section and the whole-suite row from the sbh logs after the worker stopped, and exported `checks.raw.log` (the `f-*` logs, ANSI stripped, per-test pass lines dropped; sha256 `c2f1a427…`).

## Cross-family verdict

`docs/audits/performance-1000-users/execution/verdicts/debt-p1-socketmanager.md` (`gpt-6-luna`, post-patch sources in the prompt): FAIL, two findings.

| Finding | Disposition |
|---|---|
| SM-02-RACE (major): the guard can drop the initial viewport if the back's `roomJoinedMessage` runs during `await this.getOrCreateRoom()` | Dismissed. The guard changes the outcome only when the room is in `rooms` and the socket has not joined. `createRoom` puts the room in `rooms` after `await room.init()`, and from there to `pusherRoom.join(client)` only promise continuations run (`return room`, the `.finally` of the creation promise, the caller's `await`). A gRPC `data` event is an I/O callback and cannot run between them. Before `rooms.set`, `handleViewport` finds no room, and HEAD drops the viewport the same way (it logs "could not find world"). So no message that HEAD applies is dropped. A synchronous `data` event from inside `write()` would hit the guard, but grpc-js does not emit one. |
| TEST-COVERAGE (minor): test 1 connects one socket, so a stream shared between sockets would pass it | Fixed in `characterization-tests.v2.patch`: test 1 connects a second socket and asserts a second, distinct stream, its own connect message, one room stream, and per-socket relay. Mutant M10 (`mutant-M10.diff`, one back stream per manager) fails 4 of 9 on stage 1: test 1 (`expected [ FakeStream{ …(8) } ] to have a length of 2 but got 1`) and, through shared state, tests 5, 7 and 8. |

Checks on the v2 files (sbh, `run.sh`, appended to `checks.raw.log`): stage 1 tests on HEAD code 9 passed; stage 2 (v2 tests, fixed `PusherRoom.ts`) 9 passed; eslint `--max-warnings 0` and `prettier --check` on the stage 2 test file exit 0. The whole play suite ran on the v1 stack (255 files, 1,646 passed); v2 changes one test of the new file only.
