#!/usr/bin/env python3
"""Build a frozen commit or working-tree snapshot with task-owned dependency caches."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
IMAGE = "ghcr.io/thecodingmachine/nodejs:v2-24-trixie-build@sha256:7830eb053029550f85afac596c82dbfeee83c42f5ed7a7c14f5f5a5c47c48d6a"
OWNER = "konclui-native-build"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("label")
source = parser.add_mutually_exclusive_group(required=True)
source.add_argument("--ref")
source.add_argument("--working-tree", action="store_true")
args = parser.parse_args()
if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.label):
    parser.error("Use a short lowercase label containing letters, digits, and hyphens.")
audit = ROOT / ".audit/konclui-runtime" / args.label
output = ROOT / ".local/konclui/builds" / args.label
if audit.exists() or output.exists():
    parser.error("Build label already exists. Choose another label to preserve evidence.")
audit.mkdir(parents=True)
output.mkdir(parents=True)
archive = output / "source.tar"
snapshot = [sys.executable, str(ROOT / "deployment/konclui/snapshot.py"), str(archive)]
snapshot += ["--working-tree"] if args.working_tree else ["--ref", args.ref]
subprocess.run(snapshot, check=True)
source_manifest = archive.with_suffix(".json")
manifest = json.loads(source_manifest.read_text())
(audit / "source-manifest.json").write_text(source_manifest.read_text())
source_manifest.unlink()
install_files = {name: sha for name, sha in manifest["files"].items() if name.endswith("package.json") or name.endswith("package-lock.json") or name.startswith("patches/")}
install_key = hashlib.sha256((IMAGE + json.dumps(install_files, sort_keys=True)).encode()).hexdigest()


def docker(*argv, **kwargs):
    return subprocess.run(["docker", *argv], check=True, **kwargs)


def capture(*argv):
    return subprocess.check_output(["docker", *argv], text=True).strip()


volumes = ["konclui-native-build-root-deps", "konclui-native-build-message-deps"]
for volume in volumes:
    exists = subprocess.run(["docker", "volume", "inspect", volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if exists:
        owner = capture("volume", "inspect", "--format", '{{index .Labels "konclui.owner"}}', volume)
        if owner != OWNER:
            raise RuntimeError(f"Refusing to reuse a dependency volume owned by another task: {volume}")
    else:
        docker("volume", "create", "--label", f"konclui.owner={OWNER}", volume, stdout=subprocess.DEVNULL)

cid = None
try:
    cid = capture("create", "--label", f"konclui.owner={OWNER}", "--memory", "5g", "--memory-swap", "5g", "--cpus", "3", "--entrypoint", "sleep", "--mount", f"type=volume,src={volumes[0]},dst=/src/node_modules", "--mount", f"type=volume,src={volumes[1]},dst=/src/messages/node_modules", IMAGE, "infinity")
    docker("start", cid, stdout=subprocess.DEVNULL)
    (audit / "resource.json").write_text(json.dumps({"containerId": cid, "owner": OWNER, "image": IMAGE, "startedAt": capture("inspect", "--format", "{{.State.StartedAt}}", cid), "cacheVolumes": volumes}, indent=2) + "\n")
    with archive.open("rb") as source_input:
        docker("exec", "-i", cid, "tar", "-x", "-C", "/src", stdin=source_input)
    archive.unlink()
    command = r'''
set -euo pipefail
cd /src/messages
if [ "$(cat node_modules/.konclui-install-key 2>/dev/null || true)" != "$INSTALL_KEY" ]; then
    npm ci --no-audit --no-fund --loglevel=error
    printf '%s' "$INSTALL_KEY" > node_modules/.konclui-install-key
fi
npm run -s tag-version
npm run -s ts-proto
cd /src
if [ "$(cat node_modules/.konclui-install-key 2>/dev/null || true)" != "$INSTALL_KEY" ]; then
    npm ci --no-audit --no-fund --loglevel=error --workspace=workadventure-play --workspace=@workadventure/iframe-api-typings...
    printf '%s' "$INSTALL_KEY" > node_modules/.konclui-install-key
fi
cd /src/play
export NODE_ENV=production
npm run -s typesafe-i18n
npm run -s build-iframe-api
npm run -s build
'''
    with (audit / "build.log").open("w") as log:
        docker("exec", "-e", "NODE_OPTIONS=--max-old-space-size=4096", "-e", f"INSTALL_KEY={install_key}", cid, "bash", "-lc", command, stdout=log, stderr=subprocess.STDOUT)
    docker("cp", f"{cid}:/src/play/dist/public", str(output / "public"), stdout=subprocess.DEVNULL)
    protocol_source = capture("exec", cid, "cat", "/src/libs/messages/src/JsonMessages/ApiVersion.ts")
    protocol = re.search(r'apiVersionHash = "([0-9a-f]+)"', protocol_source).group(1)
    front = output / "public"
    files = {str(path.relative_to(front)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(front.rglob("*")) if path.is_file()}
    record = {"commit": manifest["commit"], "sourceFingerprint": manifest["sourceFingerprint"], "sourceMode": manifest["mode"], "nodeImage": IMAGE, "nodeVersion": capture("exec", cid, "node", "--version"), "protocolHash": protocol, "files": files}
    (audit / "frontend-manifest.json").write_text(json.dumps(record, indent=2) + "\n")
    (audit / "dependency-cache-size.txt").write_text(capture("exec", cid, "du", "-sh", "/src/node_modules", "/src/messages/node_modules") + "\n")
    print(f"Built {args.label}: {manifest['sourceFingerprint'][:12]}, protocol {protocol}.")
finally:
    archive.unlink(missing_ok=True)
    if cid:
        docker("stop", "-t", "5", cid, stdout=subprocess.DEVNULL)
        docker("rm", cid, stdout=subprocess.DEVNULL)
