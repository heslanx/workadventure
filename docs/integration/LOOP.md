# Integration loop

One integrator session lands the work of every WorkAdventure session in this checkout on our fork's
`master` (`origin` = `heslanx/workadventure`): granular commits, a full serial check, a push only on
green. Peer sessions write code; the integrator is the single git writer. The queue, decisions and
evidence live in [`STATE.md`](STATE.md); every iteration reads it first and updates it last.

## Roles

- **Integrator**: the only session that commits, merges or pushes in this checkout. Owns `STATE.md`.
- **Producers**: peer sessions that edit files (UI passes, debt removal, dependency upgrades). They
  announce a batch with "done" plus its file list, and work in an isolated clone when they touch
  `package.json`, lockfiles or `node_modules`.
- **Coordinator** (optional): a session the user named to order the work. Its ordering wins over the
  queue order in `STATE.md`.

Find live peers with `ListAgents`; talk to them with `SendMessage`. A peer's report is a lead: read
the diff and run the checks yourself.

## One iteration

1. Read `STATE.md`. Pick the first queue item whose status is `ready`. When none is ready, go to step 7.
2. Confirm the tree is quiet: no file under the batch's paths changed in the last 5 minutes, no host
   `npm install`/`npm ci` running for this checkout, and the producer said "done". Otherwise mark the
   item `waiting` with the reason and go to step 7.
3. Group the batch into granular commits by concern (one owner, one area, one behaviour per commit).
   Commit with plain `git commit` so the husky/lint-staged hooks run. A file shared by two owners on
   the same lines goes whole into the commit of the area it belongs to; say so in the message.
4. Run the full serial check on `HEAD` (below). Every command green is the completion criterion.
5. Red: fix in a new commit when the cause is in the batch, or send the producer the failing command
   and its output when the fix is theirs. Mark the item `blocked` with the evidence. Go to step 7.
6. Green: merge into `master`, push `origin master`, record the SHA and the check output in
   `STATE.md`, and send the SHA to the producers and the coordinator.
7. Write the next prompt into `STATE.md` (`## Next prompt`), then continue with step 1 or stop on a
   stop condition.

## Full serial check

Run one command at a time; this machine's load makes parallel suites time out. Use Node 24:
`PATH=~/.local/share/fnm/node-versions/v24.18.0/installation/bin:$PATH`.

```sh
cd play && npm run typesafe-i18n && npm run typecheck && npm run svelte-check && npm run lint \
  && npm run pretty-check && npm run i18n:check && npx vitest run
cd ../back && npm test -- --run
cd ../map-storage && npx tsc --noEmit && npx vitest run --testTimeout=30000
```

`map-storage` gets 30 s because three `UploadController` tests exceed 5 s on this host under load
(timing, recorded in `docs/ui-polish/TASKS.md` under Parked). Add the package's own checks when a
batch touches `libs/`, `messages/` or `desktop/`; `.github/workflows/continuous_integration.yml` is
the source of truth.

## Environment facts

- Host `node_modules` must hold darwin native bindings (`@rolldown/binding-darwin-arm64`). A
  container that runs `npm install` on the bind mount replaces them with Linux ones. Start the stack
  with named `node_modules` volumes: `VITE_WATCH_POLLING=true docker compose --env-file .env.template
  --env-file .env -f docker-compose.yaml -f /tmp/wa-stack.override.yaml up -d`. New volumes are owned
  by root: `chown docker:docker` each mount once (uid 1000) or the container install fails `EACCES`.
  The override lives in `/tmp` and is gone after a reboot: rebuild it with one named volume per
  `node_modules` directory for `play`, `back`, `map-storage` and `messages`, plus the Traefik
  constraint `Label(`com.docker.compose.project`,`workadventure`)`.
- A verification worktree outside the repo needs `server.fs.allow` for the symlinked `node_modules`,
  or Vitest fails with `Denied ID`. Keep that edit in the worktree only.
- `.env.bak` stays untracked; it may hold secrets. Every `git add` excludes it.

## Stop conditions

Stop and ask the user only for:

- a product or wording decision a producer cannot settle;
- a destructive action (force-push, history rewrite, deleting another session's files or stash);
- the same check red after three fixes that each targeted a different cause;
- a credential, account or paid service the loop lacks.

The loop is done when the queue has no `ready`, `waiting` or `blocked` items and every code change on
`origin/master` is covered by the last green check in `STATE.md` (documentation-only commits need no
re-run).

## Prompts

**Start** (new integrator): "You are the integrator for /Users/erickheslan/Developments/study/workadventure.
Read docs/integration/LOOP.md and docs/integration/STATE.md, announce yourself to the peers listed by
ListAgents as the single git writer, then run one iteration."

**Continue**: "Read docs/integration/STATE.md and run the prompt under `## Next prompt`."

**Producer handoff** (send to a peer): "When your batch is done, send the integrator: 'done', the file
list, the checks you ran with exit codes, and any file you left half-edited. Make no git writes in
this checkout."

**Review** (fresh agent, no shared context): "Review commits <base>..<head> in
/Users/erickheslan/Developments/study/workadventure for bugs, mixed concerns per commit and commit
messages that misdescribe the diff. Report findings with file:line; change nothing."

**Recovery**: "The last check was red. Read the failing log named in STATE.md, state the cause with
one observable check, decide whose fix it is (batch or producer), and record the decision before
editing."
