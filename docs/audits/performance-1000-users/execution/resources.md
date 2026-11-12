# Task-owned resources

Owner of every row: the coordinating Claude session of this execution window (job id `wa-fable-20261111`). Rows are updated at each phase boundary. SSH configuration values are intentionally not recorded here; hosts are named by their configured alias.

## Hosts discovered at 23:33 UTC (2026-11-11)

| Alias | Machine | Arch | Cores | Memory free / total | Disk free | Tooling | Use |
|---|---|---|---|---|---|---|---|
| `knc`, `82.25.76.95` | `srv818933` (one machine, two aliases) | x86_64 | 4 | 10 / 15 GB | 60 GB | Docker 28.5.0, Node 22 | TypeScript lane, P3 test runs |
| `sbh`, `82.25.69.58` | `srv742000` (one machine, two aliases) | x86_64 | 4 | 11 / 15 GB | 52 GB | Docker 27.5.1, Node 22 | Svelte lane, isolated P1 stack and generator |
| `hostinger` | shared hosting account | x86_64 | 48 (shared tenancy) | 58 / 250 GB | 159 GB | no Docker, no Node | not used: shared tenancy without container tooling |
| `rocket-hipnose` | shared hosting account | x86_64 | 32 (shared tenancy) | 105 / 245 GB | 427 GB | no Docker, no Node | not used: shared tenancy without container tooling |
| `cw-novo` | unreachable (connection timed out) | | | | | | not used |
| `cw-adsbh` | unreachable (connection timed out) | | | | | | not used |
| MacBook | local | arm64 | 10 | saturated at start | | Docker VM 4 CPU / 8 GB | orchestration and focused checkout tests only |

Both VPS hosts run production and staging containers (22 on `sbh`, 43 on `knc` at discovery). None of them is touched.

## Resources created

| Host | Handle | Purpose | Created (UTC) | Shutdown | State |
|---|---|---|---|---|---|
| MacBook | container `wa-fable-local` (`cc3b04eca86d`) | run focused tests for the checkout with its linux-arm64 `node_modules` | 23:36 | `docker rm -f wa-fable-local` | released 00:38 UTC (idle, Mac swap at 97%); verified absent |
| knc | container `wa-fable-ts` (`b0fde8477812`) | TypeScript 6 and native compiler pilot on a snapshot | 23:39 | `ssh knc docker rm -f wa-fable-ts` | running |
| knc | directory `~/wa-jobs/wa-fable-20261111/` (`src-wa-fable-ts`, `src-wa-fable-p3`) | snapshots of `ddbe245a8` with installed dependencies | 23:38 | `ssh knc rm -rf ~/wa-jobs/wa-fable-20261111` | present |
| sbh | container `wa-fable-svelte` (`5b172492658c`) | Svelte upgrade checks on a snapshot | 23:39 | `ssh sbh docker rm -f wa-fable-svelte` | running |
| sbh | directory `~/wa-jobs/wa-fable-20261111/` (`src-wa-fable-svelte`, `src-wa-fable-stack`) | snapshots of `ddbe245a8` with installed dependencies | 23:38 | `ssh sbh rm -rf ~/wa-jobs/wa-fable-20261111` | present |
| sbh | container `wa-fable-h8`, directory `src-wa-fable-h8` | shared focused-test tree for the eight-user streams (1 CPU, 4 GB) | 00:09 | `ssh sbh docker rm -f wa-fable-h8` | running |
| sbh | containers `wa-fable-stack-play`, `wa-fable-stack-back`, `wa-fable-stack-redis`, `wa-fable-stack-maps`, network `wa-fable-net` | isolated WorkAdventure stack for the P1 harness (created by the P1 stack lane, torn down by the P1 live lane) | 23:55 | see `P1/stack/STACK.md` | running |
| MacBook | `/tmp/wa-fable-20261111-src.tgz`, `/tmp/wa-fable-logs/`, `/tmp/wa-fable-staging/`, `/tmp/wa-fable-*.sh` | snapshot archive (sha256 `885b64d1…ce995`), bootstrap logs, staging for patches | 23:35 | `rm -rf` those paths | present |

Snapshot content: `git archive` of `ddbe245a8` plus the untracked generated inputs `libs/messages/src/ts-proto-generated/` and `play/src/i18n/i18n-*.ts`. No `.env` file, credential or unrelated work was transferred.

Lane-created containers (`wa-fable-stack-*`, `wa-fable-gen`, `wa-fable-p3`) are recorded by their lanes and reconciled here at the end.

