# Run the isolated native baseline

Run commands from the worktree root. This workflow preserves the existing `konclui-local-wa` stack and the parent checkout. It does not publish images or modify production maps.

## Build the frontend

```sh
./deployment/konclui/build-front.sh v1.34.5
```

The script resolves an immutable commit before reading source. It archives that commit into a task-owned Node 24 container, installs the locked dependencies, generates protobufs and translations, and runs the upstream production frontend build. Source edits made concurrently do not enter that archive.

The build uses three CPUs and at most 5 GiB RAM. Logs and the SHA-256 frontend manifest are under `.audit/konclui-runtime/`. The served files are under `.local/konclui/front/`. Existing frontend output is preserved; the script refuses to overwrite it.

For subsequent builds, freeze intended edits before committing a verified slice:

```sh
python3 deployment/konclui/build-snapshot.py shell-01 --working-tree
```

Coordinate the freeze with writers first. This command snapshots tracked files and intended untracked frontend/library/message/patch files, records their hashes, and never stages changes. It excludes dependencies, audit output, local output, and credential files. Committed builds use `--ref <revision>` instead.

Each label gets separate source and frontend manifests under `.audit/konclui-runtime/<label>/` and output under `.local/konclui/builds/<label>/public/`. Labels cannot overwrite prior evidence. The source archive is removed after transfer. The candidate runner is prepared but has not yet been executed.

The candidate runner uses the pinned upstream Node 24 build image with Git already installed. It retains two labeled dependency volumes, `konclui-native-build-root-deps` and `konclui-native-build-message-deps`, for subsequent slices. Installation is reused only when the image, package manifests, lockfiles, and patches match. Remove those exact volumes after the final build consumer exits; never remove the map volume as build garbage.

## Start and inspect

Check `docker ps -a` and `lsof -nP -iTCP:8093 -sTCP:LISTEN` before starting. An unrelated listener on port 8093 must remain untouched.

```sh
./deployment/konclui/stack.sh start
./deployment/konclui/stack.sh status
python3 deployment/konclui/verify-http.py
```

Open `http://localhost:8093`. Direct room entry is `http://localhost:8093/~/baseline/office.wam`.

The Compose project is `konclui-native-baseline`. Its network and map volume are separate from other projects. The first start copies the upstream empty E2E map and its two dependencies into that volume. Later starts preserve editor-authored state. Local credentials are randomly generated into `.local/konclui/local.env` with mode 0600. Do not print or commit that file.

## Service ownership and compatibility

| Service | Baseline implementation |
|---|---|
| Browser frontend and iframe API | Production build from this worktree's pinned commit |
| Pusher, Back, map-storage | Official v1.34.5 images; generated protocol identity must match the local frontend |
| HTTP routing | Isolated Traefik instance; no HTML injection or bundle rewriting |
| Persistence | Isolated Redis and map-storage volume |
| Map | Official upstream empty E2E map with a local WAM wrapper |

This baseline has no LiveKit, TURN, Matrix, uploader, Konclui assets, or native Konclui HUD. It is a calibration runtime, not the migrated product. HTTP checks cannot certify browser rendering, movement, media, or sprite reuse in Phaser.

## Stop

```sh
./deployment/konclui/stack.sh stop
```

Stop preserves the map volume and build output. Do not remove the map volume as temporary garbage. Remove only task-owned disposable build resources after their last consumer finishes. Never run global Docker pruning or reference-stack cleanup.

## Verification state

The local baseline build was interrupted during root `npm ci` after the coordinator moved heavy work to the authorized Grokbox queue. Messages installation and protobuf generation completed. No frontend output or local preview was produced. The HTTP and real-browser checks remain unexecuted.

The builder and the dependency-copy receiver were stopped and removed. The copy had not begun, so both task-created cache volumes were removed. No installed dependency cache is available for reuse. The short-lived cache transfer helper was removed from the active workflow. Existing Docker images, reference-stack services, and maps were preserved.

Recorded evidence is under `.audit/konclui-runtime/`:

- `local-build-interruption.json` records the interruption and verified resource release.
- `official-protocols.json` records matching `f4cfe455` identities from the borrowed custom Konclui Play image and official Back/map-storage services. This is a read-only observation, not certification of the official Play image or a new stack. Verify the exact candidate images before activation.
- `snapshot-proof.json` records a snapshot of the pinned tree and a comparison of package bytes with Git. The temporary archive was removed.
- `build-setup.log` and `build-front.log` retain the failed local attempt's useful output.

Shell syntax, Python compilation without bytecode output, JavaScript syntax, and Compose configuration checks passed. These checks do not replace a completed build or runtime verification. The candidate cache runner has not been executed.

The subsequent `official-play-protocol.json` check reads the actual official Play image `sha256:f30b0df76191e5ec842e1533640075b28501ee144acae2168f34225d09fdbba0` (arm64): its generated API hash is also `f4cfe455`. The isolated read-only container exited zero and was automatically removed. New frontend artifact parity remains pending.

