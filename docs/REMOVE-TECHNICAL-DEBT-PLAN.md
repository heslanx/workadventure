# Remove Technical Debt Plan

## Context

Started 2026-11-12, 02:05 UTC, on branch `chore/orca-docker-ssh-env` (base `master` = `ddbe245a8`).

The system is WorkAdventure, an open-source TypeScript monorepo for collaborative virtual worlds. Its first commit dates from 2020-04-03, and it had 1,037 commits in the last six months. It has these parts:

- `play`: the Svelte 5 and Phaser 4 front end, plus the pusher and the Room API.
- `back`: the game server, using gRPC and protobuf.
- `map-storage`.
- shared `libs/*`.

Redis, LiveKit and Matrix are external dependencies.

Intake answers from the user:

| Question | Answer |
|---|---|
| Production | Not in production. This is a study checkout used to make upstream contributions toward 1,000 users and to explain the eight-user freeze. The worst outcome of a break is a wrong upstream PR or a regression in the shared checkout. |
| Starting modules | All four churn hotspots, one at a time, in this order: `play/src/front/Phaser/Game/GameScene.ts` (4,889 lines, 86 changes in six months), `play/src/pusher/services/SocketManager.ts` (1,824 lines, 32 changes), `play/src/front/Stores/MediaStore.ts` (1,805 lines, 35 changes), `play/src/front/Chat/Components/Room/RoomTimeline.svelte` (31 changes). |
| Test suite | Vitest suites per workspace are green in CI. On 2026-11-11 the `play` suite had 1,605 tests passing and 10 skipped. Playwright end-to-end tests live in `tests/`. Around `GameScene`, only small helpers are tested. |
| Stack | TypeScript, Svelte 5, Phaser 4, Node 24, uWebSockets in the pusher, gRPC and protobuf between pusher and back, and Redis. Business logic sits inside the Phaser scene class and inside Svelte stores. |
| Big-bang rewrite | Nobody proposed one. Debt is paid down in place. |
| Journey scope | All 8 phases. |
| Bugs found while characterizing | Pin the current behavior first and ledger it. Then fix it in a separate behavior commit whose test flips. |
| Questions during the journey | The user said: "Não pergunte mais nada. Decida, organize e faça." The coordinator decides, records each decision below, and continues. |

## Phase Status

The work has two tracks. Phases 1 to 4 run per module, one module at a time, in the order above. Each module must pass the Phase 1 gate before Phase 2 touches it. Phases 5 to 8 are cross-cutting and run after the module track.

| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 | working-with-legacy-code | done: all four modules pinned, landed and gated by CI | TESTING.md + TECH-DEBT.md | 2026-11-12 |
| 2 | refactoring-patterns | done: first pass landed for all four modules (pinned code only); CI run 10 green | TECH-DEBT.md | 2026-11-12 |
| 3 | clean-code | in-progress: GameScene.ts running | TECH-DEBT.md | |
| 4 | software-design-philosophy | pending | TECH-DEBT.md | |
| 5 | clean-architecture | pending | ARCHITECTURE.md | |
| 6 | pragmatic-programmer | pending | TECH-DEBT.md | |
| 7 | release-it | pending (deferrable: not in production, but not skippable) | RELIABILITY.md | |
| 8 | domain-driven-design | pending | ARCHITECTURE.md | |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: <reason> · skipped: <reason>

### Module track

| Module | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| `GameScene.ts` | done | first pass done (pinned code only) | in-progress | pending |
| `SocketManager.ts` | done | first pass done (pinned code only) | pending | pending |
| `MediaStore.ts` | done | first pass done (pinned code only) | pending | pending |
| `RoomTimeline.svelte` | done | first pass done (pinned code only) | pending | pending |

