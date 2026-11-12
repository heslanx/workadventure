#!/usr/bin/env python3
"""Freeze selected asset sources for one bounded, explicitly authorized offload job."""
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
JOB = Path.home() / 'grokbox-offload/inbox/wa-assets-20261112'
if JOB.exists():
    raise SystemExit('Asset job already exists; never replace a submitted snapshot')
JOB.mkdir(parents=True)
provenance = json.loads((ROOT / 'assets/konclui/provenance.json').read_text())
names = [entry['destination'] for entry in provenance['files']]
names += ['assets/konclui/provenance.json', 'tools/build-konclui-assets.py',
          'play/src/pusher/data/woka.json', 'play/src/pusher/data/companions.json']
mapping = {name: ROOT / name for name in names}
for name in ('offload-assets-check.py', 'offload-assets-run.sh'):
    mapping[f'job/{name}'] = ROOT / 'deployment/konclui' / name
manifest = {'version': 1, 'files': {}, 'scope': 'Selected imported asset sources with native adaptations; '
            'standalone builder and upstream avatar/companion catalogue inputs only. No generated outputs.',
            'requestedResources': {'cpus': 1, 'memory': '2g', 'timeoutSeconds': 600},
            'dependencies': {'numpy': '2.5.3', 'Pillow': '12.3.0', 'svg': 'existing rsvg-convert only'}}
states = {}
with tarfile.open(JOB / 'src.tgz', 'w:gz', compresslevel=1) as archive:
    for name, path in sorted(mapping.items()):
        relative = Path(name)
        if relative.is_absolute() or any(part in ('..', 'node_modules', '.git', '.local', '.audit', '__pycache__')
                                        or part.startswith('.env') for part in relative.parts):
            raise ValueError(f'Forbidden asset input: {name}')
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f'Input is not a regular selected source: {name}')
        before = path.stat()
        data = path.read_bytes()
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError(f'Input changed while packaging: {name}')
        states[name] = (after.st_size, after.st_mtime_ns)
        manifest['files'][name] = hashlib.sha256(data).hexdigest()
        entry = tarfile.TarInfo(name)
        entry.size = len(data)
        entry.mode = 0o755 if name.endswith('.sh') else 0o644
        archive.addfile(entry, io.BytesIO(data))
    manifest['sourceFingerprint'] = hashlib.sha256(''.join(
        f'{name}\0{manifest["files"][name]}\n' for name in sorted(manifest['files'])).encode()).hexdigest()
    payload = json.dumps(manifest, indent=2).encode() + b'\n'
    entry = tarfile.TarInfo('source-manifest.json')
    entry.size = len(payload)
    archive.addfile(entry, io.BytesIO(payload))
for name, expected in states.items():
    current = mapping[name].stat()
    if (current.st_size, current.st_mtime_ns) != expected:
        raise ValueError(f'Input changed before snapshot completed: {name}')
(JOB / 'source-manifest.json').write_bytes(payload)
shutil.copyfile(ROOT / 'deployment/konclui/offload-assets-run.sh', JOB / 'run.sh')
(JOB / 'run.sh').chmod(0o755)
(JOB / 'job.env').write_text('IMAGE=python:3.13-slim\nNETWORK=bridge\nCPUS=1\nMEM=2g\nTIMEOUT=600\n')
subprocess.run(['bash', '-n', str(JOB / 'run.sh')], check=True)
with (JOB / 'src.tgz').open('rb') as source:
    archive_hash = hashlib.file_digest(source, 'sha256').hexdigest()
receipt = {'jobId': JOB.name, 'sourceFingerprint': manifest['sourceFingerprint'],
           'archiveSha256': archive_hash, 'archiveBytes': (JOB / 'src.tgz').stat().st_size,
           'inputFiles': len(manifest['files']), 'scope': manifest['scope']}
(JOB / 'submission.json').write_text(json.dumps(receipt, indent=2) + '\n')
(JOB / 'READY').touch(exist_ok=False)
print(json.dumps(receipt, indent=2))
