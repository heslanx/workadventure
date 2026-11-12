# P1 manifest requests (for the coordinator; the lane did not edit dependency fields or lockfiles)

`benchmark/package.json` "scripts" now call `tsx`, `vitest` and `tsc`, and the code imports `@bufbuild/protobuf`
transitively (generated codecs) and Node built-ins. In the checkout they resolve only through root hoisting.
Requested change to `benchmark/package.json`, with versions already used by `play`/`back`/`libs/messages`:

- add `devDependencies`: `"tsx": "^4.22.3"`, `"vitest": "^4.1.7"`, `"@types/node"` (same range as `play`)
- keep `ws`, `@types/ws`, `typescript`, `@workadventure/messages`
- remove `ts-node-dev` (no script uses `ts-node` any more) — optional, only if the lockfile is being refreshed anyway
- `benchmark/yarn.lock` and `benchmark/package-lock.json` are stale standalone lockfiles for a package that is a
  root npm workspace; decide separately whether they should be deleted.

Workaround in place: none needed in the checkout (hoisted packages resolve). On the remote snapshot a throwaway
`package.json` installs the same packages.