## Frozen local verification retry (2026-11-12)

The queued job `wa-native-20261112-0245` was marked TAKEN but returned no result by
09:17 Rome. A local retry uses its exact archived A/C source hashes and the current
portable runners; it does not fabricate an external queue result. Evidence is in
`.audit/konclui-runtime/local-frozen-20261112-0920/`.

The retry uses the cached Node 24 build image with Git, pinned by its image ID in
`local-resource.json`, with two CPUs, 5 GiB memory, and 5 GiB total memory plus swap
(no additional swap allowance). A and C execute serially. Each stage records its
exit status and log independently; A is archived before C replaces the frontend.
The frozen run completed successfully on Node 24.22.2, Linux ARM64. All 13 stages
exited zero: source verification, Git preflight, locked install, A production
build/artifact/typecheck/Svelte, overlay verification, and C tests/typecheck/Svelte/
production build/artifact. The focused C suite passed 49 tests across six files.

Both generated protocol hashes are `f4cfe455`. Each frontend contains 1178 files;
every archived file was rehashed against its corresponding frontend manifest.
`artifact-verification.json` records archive hashes and counts. Preserve A and C as
separate artifacts; the local retry's C source fingerprint is
`a76507c822b4ae412334bab3854cfc6a480a35b41ea065692d2530f9a423763a`.
Later source edits or a new Git HEAD do not change this frozen artifact identity.

The coordinator requested retention of the exact build container for the named
ProfileMenu ownership and Pathfinding documentation follow-up. Its only remaining
process is `sleep`; no npm/build watcher remains. It retains approximately 1.3 GiB
of root dependencies and 212 MiB of message dependencies. `local-resource.json`
records container ID, execution session, limits, owner, and exact stop/remove
commands. The original verification exit code is preserved in
`local-run-exit-code`; retention does not turn a failed stage into success.
Release the container after the follow-up's final consumer.

These results certify the frozen frontend build and listed static/focused checks.
Browser, media, sprite reuse, and performance/scale acceptance are separate gates;
this build report does not claim those passed.

## Baseline live verification (2026-11-12)

The coordinator completed baseline HTTP/provenance/cache checks in
`.audit/konclui-runtime/http-verification.json` and the real-browser check in
`.audit/konclui-baseline-browser-20261112-short-names/report.json`. The browser
observed six initial sprite HTTP 200 responses, each fetched once; reappearance
triggered no new sprite requests, and reload produced six disk-cache hits. Remote
movement changed the observed x coordinate from 16 to 85 while binary WebSocket
frames were present. The browser reported zero page errors.

Two earlier attempts stopped at name entry because `CacheObserver` and
`CacheVisitor` exceeded the default name limit. The corrected `CacheA`/`CacheB`
probe records failure captures and bounds the initialization wait. Those failed
attempts remain diagnostic evidence, not passes. The baseline has no media backend:
its Connecting state does not certify calls. These observations certify the
baseline scenario only, not candidate visual parity or 1000-user scale.

## Refined candidate check (2026-11-12)

`candidate-refined-20261112` freezes 26 Play files, including the explicit
ProfileMenu visibility prop, at source fingerprint
`4928b39e5b47d93cec07d97314cf87d4ceac02194590da8f9326600ea9608ff7`.
Its 49 focused tests, TypeScript, Svelte, and production build passed. Its pinned
format check failed for ThinWallsController, SeatedPoseController, and
PathfindingManager, so the overall result remains failed. The formatter output
was subsequently applied only to those three authorized files. It adjusts line
wrapping and optional trailing commas; this is not claimed as whitespace-only.

The next freeze is held for the independently diagnosed People/chat toggle state
fix and its behavior test. No passing claim transfers automatically to that source
change. The retained container is idle and available for the final frozen build;
the previous artifact and failed formatting evidence remain separately labeled.

The subsequent `candidate-refined-20261112-format` snapshot includes all lifecycle
fixes and 28 Play files, fingerprint
`69a6584418fe049c3097a1e34dc22b57c225bf8ac82c35a7fe0a2b445a1860df`.
Formatting, 64 tests across seven files, and production build passed. TypeScript
and Svelte each reported the same input-contract error: ScriptedTileWallEdges
requires `value`, but upstream Tiled properties make it optional. The helper already
handles undefined at runtime; its declared input must match that consumer. This
required gate remains failed and the artifact is not accepted for activation.
The error logs and source manifest are preserved under the matching audit label.

`candidate-contract-20261112` corrects the optional property contract and adds the
omitted-value case, fingerprint
`a1d82312ac29c8459d768ab443d657f24064566fe1d230f43afbbfecab156cf5`.
All 65 tests, formatting, TypeScript, Svelte, and production build passed. The
new focused ESLint gate found ten errors in migrated code: eight import-order
errors, the dock's mutable Map registry, and an unbound-method reference in the
thin-wall test. No suppression was added. Its overall status remains failed until
those findings are corrected and verified in a separately identified candidate.
