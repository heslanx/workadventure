#!/usr/bin/env python3
"""Freeze intended frontend build inputs without changing Git's index."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--working-tree", action="store_true")
parser.add_argument("--ref", default="HEAD")
args = parser.parse_args()
if args.output.exists() or args.output.with_suffix(".json").exists():
    parser.error("Snapshot output already exists; preserve the previous evidence.")


def git(*argv):
    return subprocess.check_output(["git", "-C", str(ROOT), *argv])


head = git("rev-parse", f"{args.ref}^{{commit}}").decode().strip()
manifest = {"commit": head, "mode": "working-tree" if args.working_tree else "commit", "files": {}}
args.output.parent.mkdir(parents=True, exist_ok=True)
if not args.working_tree:
    with args.output.open("xb") as output:
        subprocess.run(["git", "-C", str(ROOT), "archive", "--format=tar", head], stdout=output, check=True)
    manifest["tree"] = git("rev-parse", f"{head}^{{tree}}").decode().strip()
    with tarfile.open(args.output) as archive:
        for member in archive:
            if member.isfile():
                with archive.extractfile(member) as source:
                    manifest["files"][member.name] = hashlib.sha256(source.read()).hexdigest()
else:
    tracked = git("ls-files", "-z").decode().split("\0")
    untracked = git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")
    source_roots = ("play/src/", "play/public/", "libs/", "messages/", "patches/")
    names = sorted(set(tracked + [name for name in untracked if name.startswith(source_roots)]))
    states = {}
    with tarfile.open(args.output, "x") as archive:
        for name in names:
            if not name:
                continue
            relative = Path(name)
            if any(part in {"node_modules", ".local", ".audit", ".git"} for part in relative.parts):
                continue
            if relative.name.startswith(".env") and relative.name != ".env.template":
                continue
            path = ROOT / relative
            if not path.exists() and not path.is_symlink():
                continue
            before = path.lstat()
            item = tarfile.TarInfo(name)
            item.mode = stat.S_IMODE(before.st_mode)
            if path.is_symlink():
                link = os.readlink(path)
                if not path.resolve().is_relative_to(ROOT):
                    raise ValueError(f"Source link escapes the standalone checkout: {name}")
                item.type = tarfile.SYMTYPE
                item.linkname = link
                data = link.encode()
                archive.addfile(item)
            else:
                data = path.read_bytes()
                item.size = len(data)
                archive.addfile(item, io.BytesIO(data))
            after = path.lstat()
            if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                raise RuntimeError(f"Source changed while snapshotting: {name}")
            states[name] = (after.st_mtime_ns, after.st_size)
            manifest["files"][name] = hashlib.sha256(data).hexdigest()
    for name, state in states.items():
        current = (ROOT / name).lstat()
        if (current.st_mtime_ns, current.st_size) != state:
            raise RuntimeError(f"Source changed before snapshot completed: {name}")

with args.output.open("rb") as archive:
    manifest["archiveSha256"] = hashlib.file_digest(archive, "sha256").hexdigest()
manifest["sourceFingerprint"] = hashlib.sha256(json.dumps(manifest["files"], sort_keys=True).encode()).hexdigest()
args.output.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Frozen {len(manifest['files'])} files from {manifest['mode']} at {head[:12]}.")
