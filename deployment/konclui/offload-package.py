#!/usr/bin/env python3
"""Package a pinned upstream frontend and a frozen candidate for the authorized queue."""

import hashlib
import io
import json
from pathlib import Path
import posixpath
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
JOB = Path.home() / "grokbox-offload/inbox" / sys.argv[1]
COMMIT = "38c808924267157fb3bd3f7a943de35f026e4773"
if JOB.exists():
    raise SystemExit("Job already exists. Never overwrite a queued snapshot.")
JOB.mkdir(parents=True)


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def excluded(name):
    return any(part.startswith(".env") or part in {"node_modules", ".git", ".audit", ".local"} for part in Path(name).parts)


def fingerprint(files):
    return hashlib.sha256("".join(f"{name}\0{files[name]}\n" for name in sorted(files)).encode()).hexdigest()


def add_bytes(archive, name, data, mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    archive.addfile(info, io.BytesIO(data))


manifest = {"baselineCommit": COMMIT, "baselineTree": git("rev-parse", f"{COMMIT}^{{tree}}").decode().strip(), "candidateHead": git("rev-parse", "HEAD").decode().strip(), "baselineFiles": {}, "overlayFiles": {}, "deletedFiles": [], "omittedBaselinePaths": [], "scope": "All public upstream tracked source except .env* and excluded runtime directories; candidate overlay is limited to play source and tests. Konclui generated maps/resources and dependencies are deliberately excluded."}
tracked = git("diff", "--name-only", "-z", COMMIT, "--", "play").decode().split("\0")
untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--", "play/src", "play/tests").decode().split("\0")
names = sorted(set(name for name in tracked + untracked if name and not excluded(name)))
states = {}
archive_process = subprocess.Popen(["git", "-C", str(ROOT), "archive", "--format=tar", COMMIT], stdout=subprocess.PIPE)
with tarfile.open(JOB / "src.tgz", "w:gz", compresslevel=3) as output:
    with tarfile.open(fileobj=archive_process.stdout, mode="r|") as baseline:
        for member in baseline:
            name = member.name.rstrip("/")
            if excluded(name):
                manifest["omittedBaselinePaths"].append(name)
                continue
            if member.isfile():
                data = baseline.extractfile(member).read()
                manifest["baselineFiles"][name] = hashlib.sha256(data).hexdigest()
                add_bytes(output, f"baseline/{name}", data, member.mode)
            elif member.issym():
                manifest["baselineFiles"][name] = hashlib.sha256(member.linkname.encode()).hexdigest()
                member.name = f"baseline/{name}"
                output.addfile(member)
    if archive_process.wait() != 0:
        raise RuntimeError("Could not archive the pinned upstream commit.")
    for name in names:
        path = ROOT / name
        if not path.exists():
            manifest["deletedFiles"].append(name)
            continue
        if path.is_symlink():
            raise RuntimeError(f"Candidate overlay cannot include source symlinks: {name}")
        before = path.stat()
        data = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
            raise RuntimeError(f"Candidate changed during snapshot: {name}")
        states[name] = (after.st_mtime_ns, after.st_size)
        manifest["overlayFiles"][name] = hashlib.sha256(data).hexdigest()
        add_bytes(output, f"candidate-overlay/{name}", data, before.st_mode & 0o777)
    combined = dict(manifest["baselineFiles"])
    combined.update(manifest["overlayFiles"])
    for name in manifest["deletedFiles"]:
        combined.pop(name)
    manifest["baselineFingerprint"] = fingerprint(manifest["baselineFiles"])
    manifest["candidateFingerprint"] = fingerprint(combined)
    payload = json.dumps(manifest, indent=2).encode() + b"\n"
    add_bytes(output, "source-manifest.json", payload)
    for name in ["offload-inputs.mjs", "offload-front.mjs"]:
        add_bytes(output, f"job/{name}", (ROOT / "deployment/konclui" / name).read_bytes())
for name, expected in states.items():
    current = (ROOT / name).stat()
    if (current.st_mtime_ns, current.st_size) != expected:
        raise RuntimeError(f"Candidate changed before snapshot completed: {name}")
(JOB / "source-manifest.json").write_bytes(payload)
shutil.copy2(ROOT / "deployment/konclui/offload-run.sh", JOB / "run.sh")
(JOB / "run.sh").chmod(0o755)
(JOB / "job.env").write_text("IMAGE=node:24-trixie\nNETWORK=bridge\nCPUS=3\nMEM=5g\nTIMEOUT=1800\n")
with tarfile.open(JOB / "src.tgz") as check:
    for member in check:
        path = Path(member.name)
        if path.is_absolute() or ".." in path.parts or excluded(member.name):
            raise RuntimeError(f"Unsafe queued archive path: {member.name}")
        if member.issym():
            destination = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
            if Path(member.linkname).is_absolute() or not destination.startswith("baseline/"):
                raise RuntimeError(f"Unsafe queued source symlink: {member.name}")
subprocess.run(["bash", "-n", str(JOB / "run.sh")], check=True)
with (JOB / "src.tgz").open("rb") as archive:
    archive_sha = hashlib.file_digest(archive, "sha256").hexdigest()
submission = {"jobId": JOB.name, "archiveSha256": archive_sha, "baselineCommit": COMMIT, "baselineFingerprint": manifest["baselineFingerprint"], "candidateFingerprint": manifest["candidateFingerprint"], "overlayFileCount": len(manifest["overlayFiles"]), "omittedEnvPaths": manifest["omittedBaselinePaths"], "archiveBytes": (JOB / "src.tgz").stat().st_size}
(JOB / "submission.json").write_text(json.dumps(submission, indent=2) + "\n")
(JOB / "READY").touch(exist_ok=False)
print(json.dumps(submission, indent=2))