## Key Decisions

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-11-12 | Intake | Cover all four hotspots, one module at a time, starting with `GameScene.ts` | The user chose all four, one by one. `GameScene.ts` has the highest churn, holds the core domain, and is where the eight-user freeze is being investigated. |
| 2026-11-12 | Intake | Run Phases 1-4 per module, then Phases 5-8 across the codebase | Phase 1 gates each module separately. Boundaries, habits, reliability and context mapping need what all four modules taught. |
| 2026-11-12 | Intake | Pin found bugs, ledger them, then fix each in its own behavior commit | The user chose this. It keeps the skill's pin-first rule and the user's standing rule to fix every finding. |
| 2026-11-12 | Intake | Defer Phase 7 if needed (not in production), never skip it | The skill rule. The 1,000-user goal still needs timeouts and bounded resources. |
| 2026-11-12 | Intake | Verify everything on the remote hosts (`knc`, `sbh`) in capped containers. Commit locally with the project's pre-commit hook in a Linux container. Keep commits single-purpose: tests, structure, behavior and docs each in their own commit | The MacBook is saturated. The user allows granular local commits. The skill forbids mixing structural and behavioral changes. |
| 2026-11-12 | Intake | Keep these docs/ artifacts out of upstream PR branches | They describe this checkout's journey, not an upstream change. |
| 2026-11-12 | 1 (gate) | Dead code that has no static consumer may be removed before a module passes the Phase 1 gate (user ran `/ecc:refactor-clean`). CAUTION items also need searches for dynamic imports, string references and public APIs. Files owned by an active lane are excluded | The type checker plus each package's whole test suite prove that no static consumer exists. Removing such code cannot change the behavior the safety net pins. |
| 2026-11-12 | 1 (gate) | Refactor-clean runs each package's whole suite once per batch and bisects on failure, instead of once per deleted item. It typechecks after every item | A whole play suite on a capped 1.5-CPU container takes minutes. Running it per item would cost hours, and bisecting keeps every deletion individually revertible. |
| 2026-11-12 | 1 | Dismissed verdict finding 1 on the GameScene stack (a scene restart keeps `lastSentTick`) | `update(time)` stores Phaser's game-loop time, which a scene restart does not reset; a kept tick is never ahead of the clock. Disposition in `verdicts/README.md` |
| 2026-11-12 | 1 | Dismissed the SocketManager verdict finding SM-02-RACE; fixed its test-coverage finding in the tests patch | The `setViewport` guard differs from HEAD only between `rooms.set` and `join`, where only promise continuations run, so no back message arrives there. Test 1 now proves one back stream per socket (mutant M10 killed). |
| 2026-11-12 | 1 | Fixed both MediaStore verdict findings (PASS_WITH_NITS) before landing: the MD-03 tests now pin recovery for the camera and the microphone, and the comment no longer claims every failure turns its device off | The user's rule is to fix every finding. Mutants M13 and M14 (never clear one device's issue) survived the first test and are killed by v2. |
| 2026-11-12 | 1 | Land MD-03, which changes visible help text (the camera and microphone tooltips say "permission" again after a denial) | It restores the behavior before `02b30fa37` (2026-04-03), and the user chose to fix pinned bugs in their own commit. The text itself is unchanged; a product look is still worth it. |
| 2026-11-12 | 1 | Keep `tsconfig-paths` in map-storage | `libs/map-editor` and `libs/shared-utils` preload it in `test:debug` without declaring it; removing it first needs those libs to declare it, which adds a dependency and needs the user. |
| 2026-11-12 | 1 | Pin the RoomTimeline scroll anchor by its behavior and record mutant M13 as equivalent | Two paths restore the anchor; the last-item effect runs first when older items arrive, so dropping only the page-end restore changes nothing a test can see in jsdom. The behavior test kills the effect-path and both-paths mutants (M15, M16). |
| 2026-11-12 | 1 | Leave RT-02 pinned and unfixed | It is two features that disagree (read receipts while the tab is visible, new-message count while reading history); either fix changes what other members see, so it is the product owner's call. |
| 2026-11-12 | 2 | Scope GameScene's first Phase 2 pass to the pinned paths: delete the commented-out cases in `update()`, remove or correct GS-07, Extract Method on `update()`'s remote-player block; leave the duplicated diagnostic dump | The Phase 1 rule allows changes only where tests pin behavior. One copy of the dump is in `doAddPlayer`, which is not pinned. Extract Class waits until more of the class is pinned. |
| 2026-11-12 | 2 | GS-07: keep `onPlayerMovementEnded` and fix its comments instead of removing it; record the misleading name as GS-09 | Extension modules outside the repository receive it through `ExtensionModuleOptions` (added for them in `9988cb7a3`), so no search here proves it unused, and a rename changes their API. |
| 2026-11-12 | 2 | Cross-family verdict on the GameScene Phase 2 stack: PASS, no finding; landed as `6ccfe33f4`, `5c76683b7`, `08040b7e0` | Disposition in `verdicts/README.md`. |
| 2026-11-12 | 2 | SocketManager's Phase 2 pass first pins the back stream's `error` handler (a P1 gap) in a tests-only patch, then extracts the `data`, `end` and `error` handlers. Comment-only removals (commented-out statements, the "Useless now" comment) and the type-only Extract Interface on the constructor parameter are in scope | Pinning the gap first lets the whole handler set move as one Extract Method. Removing comments or widening a parameter's type to the interface it already satisfies cannot change runtime behavior, which the type checker and the suite confirm. The duplicated space error block and `refreshRoomData` stay out: nothing pins them. |
| 2026-11-12 | 2 | Cross-family verdict on the SocketManager Phase 2 stack: PASS, no finding; landed as `11450324d` (pin), `b301a9252`, `dcec338cb`, `42057bb39`, `40f7184b1` | Disposition in `verdicts/README.md`. |
| 2026-11-12 | 2 | MediaStore's Phase 2 pass pins the `NotFoundError` and `NotReadableError` branches first, then extracts `runRawStreamUpdate`'s failure handling and its track plan (pure), and corrects the MD-05 comment; `mediaStreamConstraintsStore` waits for its P1 gaps to be pinned | Same pattern as SocketManager: pin a gap, then move the whole block. The constraints callback still has four unpinned branches. |
| 2026-11-12 | 2 | Cross-family verdict on the MediaStore Phase 2 stack: PASS_WITH_NITS; its nit (a doc comment claimed every failure records why) fixed in v2 of patch 2; landed as `271c6f9d9` (pin), `7dc47965a`, `595d33b3e`, `16d4f16fd` | Disposition in `verdicts/README.md`. The behavior the nit exposed is ledgered as MD-09 for a product decision, not changed. |
| 2026-11-12 | 2 | RoomTimeline's Phase 2 pass pins the day labels and the poll, question and system rows inside a run, then moves `renderItems` and its helpers into `RoomTimelineRenderItems.ts`, and removes the commented-out reflow lines | Same pin-then-move pattern; the scroll engine waits for a later pass. |
| 2026-11-12 | 2 | Cross-family verdict on the RoomTimeline Phase 2 stack: PASS, no finding; landed as `4ab34f19d` (pin), `3141350f2`, `5deb37fd5`. Ledger RT-09 (the highlight does not replay on a second focus) and RT-10 (the day labels mix the chat and browser locales) | RT-09 needs a browser before a fix (jsdom runs no CSS animations). RT-10 is pinned and gets its own fix commit. |
| 2026-11-12 | 3 | Phase 3 (clean-code) runs per module in the Phase 2 order, starting with GameScene: a whole-file audit (six scores, top ten, error-handling audit), then at most five behavior-free legibility patches in pinned code; behavior-changing error-handling findings become ledger rows. The adopted conventions are the project's own `docs/agent/typescript-style.md` and `docs/agent/error-handling.md` | The user asked the coordinator to decide. The project already writes its naming and error-handling rules down; adopting them avoids a second rule set. |
| 2026-11-12 | 1 | Ledger the CPU, map-storage and play-pusher defects found by the other lanes in `docs/TECH-DEBT.md` (MS-01 to MS-04, CT-01, CT-02) | One debt queue for the checkout, so Phases 6 and 7 see every open data and capacity defect |
| 2026-11-12 | 1 | Close the `tsconfig-paths` question: it stays in map-storage | The user approved the recommendation ("autorizo tudo"). Removing it would first need `libs/map-editor` and `libs/shared-utils` to declare it. |
| 2026-11-12 | 1 | Accept MD-03's restored "permission" tooltip after a denial as the intended text | The user approved the recommendation. `87b3c6e03` restored what `CameraMenuItem.svelte` and `MicrophoneMenuItem.svelte` were written to show. |
| 2026-11-12 | 1 | Fix RT-02: mark the room read only while the timeline is at the bottom and the tab is visible; reaching the bottom again, by scrolling or with the jump button, marks it read. The RT-02 pin flips in the fix commit | The user approved the recommendation. A read receipt then claims only what the user could see, as in Element, and the jump button's count agrees with it. |
| 2026-11-12 | 1 | Fix MD-09: a third access issue for `NotReadableError` (the device is in use), with camera and microphone tooltip text and i18n keys per `docs/agent/i18n.md`. The MD-09 pin flips in the fix commit | The user approved the recommendation. The camera no longer turns off with no stated cause. |
| 2026-11-12 | 2 | Fix RT-09: remove `highlight-message` when its animation ends, so a second focus adds the class again and the pulse replays; a jsdom test dispatches `animationend`. A browser check of the pulse stays open | The user approved the recommendation. jsdom runs no CSS animation, so the test pins the class lifecycle, not the pulse. |
| 2026-11-12 | 2 | Fix RT-10: pass the chat locale to `Intl.DateTimeFormat` in `dayLabel`. The RT-10 pin flips in the fix commit | The user approved the recommendation. One timeline then shows one language. |
| 2026-11-12 | all | Move CI and worker checks to the `ci` host, in capped containers (2 CPU and 6 GB for CI, 1.5 CPU and 4 GB per worker); `knc` and `sbh` take no new jobs | The user's instruction at 15:55 UTC. The host also serves production containers, so the caps stay. |
| 2026-11-12 | all | Run the authorized local `npm ci` inside the node 24 Linux container used for commits | The checkout's `node_modules` are linux-arm64 for that container; a native macOS install would break the commit hook. |

