# Frozen frontend verification through the offload queue

The coordinator owns submission and result acceptance. The queue owner runs the job;
this project does not SSH into the box. Read `~/grokbox-offload/README.md` immediately
before each submission because its runtime and availability can change.

## Submitted snapshot

Job `wa-native-20261112-0245` was submitted on 2026-11-12 with `READY` written last.
Its immutable input lives in `~/grokbox-offload/inbox/wa-native-20261112-0245/`.

- A: official WorkAdventure commit `38c808924267157fb3bd3f7a943de35f026e4773`,
  tree `d52cebe59fd23281d02c3e792a741ac50f9073da` (tag `v1.34.5`).
- C: A plus 25 frozen Play source/test files, including the reviewed viewport,
  animation invalidation, and mobile people-button focus corrections.
- Archive SHA-256: `a2951236e0166fdcd9be3dd7f2e3fabb3b92ca288dd00eb80969d857c3d4a3d0`.
- A source fingerprint: `c991a0c244320de1ad50e2b79d7213f247fe7c3a1a864ae66066bdec5e92e641`.
- C source fingerprint: `a76507c822b4ae412334bab3854cfc6a480a35b41ea065692d2530f9a423763a`.

`source-manifest.json` records every included source hash, baseline tree, candidate
HEAD, overlay, and deletion. The composite fingerprint hashes sorted
`path + NUL + sha256 + newline` records. All `.env*` paths are excluded, including
upstream `.env.template` and `contrib/docker/.env.prod.template`. Dependencies,
local configuration, audits, generated Koncluí maps/resources, and unrelated
working-tree changes outside Play are not uploaded. The only retained upstream
symlink resolves inside the baseline tree.

## Runtime constraint

`job.env` requests Node 24 Docker, bridge networking, 3 CPUs, 5 GiB, and 1800 seconds.
The submitted job names the slim image; its actual host runner already provides Git.
Future packaging uses the full Node image so Docker reproduction has Git as well.
However, the queue README update at 02:40 Rome says Docker is unavailable after a
reboot: `IMAGE` is ignored, jobs run on host Node 24, and `/w` paths are rewritten.
**Submission is not evidence that container or resource limits were enforced.**
Accept returned runtime evidence before making that claim. Shell and JavaScript helpers derive their workspace from their own file paths,
so the host runner does not need path rewriting. Git must already be installed;
the job does not run privileged package installation on the host.

The script rejects Node majors other than 24 and records the actual version,
platform, architecture, ABI, and glibc. A and C run serially in the same environment.
Linux x86-64 JavaScript artifacts do not certify ARM64 production container images.

## Submit and reproduce

Freeze Play writers first, then use a new job identifier:

```sh
python3 deployment/konclui/offload-package.py wa-native-YYYYMMDD-HHMM
```

The packager never stages files or changes the shared Git index. It refuses an
existing job directory, validates archive paths and hashes, checks shell syntax,
and creates `READY` only after the snapshot is complete. Do not edit a submitted
snapshot. Coordinate a new job if source fixes are needed.

To reproduce on a Linux machine with Docker, extract into a fresh task directory,
not a checkout. Copy the submitted `run.sh` into that directory, then run:

```sh
mkdir verification-workspace
tar -xzf /path/to/job/src.tgz -C verification-workspace
cp /path/to/job/run.sh verification-workspace/run.sh
docker run --rm --cpus=3 --memory=5g --network=bridge \
  -v "$PWD/verification-workspace:/w" -w /w node:24-trixie \
  timeout 1800 bash /w/run.sh
```

Network access installs locked npm packages. The plain-Linux Docker example uses
the full Node image because Git must already be installed. No new project
dependency is introduced. Messages are generated once from A, including the actual
protocol hash; C changes only Play and reuses those generated messages and locked
dependencies. The protocol is not stamped twice or bypassed.

## Accept results and release resources

Results arrive in `~/grokbox-offload/outbox/<job-id>/`: `stdout.log`, `exit_code`,
`seconds`, and `out.tgz`. `TAKEN` in the inbox signals pickup. Await the queue owner's
completion notification instead of repeatedly probing.

Extract returned evidence into an ignored, task-owned audit directory. Check:

1. Input fingerprint and actual Node/platform record match the intended experiment.
2. `status.tsv` and each stage log independently report A build, A static checks,
   C focused tests, C static checks, and C build. Setup failure blocks both builds.
3. `baseline-public.tgz` and `candidate-public.tgz` have separate per-file manifests;
   generated protocol hashes match their HTML metadata and compatible services.
4. Source fingerprints still name the current candidate; later edits need their
   own acceptance checks. Browser, caching, calls, and scale gates remain separate.

The script preserves A when C fails and attempts C after an A build/static failure
if dependency setup succeeded. Focused tests run explicitly with `NODE_ENV=test`; production builds use
`NODE_ENV=production`. Typecheck, Svelte checks, and focused tests each have
a 300-second timeout; timeout is failure, never approval. `summary.json` is written
on the full execution path; early setup errors remain visible in logs/statuses and
the process exit code.

Returned artifacts exclude `node_modules`. The submitted archive is approximately
83 MiB and remains owned by this migration until result integrity is verified.
After copying the accepted evidence/artifacts into the worktree, remove only this
job's inbox/outbox copies and the task-owned reproduction directory. Do not clean
the shared queue, Docker cache, or other jobs. Preserve one accepted A and C artifact
for runtime comparison; delete redundant extracted copies after use.

The coordinator can import returned frontend evidence with `python3 -B deployment/konclui/accept-offload.py wa-native-20261112-0245`. It validates the submitted/returned source identity, safe archive paths, Node version, protocol metadata, and every frontend file hash. It retains failed check statuses and creates separately named baseline/candidate artifacts without starting services. It refuses to overwrite accepted artifacts and removes its temporary extraction directory.
