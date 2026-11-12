# Integration and ownership journal

One coordinator (the Fable 5.2 session in terminal `term_12b57763-67f8-40fd-9909-f5b9199d94c7`) runs two programs in the same checkout: the 1,000-user upgrade and performance program (journal in `docs/audits/performance-1000-users/execution/`) and this eight-user freeze program. This file covers how the second was added to the first.

## Timebox

| Program | Start (UTC) | Deadline (UTC) | No new changes after (UTC) |
|---|---|---|---|
| 1,000-user program | 2026-11-11 23:24:30 | 2026-11-12 01:24:30 | 01:14:30 |
| Eight-user program | 2026-11-11 23:25:49 | 2026-11-12 01:25:49 | 01:10:49 |

The eight-user handoff (Orca message `msg_cb975a6b2cc9`) was read at 00:03 UTC and acknowledged through Orca at 00:10 UTC. Its streams started at 00:13 UTC, 47 minutes after its nominal start, because the coordinator was arming the first program. The existing workers were not stopped or replaced.

## Quota

The usage meter is an interactive panel and has no command-line or API reading available to this session. No utilization figure is recorded. Work is governed by the deadlines.

## Ownership (one writer per file)

| Path or module | Writer | Program |
|---|---|---|
| `benchmark/**` | P1 harness lane, then P1 live lane | 1,000-user |
| `play/src/pusher/models/PositionDispatcher.ts`, its test | P4 lane | 1,000-user |
| `map-storage/src/MapsManager.ts`, autosave test | P5 lane | 1,000-user |
| every `package.json`, lockfile, tsconfig | coordinator (dependency owner); lanes prepare patches on remote snapshots | both |
| `play/src/common/NoncedMessageStore.ts`, `PusherWebSocket.ts` | nobody: upstream PR 6688 owns the change, the P3 lane reviews it read-only | both |
| GameScene and conversation-bubble modules | stream W1 only | eight-user |
| any other product file | the stream that first claims it in `OWNERSHIP.md` | eight-user |

## Streams added and their placement

| Stream | IDs | Owner | Placement and dependency |
|---|---|---|---|
| W0 reproduction and evidence | D01, D04, D07, A03; browser discriminators for H01-H04, H21 | protocol side: the existing P1 benchmark owner. Browser side: one new evidence-only agent | Protocol receipts come from the isolated stack on `sbh` (`performance-1000-users/execution/P1/`). The browser run uses the MacBook, the only representative GPU hardware, against the user's local preview if it answers |
| W1 game and rendering | H01-H04, H07-H09, A01, D02 | one new agent | Node benches on the MacBook, focused tests on `sbh`; cites the existing read-only interpolation profile |
| W2 proximity and media lifecycle | H10-H14, A02, D03 | one new agent | Focused tests on `sbh`; writes product code only for a reproduced failure |
| W3 transport and operations | H15-H20, A04, D05 | one new agent | Read-only samples of the isolated stack; cites P3 (upstream PR 6688) and P4 instead of competing |
| W4 timeline and compatibility | H05, H06, H21, H22, A05, D06 | one new agent | Builds on the existing chat-DOM scoping, Svelte and version-decision lanes |

Each production diff gets an independent reviewer and, if needed, one bounded fix round. A final agent verifies every claimed state against its evidence file and writes `STATUS-MATRIX.md`.

## Compute

Two 4-core VPS hosts (`sbh`, `knc`) that also run production services, with capped task containers and no published ports. The eight-user streams share one extra test container, `wa-fable-h8` on `sbh` (1 CPU, 4 GB), on a snapshot of the reference commit. Shared hosting accounts are not used. Full inventory: `docs/audits/performance-1000-users/execution/resources.md`.

## Known limits at the time of integration

- The MacBook was saturated (load average above 700) and the local preview did not answer within 8 s at 00:05 UTC. Real-browser evidence may be unobtainable in this window; the browser stream records the access gap rather than substituting a server-side software renderer.
- A headless generator proves protocol behavior, not rendering or media.

## Outcome at 01:08 UTC

- Streams W0-W4 first ran from 00:13 UTC and all stopped at about 00:26 UTC when the Fable quota ran out. A finish round on Opus 5.5 (two stream agents and one matrix agent) completed them from 00:35 to 00:49 UTC. No product file was changed by any eight-user stream.
- `STATUS-MATRIX.md` covers H01-H22, A01-A05 and D01-D07. H rows: 3 confirmed (H15, H16, H21, each limited to its mechanism or the local preview), 0 refuted, 11 inconclusive, 8 not executed. Sub-claims H08a and H13a were refuted in their scenario. None of the confirmed rows is shown to have caused the incident.
- Main mechanism finding: the backend `CpuTracker` measures CPU against one core and has no cgroup awareness. At the isolated stack's 0.65-core cap it cannot exceed 65%, so movement shedding (threshold 80) never triggers under throttling. A quota-aware proposal is saved, not applied (`W3/`).
- Chat DOM: each message adds about 21 to 23.5 DOM nodes and stays mounted. Appending one message to `RoomTimeline.svelte` took a median of 43, 252 and 1013 ms of jsdom script time at 20, 500 and 2000 loaded items (`W4/`). Only the growth with history transfers to a browser, not the absolute times.
- No real-browser 1 to 4 to 8 run happened. The MacBook was saturated and the local preview refused connections. A runbook for the next session is in `W0/README.md`.
- The 1,000-user program's P1 harness proved protocol-level join, movement fan-out and leave against an isolated stack (`performance-1000-users/execution/P1/`). That is protocol evidence, not browser evidence.
- Resources: every task-owned container, network and job directory on knc, sbh and the MacBook was released and verified absent at 01:06 UTC (`performance-1000-users/execution/resources.md`).
