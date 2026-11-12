# Orca per-workspace environment: local Docker over SSH

The `docker-ssh` recipe in `orca.yaml` gives each Orca workspace its own disposable Docker
container on this machine. Orca connects to the container over SSH and creates the workspace
worktree inside it. Nothing runs in the cloud and nothing costs money.

## What each container holds

- Node 24 (the version CI uses), git, gh, build tools, `sshd`.
- `claude` and `codex`, signed in through the one-time auth image below.
- A clone of the repo at `/home/node/workadventure`: `origin` is the fork
  (`heslanx/workadventure`, fetch and push), `upstream` is `workadventure/workadventure`.
- A GitHub credential piped in from the desktop's `gh auth token` at create time. It lives
  only in that container, never in an image or a file in this repo.

The settings live in `docker-state.json` (non-secret). Any value can be overridden with the
matching `ORCA_VM_*` environment variable (see `docker-common.sh`).

## One-time image build

Run these from the repo root.

1. Build the base image (10 to 20 minutes):

   ```bash
   scripts/orca-vm/docker-base-image.sh
   ```

2. Start the auth container:

   ```bash
   scripts/orca-vm/docker-auth-image.sh start
   ```

3. Sign in both agents in your own terminal. Each prints a URL and a code to open in the
   browser:

   ```bash
   docker exec -it -u node workadventure-orca-auth claude auth login
   docker exec -it -u node workadventure-orca-auth codex login --device-auth
   ```

4. Commit the authenticated image. The script refuses if either agent is signed out:

   ```bash
   scripts/orca-vm/docker-auth-image.sh commit
   ```

Repeat steps 2 to 4 when an agent session expires.

## Lifecycle

| Orca step | Script | What it does |
| --- | --- | --- |
| create | `docker-create.sh` | Runs a container on a random `127.0.0.1` port, records its host key in `~/.ssh/known_hosts`, signs `gh` in, updates `master`, prints the SSH target |
| suspend | `docker-suspend.sh` | `docker stop`; files and host keys stay |
| resume | `docker-resume.sh` | `docker start`, re-records the new port, prints the SSH target again |
| destroy | `docker-destroy.sh` | `docker rm -f` and removes that endpoint from `known_hosts` |

Each container generates its own SSH host keys on first start. The desktop key used to log in
is generated once at `.orca-vm/id_ed25519` (gitignored).

## Checks

```bash
orca vm recipe doctor docker-ssh --json              # static wiring
orca vm recipe doctor docker-ssh --provision --json  # create, validate, destroy
```

Inside a workspace terminal: `orca vm env doctor --run-setup --json`.

`scripts/orca-setup.sh` is the worktree setup (`scripts.setup`). On macOS without GNU sed it
skips `npm run ts-proto` with a warning, because the `messages` script uses GNU `sed -i`.
