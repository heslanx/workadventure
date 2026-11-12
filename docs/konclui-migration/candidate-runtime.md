# Candidate C runtime preparation

This workflow prepares the native Konclui candidate beside the immutable upstream baseline A. It reuses the baseline service definitions, not its running containers, frontend files, credentials, network, or map volume. Preparation does not start Docker, seed a volume, or modify the reference checkout.

## Artifact boundary

After the coordinator retrieves verified offloaded builds, retain these exact target-relative artifacts:

- `.local/konclui/builds/<label>/public/`: production frontend, including the iframe API and normal upstream sprite resources.
- `.audit/konclui-runtime/<label>/{source-manifest,frontend-manifest}.json`: source fingerprint, native `KoncluiFrame.svelte` input, generated protocol hash, and complete frontend SHA-256 inventory. Preparation accepts the existing `build-snapshot.py` format or the original offload source manifest. For offload it reconstructs baseline + overlay - deletions and recomputes the recorded NUL/newline candidate fingerprint; preserve the original receipt without inventing identities.
- `.local/konclui/asset-build/`: complete standalone map, resources, catalogues and `all-receipt.json`. A character-only receipt or a direct map build without the complete receipt is insufficient for activation. Reproduce through [the selected-source builder](assets.md).
- Actual locally available Play, Back and map-storage image inspection receipts: `imageReference`, immutable local `imageId`, and generated `protocolHash`. All three hashes must match the built frontend. Candidate images are pinned by those verified local IDs and use `pull_policy: never`.

Current inspection inputs are `.audit/konclui-runtime/official-protocols.json` for official Back/map-storage and `official-play-protocol.json` for official Play. The older custom Play entry is not accepted as the official image. These observations are not yet runtime compatibility verification of candidate C.

```sh
python3 -B deployment/konclui/prepare-candidate.py native-01 \
  --protocol-receipt .audit/konclui-runtime/official-protocols.json \
  --protocol-receipt .audit/konclui-runtime/official-play-protocol.json
```

Replace `native-01` with the completed candidate build label. Preparation verifies complete file inventories, SHA-256 values, required map/font/logo/catalogue paths, source/input identities, and service protocol agreement. It rejects symlinks, missing artifacts, extra unrecorded files, legacy HTML injection markers, and baseline-only source manifests. No mismatch is bypassed with a constant.

Successful preparation creates `.local/konclui/candidate/prepared.json`, nonsecret `runtime.env`, and owner-only `private.env`. Existing private configuration is preserved without reading or printing its values. Paths in `runtime.env` are relative to the Compose directory, not the old checkout. Keep prepared artifact directories frozen while a candidate container uses them. Stop the candidate before selecting another label.

A fresh complete local asset build now passed after the whiteboard isolation change. Its `all-receipt.json` covers13,228 rehashed outputs and unchanged selected inputs; see [asset build evidence](evidence/asset-build.json). Earlier direct-map/character-only receipts remain historical scoped evidence and are not used for candidate activation.

Candidate receipts must also record a `konclui-native-local/` whiteboard namespace. Earlier direct-map output shares Excalidraw room identifiers with production and must not be activated for board interaction. The corrected wrapper changes board links without changing map entity IDs. Preparation carries that namespace into `prepared.json` for inspection.

## Native route and data ownership

`LocalAdmin.fetchMapDetails` redirects `/` using `START_ROOM_URL=/~/konclui-office/office.wam`. Its `/~/` route resolves through `PUBLIC_MAP_STORAGE_URL=http://localhost:8094/map-storage`. No redirect proxy or injected page script is needed.

`LocalWokaService` and `LocalCompanionService` read JSON beside their TypeScript source on each request. The candidate mounts generated catalogues at `/usr/src/play/src/pusher/data/{woka,companions}.json`. Custom resources mount below `/usr/src/play/dist/public/resources/{konclui,konclui-pets}`; mounting these children preserves upstream default sprite resources. `play/Dockerfile` retains those source paths in the official image. Actual mounted consumers must still pass HTTP/browser verification.

The candidate still uses official v1.34.5 Pusher, Back and map-storage binaries, plus the native production frontend. A later server migration must change both the image receipts and protocol evidence explicitly. This slice does not claim all services are built from target source.

## Start only after resource pressure is resolved

