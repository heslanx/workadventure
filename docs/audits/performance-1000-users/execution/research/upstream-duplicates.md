# Upstream duplicate recheck

Repository checked: `workadventure/workadventure` (public upstream). Read-only: `gh pr view`, `gh pr list --search`, `gh issue list --search`. Nothing was posted, fetched into the local repository, or changed.

- Date checked: 2026-11-11, 23:52 to 23:59 UTC.
- Rate limits: no query was rate-limited. After the run the API reported `core` 4653 remaining, `graphql` 4962, `search` 30. Every query below ran and exited 0.
- Raw receipts: `../P3/upstream-search-raw.txt` (48 open-state queries), `../P3/upstream-search-raw-2.txt` (11 PR views, 8 all-state queries), script `../P3/upstream-search.sh`.
- Limits of this check: keyword search over titles and bodies of PRs and issues. It does not read every open PR diff, forks, or branches without a PR. Searches return at most 40 open results (15 for the all-state queries).

## Referenced PRs, state at the time of the check

| PR | State | Head SHA | Last update (UTC) | Title |
|---|---|---|---|---|
| [#6688](https://github.com/workadventure/workadventure/pull/6688) | OPEN, ready, no review, mergeable CLEAN, CI green | `04634ad3f38b5a74460911d2a7f2850258119aa3` | 2026-10-05 09:57 | fix(pusher): cap what a socket keeps for a resume |
| [#6814](https://github.com/workadventure/workadventure/pull/6814) | OPEN, ready, no review | `92058aaf8d73b5aec58488fe35d2d57556c2339a` | 2026-11-09 15:51 | perf(play): redraw conversation bubbles in place instead of baking a texture every frame |
| [#6800](https://github.com/workadventure/workadventure/pull/6800) | OPEN, ready, no review | `96ddac629b6f2879a976966ffb84667a78d23a6a` | 2026-10-27 09:21 | fix(livekit): keep paused tracks paused after a full reconnection |
| [#5887](https://github.com/workadventure/workadventure/pull/5887) | MERGED 2026-03-31 | `a8be3c0972c0` | 2026-03-31 09:14 | Fixing map-storage discrepancies |
| [#5888](https://github.com/workadventure/workadventure/pull/5888) | MERGED 2026-03-24 | `1777cae27fba` | 2026-03-24 14:36 | Move map eviction behind per-map edition lock |
| [#6423](https://github.com/workadventure/workadventure/pull/6423) | MERGED 2026-08-11 | `1377f91e6111` | 2026-08-11 15:20 | fix(zones): bound the number of zones a viewport can subscribe to |
| [#6427](https://github.com/workadventure/workadventure/pull/6427) | MERGED 2026-08-14 | `99d35aac0c9b` | 2026-08-14 16:56 | fix(map-storage): decode URL paths before building storage keys |
| [#6339](https://github.com/workadventure/workadventure/pull/6339) | MERGED 2026-07-10 | `918113e7bdab` | 2026-07-10 12:38 | feat(shared-utils): report LockByKey callback failures and require observability hooks |

#6688 base is `master` at `baf3a336be2e42795f21da284320cbdda3b7a61c`. Its diff still applies without offsets to the local baseline `ddbe245a8` (see `../P3/README.md`).

## Verdict per planned PR

| Planned PR | Verdict | Evidence |
|---|---|---|
| P1, headless room load generator repair | No duplicate found. Watch #6811. | Open PR queries `benchmark`, `load test`, `load generator`, `headless`, `artillery`: no open PR repairs `benchmark/` or adds a room load generator. `load generator` matches only the draft Rust rewrite [#6811](https://github.com/workadventure/workadventure/pull/6811); its diff (718 files) was not read, so whether it ships its own load tool is unknown. [#2860](https://github.com/workadventure/workadventure/pull/2860) "[WIP] Load-testing chat" is open since 2022-11-30 and targets chat, not rooms. The last PRs titled `benchmark` are dependabot bumps merged in 2021 and 2022. Related merged fix: [#6774](https://github.com/workadventure/workadventure/pull/6774) "give headless bots a viewport around their Woka" (2026-10-14); open issue [#4801](https://github.com/workadventure/workadventure/issues/4801) "phaserMode=headless is ignored". |
| P2, Svelte 5.57 upgrade | No duplicate found for the web workspaces. | Open PR queries `svelte in:title`, `svelte 5`. Open: dependabot [#6095](https://github.com/workadventure/workadventure/pull/6095) bumps Svelte 3.46.4 to 5.55.7 in `/desktop/local-app` only (different workspace, older target); stale [#4455](https://github.com/workadventure/workadventure/pull/4455) "[WIP] Svelte 4 + ESM migration" (4 files, last touched 2026-04-24); draft [#5663](https://github.com/workadventure/workadventure/pull/5663) Vite 5 to 6 with Svelte 5.49.2, superseded by the merged Svelte 5 migration [#6157](https://github.com/workadventure/workadventure/pull/6157) (2026-06-08). No open PR targets 5.57.x. |
| P3, replay cap | Overlaps with #6688 by design. Contribute there, do not open a competing PR. | Queries `NoncedMessageStore`, `resume replay`, `backpressure` return only #6688 for this topic. No review or comment exists on it yet. |
| P4, PositionDispatcher or viewport zone reconciliation | No duplicate found. | Open PR and issue queries `PositionDispatcher`, `viewport zone`, `zone pusher`, `reconcile`: no open PR touches zone reconciliation. Merged precedents to respect: #6423 (zone bound), [#6471](https://github.com/workadventure/workadventure/pull/6471) (count joined sockets, 2026-09-03), [#5911](https://github.com/workadventure/workadventure/pull/5911) (centralized viewport pipeline), [#5395](https://github.com/workadventure/workadventure/pull/5395), [#5392](https://github.com/workadventure/workadventure/pull/5392). |
| P5, map-storage autosave and MapsManager save lifecycle | No duplicate found. | Open PR and issue queries `MapsManager`, `autosave`, `map-storage save`, `map-storage in:title`: zero open PRs for `MapsManager` and `autosave`. Open and unrelated in scope: [#6326](https://github.com/workadventure/workadventure/pull/6326) (S3 health-check alerting), [#5218](https://github.com/workadventure/workadventure/pull/5218) (gRPC bind host). Old open issue [#2957](https://github.com/workadventure/workadventure/issues/2957) "Possible desync for map-editor commands" (2023) is adjacent. Merged precedents: #5887, #5888, #6427, #6339. |
| P6, TypeScript 6 or 7 native compiler pilot | Overlaps with [#5429](https://github.com/workadventure/workadventure/pull/5429). | "[WIP] Switching to Typescript 7 prerelease" by a maintainer, OPEN, 17 files, created 2025-12-05, last touched 2026-04-24, empty description. Queries `tsgo`, `typescript-go`, `native-preview`, `TypeScript 6`, `TypeScript 7`, `typescript in:title`. Coordinate with it or reference it before proposing a pilot. Also note [#6959](https://github.com/workadventure/workadventure/pull/6959) merged 2026-11-10: "TypeScript 5.9 everywhere in the desktop app". |

## Program-level overlap to keep in view

- Drafts [#6809](https://github.com/workadventure/workadventure/pull/6809), [#6810](https://github.com/workadventure/workadventure/pull/6810) and [#6811](https://github.com/workadventure/workadventure/pull/6811) (updated 2026-11-10) propose replacing play/pusher, back, map-storage and uploader with one Go or Rust server. They are drafts and opt-in today, but they cover the same server code as P3, P4 and P5. A TypeScript-side change stays useful only while the TypeScript servers are deployed.
- Client rendering work already open: #6814 and [#6333](https://github.com/workadventure/workadventure/pull/6333) (both rewrite conversation bubble drawing), [#6458](https://github.com/workadventure/workadventure/pull/6458) (room, WAM and TMJ requests off the render loop), [#5700](https://github.com/workadventure/workadventure/pull/5700) (Phaser 3.90). Any client lane must check these before proposing a change in the same files.