## Next Actions

- [x] Phase 1, `GameScene.ts`: effect sketch, pinch points, seams, 7 characterization tests, GS-01 and GS-02 fixes as their own patches; `docs/TESTING.md` and `docs/TECH-DEBT.md` created (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase1-gamescene/README.md`.
- [x] Phase 1, `GameScene.ts`: stack landed as `a2af87ddf` (tests), `3ac41d2ab` (GS-01), `ddd39f18b` (GS-02), each equal to its reviewed patch (coordinator, 2026-11-12).
- [x] Phase 1 gate, `GameScene.ts`: CI run 3 stage `head` on `1f48d79d5` (real `npm ci`, every workspace check of the CI workflow): 28 of 28 checks exit 0; play suite 254 files, 1637 passed, 10 skipped (coordinator, 2026-11-12). Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run3/head-raw.txt`.
- [x] Phase 1, `SocketManager.ts`, then `MediaStore.ts`, then `RoomTimeline.svelte`, each after the previous module's Phase 1 is done (coordinator, 2026-11-12).
- [x] GS-03 (any throw in a game frame stopped the Phaser loop for good, a candidate mechanism for the eight-user freeze): pinned and fixed as `8fa3b2d44` and `0d9d44dc6`, cross-family verdict PASS (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/gs03-frame-loop/`.
- [x] Dead-code cleanup (`/ecc:refactor-clean`): landed as `f35d9b151` (back), `3b616d314` (map-editor), `97f660a7e` and `1f48d79d5` (pusher), each equal to its reviewed patch; 158 lines removed (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/refactor-clean/README.md`.
- [x] Phase 1, `SocketManager.ts`: 9 characterization tests at five pinch points, SM-01 pinned, SM-02 pinned and fixed, 10 mutants; landed as `f0a747657` (tests) and `322c7704c` (SM-02), each equal to its reviewed patch. Play suite on the stack: 255 files, 1,646 passed, 10 skipped (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase1-socketmanager/`.
- [x] Phase 1 gate, `SocketManager.ts`: CI run 4 on `322c7704c` (real `npm ci`, every workspace check of the CI workflow, plus a play production build): 29 of 29 exit 0; play 256 files, 1,651 passed, 10 skipped; back 382 passed; map-storage 114 passed (coordinator, 2026-11-12). Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run4/head-raw.txt`.
- [x] Phase 1, `MediaStore.ts`: 11 characterization tests at six pinch points, MD-01 and MD-02 pinned, MD-03 pinned and fixed, 14 mutants killed; verdict PASS_WITH_NITS, both findings fixed in v2; landed as `39417f64b` (tests) and `87b3c6e03` (MD-03), each equal to its reviewed patch (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase1-mediastore/`.
- [x] Phase 1 gate, `MediaStore.ts`: CI run 5 on `7f9c1a86d` (MediaStore, GS-03 and the deps cleanup landed; real `npm ci`, every workspace check of the CI workflow plus `libs/messages` typecheck and a play production build): 30 of 30 exit 0; play 258 files, 1,666 passed, 10 skipped; back 382 passed; map-storage 114 passed (coordinator, 2026-11-12). Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run5/head-raw.txt`.
- [x] Phase 1, `RoomTimeline.svelte`: 10 characterization tests at six pinch points plus the scroll anchor, RT-02 pinned, RT-01 and RT-03 pinned and fixed; verdict PASS; landed as `30b3a76b8` (tests), `6d3f20065` (RT-01) and `052f2d840` (RT-03), each equal to its reviewed patch (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase1-roomtimeline/`.
- [x] Phase 1 gate, `RoomTimeline.svelte`: CI run 6 on `052f2d840`: 30 of 30 exit 0; play 259 files, 1,676 passed, 10 skipped; back 382 passed; map-storage 114 passed; play production build with `phaser@4.2.1` (coordinator, 2026-11-12). Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run6/head-raw.txt`. Phase 1 is done for all four modules.
- [ ] RT-02 (the room is marked read while the user reads history, and the jump button calls the same messages new): fix approved, read only at the bottom; worker running, evidence in `docs/audits/tech-debt/fix-roomtimeline/` (coordinator, P3).
- [x] Phase 2 (refactoring-patterns), `GameScene.ts` first pass: Remove Dead Code (`6ccfe33f4`), GS-07 comments corrected and API kept (`5c76683b7`, new row GS-09), Extract Method on `update()`'s remote-player block, 162 to 84 lines (`08040b7e0`); each equal to its reviewed patch; verdict PASS (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase2-gamescene/`. CI run 7 on `08040b7e0`: 30 of 30 exit 0; play 259 files, 1,676 passed, 10 skipped; back 382 passed; map-storage 114 passed; play production build OK. Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run7/head-raw.txt`.
- [x] Phase 2, `SocketManager.ts` first pass: `error` handler pinned (`11450324d`), Extract Method on `handleConnectToRoom`'s three stream handlers, 148 to 59 lines (`b301a9252`), commented-out code removed (`dcec338cb`), "Useless now" comment corrected (`42057bb39`), Extract Interface on the constructor parameter (`40f7184b1`); each equal to its reviewed patch; verdict PASS (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase2-socketmanager/`. CI run 8 on `40f7184b1`: 30 of 30 exit 0; play 259 files, 1,677 passed, 10 skipped (the new pin is the +1); back 382 passed; map-storage 114 passed; play production build OK. Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run8/head-raw.txt`.
- [x] Phase 2, `MediaStore.ts` first pass: `NotFoundError` and `NotReadableError` pinned (`271c6f9d9`), Extract Function on `runRawStreamUpdate`'s failure handling (`7dc47965a`) and its track plan (`595d33b3e`), 230 to 190 lines, MD-05 comment corrected (`16d4f16fd`); each equal to its reviewed patch; verdict PASS_WITH_NITS, nit fixed (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase2-mediastore/`. CI run 9 on `16d4f16fd`: 30 of 30 exit 0; play 259 files, 1,679 passed, 10 skipped (the two new pins are the +2); back 382 passed; map-storage 114 passed; play production build OK. Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run9/head-raw.txt`.
- [ ] MD-09 (a camera another application holds turns off with no stated cause): fix approved, a third access issue with its tooltip; worker running, evidence in `docs/audits/tech-debt/fix-md09/` (coordinator, P3).
- [x] Phase 2, `RoomTimeline.svelte` first pass: day labels and non-message rows pinned (`4ab34f19d`), `renderItems` moved into `buildRenderItems` (`3141350f2`, script 788 to 692 lines), commented-out reflow removed (`5deb37fd5`); each equal to its reviewed patch; verdict PASS (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/phase2-roomtimeline/`. CI run 10 on `5deb37fd5`: 30 of 30 exit 0, play production build OK; per-suite counts not captured (collector bug, fixed). Evidence: `docs/audits/performance-1000-users/execution/combined-ci/run10/head-raw.txt`.
- [ ] RT-10 (day labels mix the chat and browser locales): fix in its own commit, the pin flips; same worker as RT-02 (coordinator, P3).
- [ ] RT-09 (highlight does not replay on a second focus): fix in its own commit with a jsdom `animationend` test; same worker as RT-02; a browser check of the pulse stays open (coordinator, P3).
- [ ] Phase 3 (clean-code), `GameScene.ts`: audit and behavior-free legibility patches in pinned code; the first worker ended with the session at the 15:48 UTC reboot before writing anything; restarted on the `ci` host, evidence in `docs/audits/tech-debt/phase3-gamescene/` (coordinator, P2). Then `SocketManager.ts`, `MediaStore.ts`, `RoomTimeline.svelte`.
- [x] Unused and undeclared dependencies (DEP-01, DEP-02): 42 removed and 4 declared in 8 single-package commits, `b03e2c1c5` to `7f9c1a86d`, each equal to its reviewed patch; real `npm ci` and every workspace check on the stack exit 0; verdict PASS_WITH_NITS, its finding fixed in v2 (coordinator, 2026-11-12). Evidence: `docs/audits/tech-debt/deps-cleanup/README.md`. `tsconfig-paths` stays (decided 2026-11-12).
