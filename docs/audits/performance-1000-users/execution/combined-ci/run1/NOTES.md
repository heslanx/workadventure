# Combined CI mirror, run 1 (offload box, 2026-11-12 ~01:50 UTC)

Tree: HEAD `ddbe245a8` plus the then-uncommitted P1, P2, P4 and P5 files. Host Linux x86_64, Node 24.22.3, npm 11.19.1, 8 vCPU (the box ran the job on its host because its Docker was unavailable). 426 s.

18 of 27 steps passed (npm ci and 17 checks), 9 failed. None of the 9 failures is attributable to the slices:

- `play-lint`, `play-pretty-check`, `play-test`, `map-storage-lint`, `map-storage-pretty-check`, `map-storage-test`, `benchmark-test`: macOS AppleDouble files (`._PositionDispatcher.ts`, `._MapsManager.ts`, `._harness.test.ts`, ...) entered the archive when the coordinator appended working-tree files with macOS `tar -r` without `COPYFILE_DISABLE=1`. Every failing log names a `._*` file. Packaging defect of the coordinator, fixed in run 2.
- `benchmark-tsc`: the job script ran `tsc -p .` in `benchmark/`, which has no `tsconfig.json`. The package's `typecheck` script is the right command. Job-script defect, fixed in run 2.
- `back-test`: 12 files exit at import with `For variable "PLAY_URL": Required`; the job did not set the environment that CI sets. 164 of 164 tests in the files that load pass. Job-script defect, fixed in run 2.
