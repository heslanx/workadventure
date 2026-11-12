# Selected asset verification through the authorized queue

Job owner: Konclui migration coordinator. The asset worker prepares the single `~/grokbox-offload/inbox/wa-assets-20261112/` job; the queue owner executes it. No SSH or local map build is used. The queue README was read on 2026-11-12 before preparation: jobs run directly on Linux Python 3.13, Docker is unavailable, and pickup ends around 03:15 Europe/Rome.

## Frozen inputs

`offload-assets-package.py` selects current files named by the existing provenance manifest, preserving the standalone source layout. It adds that manifest, `tools/build-konclui-assets.py`, upstream `woka.json`/`companions.json`, and the two job helpers. Native source adaptations are hashed as they actually exist; original import provenance remains unchanged. Generated outputs, `.env*`, secrets, dependencies, caches, and unrelated Play changes are excluded.

The packager guards every file against concurrent modification, records SHA-256 values and a composite fingerprint, writes `submission.json`, and creates `READY` last. It refuses an existing job directory. No throwaway source copy is made: the archive is streamed directly from selected files.

```sh
python3 -B deployment/konclui/offload-assets-package.py
```

Do not repeat that command after submission. Preserve the frozen snapshot and choose a separately authorized follow-up job for subsequent source changes. `submission.json` is the authoritative submitted fingerprint and archive checksum.

## Execution contract

The job requests 1 CPU, 2 GiB, and 600 seconds with network access for existing pinned Python dependencies. On the current host runner these are requests, not proof of enforced limits; `toolchain.json` records effective Python/package versions, architecture, CPU count, and visible cgroup limits. No performance comparison is claimed.

All paths derive from `run.sh` and helper locations, without `/w` assumptions. `run.sh` records each command's raw log and exit status. It checks existing NumPy 2.5.3 and Pillow 12.3.0 first. If necessary, it creates a task-only venv and installs those exact existing dependencies as binary wheels, without global/privileged changes or cache retention. Its exit trap removes that task-created venv.

`rsvg-convert` must already exist. No alternate renderer or SVG dependency is installed. With all prerequisites the job runs the complete builder with a 360-second bound. Otherwise it explicitly records the map as blocked and runs character export with an 80-second bound. A full build failure also preserves its log and attempts the independent character slice. Dependency installation is bounded to 120 seconds; archive creation to 30 seconds.

The corrected standalone builder uses the local whiteboard namespace. A pure source fixture checks link isolation and unchanged IDs/default behavior; a successful full build also checks the actual WAM board links and entity IDs. No Excalidraw request is made.

## Accept returned evidence

Expected outbox: `~/grokbox-offload/outbox/wa-assets-20261112/`. Await queue completion instead of repeatedly polling. Retain `stdout.log`, `exit_code`, and the returned `out.tgz` until accepted. Within the returned output:

- `source-manifest.json`, `status.tsv`, raw `logs/`, `toolchain.json`, and `archive-sha256.txt` identify inputs, commands, failures, dependencies, and output archives.
- A complete success returns `asset-build.tgz`, `all-receipt.json`, and `asset-summary.json` with scope `all` and verified isolated boards. Exit zero is required.
- A blocked/failed map with successful character export returns `characters.tgz`, `characters-receipt.json`, and a scope `characters` summary. Exit two deliberately keeps the map gate open. It is not a complete activation receipt.

Match the returned source fingerprint to the frozen submission and still-current inputs, verify the archive checksum and per-file output hashes, and inspect every stage result. A missing-dependency preflight may be resolved by the later pinned install/effective-toolchain check; other failed stages remain visible. The coordinator accepts artifacts into a separate task-owned directory before replacing previous outputs. Preserve editor-authored volumes; these archives are build products, not permission to reseed a map.

After acceptance, remove redundant task-owned archives/copies while retaining the compact source/command/result receipts and necessary generated assets. The queue owner owns its remote workspace lifecycle. This job starts no servers, browsers, containers, or background processes beyond its bounded commands.
