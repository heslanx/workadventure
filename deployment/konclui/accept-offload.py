#!/usr/bin/env python3
"""Verify and import one frozen frontend job without activating its artifacts."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[2]
QUEUE = Path.home() / "grokbox-offload"


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def extract(archive, destination):
    members = archive.getmembers()
    for member in members:
        name = PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts or not (member.isfile() or member.isdir()):
            raise ValueError(f"Unsupported artifact member: {member.name}")
    required = sum(member.size for member in members if member.isfile())
    if shutil.disk_usage(destination.parent).free < required + 2 * 1024**3:
        raise ValueError("Insufficient disk space to accept artifacts while retaining 2 GiB free")
    archive.extractall(destination, members=members, filter="data")


def accept(job):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", job):
        raise ValueError("Invalid job identifier")
    inbox = QUEUE / "inbox" / job
    outbox = QUEUE / "outbox" / job
    submitted = json.loads((inbox / "source-manifest.json").read_text())
    exit_code = int((outbox / "exit_code").read_text().strip())
    archive_path = outbox / "out.tgz"
    audit = ROOT / ".audit/konclui-runtime" / job
    output = ROOT / ".local/konclui/builds"
    output.mkdir(parents=True, exist_ok=True)
    audit.parent.mkdir(parents=True, exist_ok=True)
    if audit.exists():
        raise ValueError("This job already has an acceptance record; preserve its evidence")

    with tempfile.TemporaryDirectory(prefix=f".{job}-", dir=output) as temporary:
        temporary = Path(temporary)
        unpacked = temporary / "result"
        with tarfile.open(archive_path, "r:gz") as archive:
            extract(archive, unpacked)
        if (unpacked / "out").is_dir():
            unpacked = unpacked / "out"
        returned = json.loads((unpacked / "source-manifest.json").read_text())
        if returned != submitted:
            raise ValueError("Returned source identity differs from the submitted snapshot")
        statuses = dict(line.split("\t", 1) for line in (unpacked / "status.tsv").read_text().splitlines())
        accepted = []
        for variant in ("baseline", "candidate"):
            if statuses.get(f"{variant}-build") != "0" or statuses.get(f"{variant}-artifact") != "0":
                continue
            label = f"{job}-{variant}"
            destination = output / label
            if destination.exists() or (audit.parent / label).exists():
                raise ValueError(f"Existing artifact must be preserved: {label}")
            manifest_path = unpacked / f"{variant}-frontend-manifest.json"
            manifest = json.loads(manifest_path.read_text())
            expected = submitted[f"{variant}Fingerprint"]
            if manifest["sourceFingerprint"] != expected or manifest["commit"] != submitted["baselineCommit"]:
                raise ValueError(f"Unexpected {variant} frontend source identity")
            if not manifest["nodeVersion"].startswith("v24."):
                raise ValueError("The verified frontend toolchain must use Node 24")
            staged = temporary / label
            staged.mkdir()
            public = staged / "public"
            with tarfile.open(unpacked / f"{variant}-public.tgz", "r:gz") as archive:
                extract(archive, public)
            files = {path.relative_to(public).as_posix(): sha(path)
                     for path in sorted(public.rglob("*")) if path.is_file()}
            if files != manifest["files"]:
                raise ValueError(f"{variant} frontend bytes do not match the returned file manifest")
            index = (public / "index.html").read_text()
            metadata = re.search(r'<meta name="wa-api-version" content="([^"]+)"', index)
            if not metadata or metadata.group(1) != manifest["protocolHash"]:
                raise ValueError(f"{variant} HTML protocol metadata does not match its manifest")
            if "moment-hud.js" in index or "konclui-theme" in index:
                raise ValueError("Legacy injected entry point found in frontend artifact")
            accepted.append((variant, label, staged, manifest_path))

        audit.mkdir()
        for path in unpacked.iterdir():
            if path.is_file() and path.suffix != ".tgz":
                shutil.copyfile(path, audit / path.name)
        if (unpacked / "logs").is_dir():
            shutil.copytree(unpacked / "logs", audit / "logs")
        for name in ("exit_code", "seconds", "stdout.log"):
            if (outbox / name).is_file():
                shutil.copyfile(outbox / name, audit / name)
        for variant, label, staged, manifest_path in accepted:
            evidence = audit.parent / label
            if evidence.exists():
                raise ValueError(f"Existing artifact evidence must be preserved: {label}")
            evidence.mkdir()
            shutil.copyfile(manifest_path, evidence / "frontend-manifest.json")
            shutil.copyfile(inbox / "source-manifest.json", evidence / "source-manifest.json")
            staged.rename(output / label)
        receipt = {
            "job": job,
            "jobExitCode": exit_code,
            "archiveSha256": sha(archive_path),
            "acceptedArtifacts": [label for _, label, _, _ in accepted],
            "statuses": statuses,
            "scope": "Verified artifact identity and bytes; failed checks remain failed; no runtime activation",
        }
        (audit / "acceptance.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job")
    accept(parser.parse_args().job)