## Reconciliation at 01:05 UTC (2026-11-12)

| Host | Handle | Created by | State |
|---|---|---|---|
| sbh | compose project `wa-fable-stack` (4 containers) and network `wa-fable-net` | P1 stack lane | released 00:44 UTC by the P1 live lane; verified absent at 00:54 |
| sbh | `wa-fable-gen*`, `wa-fable-gen-test`, `wa-fable-p1fix` (all `--rm`) | P1 live lane, coordinator | exited; verified absent |
| knc | `wa-fable-p1`, `wa-fable-p3`, `wa-fable-p4-bench`, `wa-fable-tsbase`, `wa-fable-p4review-*` | lanes and reviewers | released by their owners; verified absent at 00:54 |
| MacBook | `wa-fable-local` | coordinator | released 00:38 UTC; verified absent |

Evidence that lived only inside remote containers was copied before release: `P2/receipts/head/play-full-tests.tail.log` and `D01/receipts/pusher-showconfig-{before,after}.json`.
| knc | `wa-fable-ts`, job dir `~/wa-jobs/wa-fable-20261111` (3.3 GB) | coordinator | released 01:06 UTC; 0 containers, 0 networks, no job dir left |
| sbh | `wa-fable-h8`, `wa-fable-svelte`, job dir `~/wa-jobs/wa-fable-20261111` (4.8 GB) | coordinator | released 01:06 UTC; 0 containers, 0 networks, no job dir left |

Retained on purpose, owner the user: `/tmp/wa-fable-staging/` on the MacBook (staged D01a and P6 manifests and lockfiles with `SHA256SUMS`, inputs for applying the TypeScript patches). `/tmp/wa-fable-20261111-src.tgz` and `/tmp/wa-fable-logs/` can be deleted with `rm -rf` once no one needs them.

## Round 2 (job id `wa-fable-20261112`, from 01:18 UTC)

| Host | Handle | Purpose | Created (UTC) | Shutdown | State |
|---|---|---|---|---|---|
| MacBook | `/tmp/wa-fable-20261112-src.tar.gz` (sha256 prefix `ebd3b350b628fb9d`), `/tmp/wa-fable-20261112-bootstrap.sh` | snapshot of HEAD plus the uncommitted P1, P2, P4, P5 files and generated proto and i18n files | 01:18 | `rm -f` both | present |
| knc | directory `~/wa-jobs/wa-fable-20261112/` (`src-base`, `src-p4`, `src-deps`, `src-cpu`), 6.2 GB | lane trees with `npm ci` under Node 24 | 01:19 | `ssh knc rm -rf ~/wa-jobs/wa-fable-20261112` | present |
| sbh | directory `~/wa-jobs/wa-fable-20261112/` (`src-base`, `src-p5`, `src-p1`, `src-chat`, `src-review`), 7.7 GB | lane trees with `npm ci` under Node 24 | 01:19 | `ssh sbh rm -rf ~/wa-jobs/wa-fable-20261112` | present |
| knc, sbh | containers `wa-fable-r2-<lane>-*` (label `owner=wa-fable-20261112`, `--rm`, 1 CPU, 3 GB, no ports) | lane checks, created and removed by each lane agent | 01:23 | `docker rm -f` by name | per lane report |
| MacBook | container `wa-fable-git` (`--rm`), `/tmp/wa-fable-commit-chain.sh`, `.git/wa-fable-msg-*` | local commits with the project pre-commit hook on the checkout's linux-arm64 `node_modules` | 01:12 | exits by itself; `rm -f` the script and message files | running |
| MacBook | `/tmp/wa-r2/<lane>/` | per-lane scratch git repos holding the patch sources | 01:23 | `rm -rf /tmp/wa-r2` | present |
| offload box (Grok Bot, Linux x86_64, 8 vCPU) | job `~/grokbox-offload/inbox/wa-ci-combined-1/` (`run.sh`, `job.env`, `src.tgz` 84 MB, `READY`) | combined-state CI mirror of every workspace check in `.github/workflows/continuous_integration.yml` on HEAD plus the uncommitted P1, P2, P4, P5 slices; image `node:24-trixie`, 6 CPU, 7 GB, network only for `npm ci`; tracked dev key, credential helper and `.env` templates excluded from the archive | 01:41 | result in `~/grokbox-offload/outbox/wa-ci-combined-1/`; `rm -rf` the inbox and outbox dirs after reading | queued |

### Releases and new handles, 2026-11-12 04:20-04:40 UTC (coordinator)

