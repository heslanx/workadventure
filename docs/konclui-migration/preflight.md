# Native Konclui migration preflight

This is a discovery record, not a completed migration or runtime certification. Recorded on 2026-11-12 by the Codex coordinator.

## Checkout identities

| Role | Identity | Evidence |
|---|---|---|
| Requested target | `/Users/erickheslan/Developments/study/workadventure`, branch `chore/orca-docker-ssh-env`, HEAD `ddbe245a84c78c947dd9ae5310da1fc53cd3d278` | Local Git inspection |
| Official baseline | `https://github.com/workadventure/workadventure.git`, tag `v1.34.5`, commit `38c808924267157fb3bd3f7a943de35f026e4773` | Local tag matched `git ls-remote` against the official remote |
| Official baseline tree | `d52cebe59fd23281d02c3e792a741ac50f9073da` | `git rev-parse 'v1.34.5^{tree}'` |
| Baseline root lockfile | Git blob `b15983553e6beac978bd4cb99be0f43b91f8d30a` | `git ls-tree v1.34.5 package-lock.json` |
| Baseline messages lockfile | Git blob `a67024b0a85ae2232361d516f7890ecc8b33ea25` | `git ls-tree v1.34.5 messages/package-lock.json` |
| Existing native front | Reference `fork/build/v1.34.5-front-src`, HEAD `1119211aa580ebb79bbc1b8b4c19a28b5e32862a` | Clean Git status; tree `7fd2a4e585a9615dc9b0bd44b342740ea04f3332` |
| Existing full native source | Reference `fork/build/v1.34.5-src`, HEAD `3adbb32327c46aa65359060e87bfc1d77a618f3e` | Read-only engine inventory; tree `c4822aeb685431557a2cd39962fcbad79cbc491c` |

The reference root is `/Users/erickheslan/Developments/konclui-project/konclui-work`. It remains read-only for this migration. Its uncommitted product fixes take precedence over historical reports.

The native front's synthetic root `08250769d8e94762b58675b72d46b4ac5504ddfc` has the official baseline tree. Selective ports can preserve official ancestry. Merging that synthetic history is unnecessary.

## Existing work prevents switching the target checkout

The target contains dirty changes in `benchmark`, `PositionDispatcher`, `MapsManager`, package manifests, and the root lockfile, plus local harness and audit files. There are 170 commits reachable from current HEAD that are not reachable from v1.34.5.

The other coordinator's ownership journal in the parent checkout at `docs/audits/eight-user-performance/execution/2026-11-12/INTEGRATION-JOURNAL.md` assigns product files to performance streams. This migration must not stash, reset, commit, or move their work.

The user resolved the location decision by requesting a worktree of the original repository. Created `.worktrees/konclui-native` on branch `20261112-konclui-native` at the official tag, preserving the dirty parent checkout. These migration records were moved into the new worktree after verifying equal bytes. The parent's shared Git exclude file now ignores `/.worktrees/`.

The explicitly requested push guard is active:

```sh
git remote set-url --push upstream DISABLED
git remote get-url --push upstream
```

The readback returned `DISABLED`. No parent branch switch, commit, push, remote repository creation, or deployment occurred during preflight.

## Toolchain and runtime observations

Host tools reported Node `v26.10.0`, npm `12.1.0`, Docker `29.8.2`, and Compose `5.6.0`. The baseline Play Dockerfile uses Node 24. Host tool availability does not certify build compatibility.

The filesystem had approximately 18 GiB free. Check space before dependencies and image construction. Do not delete unrelated files or Docker objects to make room.

`docker ps -a` showed the reference `konclui-local-wa` services running on localhost port 8090. The existing `workadventure-sprite-check` containers were stopped. Both projects are borrowed resources and remain untouched. No task-owned stack or browser has been started.

## Existing cache evidence is historical

The target's `.audit/sprite-cache.browser.json` records one development-runtime experiment with two users. Six avatar-layer PNGs loaded on first appearance, textures remained in Phaser after departure, and reappearance made zero extra sprite requests. Reload made six HTTP 304 revalidations.

That report does not identify an exact build SHA and explicitly excludes production headers and timing. It cannot certify this migration's pinned baseline or disk-cache acceptance. Repeat the experiment on the new isolated baseline with source identity and production headers recorded. A layered avatar requires one request per missing texture, not one request for the complete avatar.

## Reusable ports and remaining work

The actual reference registry `local-wa/hot-reload/server.mjs` contains 12 engine patches. Existing source implementations cover placement, thin walls, sitting, game inset, tile click, tile hover, visible animation refresh, custom emotes, exploration click handling, scene effects access, frame caps, and store access.

The engine port commit is `9b6e842`, followed by `f2a8d83` for a seated-pose test correction. `6c7e0c7` fixes LiveKit subscription disposal; `1119211` adds a global remote-video subscription budget. Tests were located, not rerun in this preflight.

Several source ports still publish stores or scene objects through `window`, read DOM flags, or send global events. They are intermediate implementations. Native completion requires direct Svelte store consumption, explicit Phaser integration, and deterministic cleanup. Copying the injected HUD into a bundle does not satisfy acceptance.

Front-only message inputs hash to `f4cfe455`; the full tracing branch hashes to `b3bf14da`. Generated protocol identity must be checked across the actual built services. Never bypass a mismatch.

## Next execution gate

Resolve the checkout location, then create a clean official baseline without altering either existing checkout. Build and verify that baseline before applying the first native shell slice. The migration matrix, native implementation, browser verification, benchmarks, and release package remain open.