The candidate is `http://localhost:8094`; direct room entry is `/~/konclui-office/office.wam`. A read-only `lsof` check on 2026-11-12 found no listener on port 8094. Recheck immediately before starting. Do not stop an unrelated listener.

```sh
lsof -nP -iTCP:8094 -sTCP:LISTEN
docker ps -a
```

Docker Compose >= 2.24.4 is required for `!override`, which replaces the inherited port and mount lists instead of retaining baseline port 8093 or baseline asset mounts. Build the explicit command in a shell array:

```sh
candidate=(docker compose --project-name konclui-native-candidate
  --env-file .local/konclui/candidate/private.env
  --env-file .local/konclui/candidate/runtime.env
  -f deployment/konclui/compose.yaml
  -f deployment/konclui/candidate.compose.yaml)
"${candidate[@]}" config --quiet
"${candidate[@]}" up -d --wait --wait-timeout 180
"${candidate[@]}" ps
```

Do not invoke `stack.sh start` for C: that script owns baseline A. Do not print expanded Compose configuration because it contains secrets. No service was started while preparing this workflow.

The seed service rechecks the prepared frontend/assets inventory and hashes before Play or map-storage can start. It copies only `maps/konclui-office/` into a new staging directory on **`konclui-native-candidate-map-data`**, checks each copied file, assigns UID/GID 1000, and atomically renames the directory to `/maps/konclui-office`. Existing `office.wam` preserves the entire editor-authored map unchanged. An incomplete existing map or seed lock fails closed for inspection; it is never deleted automatically. Rebuilds do not overwrite an existing map. Updating an edited map needs a separate export/reconciliation workflow.

## Cache contract and required checks

Traefik routes `/resources/konclui/` and `/resources/konclui-pets/` to the existing Play HTTP server, adding `Cache-Control: public, max-age=0, must-revalidate`. Candidate map-storage responses use the same policy. This permits conditional cache reuse without treating stable names as immutable. ETag/Last-Modified remain the serving owner's validators. Hashed frontend `/assets` and default `/resources` retain their upstream policies. Verify actual HTTP headers and conditional responses; labels alone do not prove cache behavior.

Required checks after activation:

1. Compare served engine bundles and protocol identity against the frozen candidate receipt; check `/` and direct entry, history/reload, and no injected HUD fallback.
2. Verify custom/default sprite fetch, warm-cache reuse, conditional reload, font/logo loading, and map resources. DevTools Disable cache must be unchecked for cache evidence.
3. Exercise avatar/companion selection and room entry using target catalogues; inspect console/network errors and repeat the existing viewport/interaction gates.
4. Restart the candidate after a controlled local editor change and verify it survives; changing build assets alone must not replace persisted WAM state.

Generated map scripts remain intermediate: `createPageLink`, `installHud`, `installPets`, and `window.__office*` map-page event consumers have not all migrated. The candidate provides no legacy injected listener. Scene FX data is available, but its native runtime and the remaining map interactions need their own completed migration and evidence. No media stack is added by this override; synthetic group-call acceptance remains open.

## Ownership and stop

The Compose project/network belong to `konclui-native-candidate`. The named map volume is persistent editor data, not disposable build output. Record actual container IDs/start times when activation occurs. After inspection, release candidate processes with:

```sh
"${candidate[@]}" down
```

`down` without `--volumes` preserves the candidate map volume. Never use global prune, delete the map volume, or stop `konclui-local-wa-*` or baseline A as part of this workflow. Generated frontend/asset artifacts remain for the next verification consumer; remove superseded task-owned build artifacts only after a validated replacement exists.

## Current verification state

Preparation code and configuration are ready for review. Python AST parsing and `node --check deployment/konclui/seed-candidate.mjs` passed. These syntax checks are separate from artifact verification, Compose merge validation, volume seeding, and browser evidence. Those execution gates remain open until remote artifacts arrive and the coordinator resumes services. Local builds and service activation were deliberately not run while the Mac was under memory pressure.

Preparation creates empty `resources/konclui` and `resources/konclui-pets` mountpoints in the verified frontend before mounting it read-only. This changes no frontend file bytes and allows the two custom-resource child mounts to initialize. Artifact labels accept the full offload job identifier plus its variant suffix. Independent source review identified both preparation fixes; container startup is still a separate gate.