| Host | Handle | State |
|---|---|---|
| knc | container `wa-fable-ci3` (exited 0) and `~/wa-jobs/wa-fable-20261112/ci3` (52 MB) | released 04:40 UTC after copying `combined-ci/run3/deps-raw.txt` and `build-deps-raw.txt`; `docker ps -a --filter name=^wa-fable-ci3$` lists 0 |
| knc | container `wa-fable-build-deps` (`--rm`, 2 CPU, 7 GB), play production build with deps 01-03 | exited by itself, removed by `--rm` |
| knc | container `wa-fable-ci4` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci4` | running from 04:38 UTC: CI run 4 on `322c7704c` |
| offload box | `~/grokbox-offload/inbox/wa-ci-combined-2` (TAKEN 01:58, never returned) | removed 04:40 UTC; no outbox entry existed |
| MacBook | `/tmp/wa-ci3`, `/tmp/wa-p5r6`, `/tmp/wa-cpu7v`, `/tmp/wa-cpu7fix`, `/tmp/wa-sm1v`, `/tmp/wa-sm1fix`, `/tmp/wa-sm1fix-out`, `/tmp/wa-sm1` (verdict views and scratch repos) | removed 04:40 UTC |
| MacBook | `/tmp/wa-verdict-tree.sh`, `/tmp/wa-ci4/` | present, release at the end |
| sbh | `~/wa-jobs/wa-fable-20261112/sm1` (runner reused by the MediaStore worker), `md1` | present, release after D1-MS |
| knc | container `wa-fable-ci4` and `~/wa-jobs/wa-fable-20261112/ci4` | CI run 4 done 04:55 UTC (29/29 exit 0), evidence in `combined-ci/run4/head-raw.txt`; container gone (`--rm`), dir removed |
| sbh | `~/wa-jobs/wa-fable-20261112/gs3` (GS-03 states, mutants, runner), containers `wa-fable-gs3-*` (`--rm`, 1 CPU, 3 GB, tree read-only) | containers left 0; dir present, release at the end |
| MacBook | `/tmp/wa-gs3` (GS-03 scratch repo), `/tmp/wa-gs3-out` | `/tmp/wa-gs3-out` removed 04:55 UTC; `/tmp/wa-gs3` present, release at the end |

### Releases and new handles, 2026-11-12 05:00-06:15 UTC (coordinator)

| Host | Handle | State |
|---|---|---|
| sbh | containers `wa-fable-md1-v2-*` (5 runs, `--rm`, 1.5 CPU, 4 GB, `--network none`) and `md1/t2`, `md1/run2.sh`, `md1/logs2` | containers left 0; dir present, release at the end |
| MacBook | `/tmp/wa-md1v` (MediaStore verdict view), `/tmp/wa-md2` (v2 scratch repo), `/tmp/wa-depv2` (deps v2 scratch), `/tmp/wa-depchk` | removed |
| knc | `~/wa-jobs/wa-fable-20261112/deps-clean` (about 56 MB, deps-cleanup worker) | present, release at the end |
| knc | container `wa-fable-ci5` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci5` | CI run 5 on `7f9c1a86d` done 06:12 UTC (30/30 exit 0), evidence in `combined-ci/run5/head-raw.txt`; container gone (`--rm`), dir removed |
| MacBook | `/tmp/wa-ci4/` | removed (superseded by `/tmp/wa-ci5`) |
| MacBook | `/tmp/wa-ci5/` (`build.sh`, `run.sh`, `HEAD.txt`; `src.tgz` removed) | present for CI run 6, release at the end |
| sbh | `~/wa-jobs/wa-fable-20261112/rt1` (worker runs plus the coordinator's `files/v2`, `batch-v2.sh`, `logs2`), containers `wa-fable-rt1-*` | containers left 0 (56 runs, all `--rm`); dir present, release at the end |
| MacBook | `/tmp/wa-rt1v` (verdict view), `/tmp/wa-rt2` (v2 scratch repo) | removed 06:28 UTC |
| knc | container `wa-fable-ci6` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci6` | CI run 6 on `052f2d840` done (30/30 exit 0), evidence in `combined-ci/run6/head-raw.txt`; container gone (`--rm`), dir removed; Mac `src.tgz` removed |
| sbh | `~/wa-jobs/wa-fable-20261112/p2gs` (GameScene Phase 2 worker runner and logs), containers `wa-fable-p2gs-*` | containers left 0; dir present, release at the end |
| MacBook | `/tmp/wa-p2v` (GameScene Phase 2 verdict view) | removed 07:07 UTC |
| knc | container `wa-fable-ci7` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci7` | CI run 7 on `08040b7e0` done 07:29 UTC (30/30 exit 0), evidence in `combined-ci/run7/head-raw.txt`; container gone, dir removed |
| sbh | `~/wa-jobs/wa-fable-20261112/p2sm`, containers `wa-fable-p2sm-*` (SocketManager Phase 2 worker) | started 07:12 UTC |
| MacBook | `/tmp/wa-p2sm-brief.txt`, `/tmp/wa-p2gs-brief.txt` (worker briefs) | present, release at the end |
| sbh | `~/wa-jobs/wa-fable-20261112/p2sm` (SocketManager Phase 2 runner and logs, 6 MB), containers `wa-fable-p2sm-*` | containers left 0; dir present, release at the end |
| MacBook | `/tmp/wa-p2smv` (SocketManager Phase 2 verdict view) | removed 07:37 UTC |
| knc | container `wa-fable-ci8` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci8` | CI run 8 on `40f7184b1` done (30/30 exit 0), evidence in `combined-ci/run8/head-raw.txt`; container gone, dir removed |
| sbh | `~/wa-jobs/wa-fable-20261112/p2md`, containers `wa-fable-p2md-*` (MediaStore Phase 2 worker) | started 07:42 UTC |
| MacBook | `/tmp/wa-p2md-brief.txt` (worker brief) | present, release at the end |
| sbh | `~/wa-jobs/wa-fable-20261112/p2md` (MediaStore Phase 2 runner and logs, 7 MB), containers `wa-fable-p2md-*` | containers left 0; dir present, release at the end |
| MacBook | `/tmp/wa-p2mdv` (verdict view), `/tmp/wa-p2md2` (v2 scratch) | removed 08:11 UTC |
| knc | container `wa-fable-ci9` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci9` | CI run 9 on `16d4f16fd` done (30/30 exit 0), evidence in `combined-ci/run9/head-raw.txt`; container gone, dir removed |
| sbh | `~/wa-jobs/wa-fable-20261112/p2rt`, containers `wa-fable-p2rt-*` (RoomTimeline Phase 2 worker) | started 08:05 UTC |
| MacBook | `/tmp/wa-p2rt-brief.txt` (worker brief) | present, release at the end |
| sbh | `~/wa-jobs/wa-fable-20261112/p2rt` (RoomTimeline Phase 2 runner and logs), containers `wa-fable-p2rt-*` | containers left 0; dir present, release at the end |
| MacBook | `/tmp/wa-p2rtv` (verdict view), `/tmp/wa-p2rt-brief.txt` | removed 08:47 UTC |
| knc | container `wa-fable-ci10` (`--rm`, 2 CPU, 6 GB) and `~/wa-jobs/wa-fable-20261112/ci10` | CI run 10 on `5deb37fd5` started 08:45 UTC; 30 of 30 exit 0; dir removed at about 15:58 UTC |
| sbh | `~/wa-jobs/wa-fable-20261112/p3gs`, containers `wa-fable-p3gs-*` (GameScene Phase 3 worker) | started 08:46 UTC; the worker ended with the session before creating the dir; nothing to release |
| MacBook | `/tmp/wa-p3gs-brief.txt` (worker brief) | lost in the 15:48 UTC reboot |
| MacBook | `/tmp` tooling (`wa-ci5`, `wa-fable-land.sh`, `wa-verdict-tree.sh`, `wa-fable-logs`) | lost in the 15:48 UTC reboot; recreated in `~/.claude/orchestrate/wa-perf-debt/tools/` (outside the repo) |
| ci (CI host; also serves production) | `/srv/ci-jobs/wa-fable-20261112/` (`src-review` base with `npm ci` at `5deb37fd5`, `logs`, worker dirs `fixrt`, `fixmd`, `p3gs`, CI dirs `ciN`), containers labelled `ci-job=wa-fable-20261112`, image `node:24-trixie` pulled at about 15:59 UTC | per `~/.claude/reference/konclui-ci.md`; remove the folder, containers and the pulled image when the job ends |
| knc | `~/wa-jobs/wa-fable-20261112` (6.6 GB) and the empty `~/wa-jobs` | removed at about 16:07 UTC; CI stays off knc |
| sbh | `~/wa-jobs/wa-fable-20261112` (7.8 GB) and the empty `~/wa-jobs` | removed at about 16:10 UTC; CI stays off sbh |
| MacBook | local `npm ci` in the commit container (`node_modules` linux-arm64; phaser 4.2.1 now) | done by 16:05 UTC, EXIT 0 |
