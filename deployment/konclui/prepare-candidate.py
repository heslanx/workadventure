#!/usr/bin/env python3
"""Verify frozen candidate artifacts and prepare local configuration without starting services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.local/konclui/candidate'
SERVICES = {'play': 'thecodingmachine/workadventure-play:v1.34.5',
            'back': 'thecodingmachine/workadventure-back:v1.34.5',
            'map-storage': 'thecodingmachine/workadventure-map-storage:v1.34.5'}


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def within_worktree(path):
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(ROOT):
        raise ValueError(f'Artifact must be inside this worktree: {path}')
    return resolved


def artifact_path(root, name):
    if not isinstance(name, str) or '\\' in name or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError(f'Invalid artifact path: {name}')
    path = root / name
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError(f'Artifact symlink forbidden: {name}')
    if not path.resolve(strict=True).is_relative_to(root):
        raise ValueError(f'Artifact escapes its root: {name}')
    return path


def verify(root, files, folders):
    actual = set()
    for folder in folders:
        for path in (root / folder).rglob('*'):
            if path.is_symlink():
                raise ValueError(f'Artifact symlink forbidden: {path}')
            if path.is_file():
                actual.add(path.relative_to(root).as_posix())
    if actual != set(files):
        raise ValueError(f'Artifact inventory differs: missing={len(set(files) - actual)}, extra={len(actual - set(files))}')
    for name, expected in files.items():
        if not re.fullmatch('[a-f0-9]{64}', expected) or sha(artifact_path(root, name)) != expected:
            raise ValueError(f'Artifact hash mismatch: {name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('label', help='completed candidate frontend build label')
    parser.add_argument('--asset-receipt', type=Path, default=ROOT / '.local/konclui/asset-build/all-receipt.json')
    parser.add_argument('--protocol-receipt', required=True, type=Path, action='append',
                        help='read-only inspection of the actual local Play/Back/map-storage image IDs and hashes')
    args = parser.parse_args()
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,89}', args.label):
        parser.error('Use a lowercase build label with letters, digits and hyphens')
    front = within_worktree(ROOT / '.local/konclui/builds' / args.label / 'public')
    front_manifest_path = within_worktree(ROOT / '.audit/konclui-runtime' / args.label / 'frontend-manifest.json')
    front_manifest = json.loads(front_manifest_path.read_text())
    if front_manifest.get('sourceMode') not in ('working-tree', 'commit') or not front_manifest.get('sourceFingerprint'):
        raise ValueError('Candidate requires a frozen source fingerprint')
    source_manifest_path = front_manifest_path.with_name('source-manifest.json')
    source_manifest = json.loads(source_manifest_path.read_text())
    if 'candidateFingerprint' in source_manifest:
        source_files = {**source_manifest['baselineFiles'], **source_manifest['overlayFiles']}
        for name in source_manifest['deletedFiles']:
            source_files.pop(name)
        source_fingerprint = hashlib.sha256(''.join(
            f'{name}\0{source_files[name]}\n' for name in sorted(source_files)).encode()).hexdigest()
        if source_fingerprint != source_manifest['candidateFingerprint']:
            raise ValueError('Offload source manifest fingerprint differs from its file inventory')
    else:
        source_files = source_manifest.get('files', {})
        source_fingerprint = source_manifest.get('sourceFingerprint')
    if (source_fingerprint != front_manifest['sourceFingerprint'] or
            'play/src/front/Components/Konclui/KoncluiFrame.svelte' not in source_files):
        raise ValueError('Source manifest does not identify the native Konclui frontend')
    verify(front, front_manifest['files'], [''])
    index = (front / 'index.html').read_text()
    if 'moment-hud.js' in index or 'konclui-theme' in index:
        raise ValueError('Legacy injected entry point in candidate frontend')
    protocol = front_manifest['protocolHash']
    html_protocol = re.search(r'<meta\b[^>]*name=["\']wa-api-version["\'][^>]*content=["\']([^"\']+)["\']', index)
    if not re.fullmatch('[a-f0-9]+', protocol) or not html_protocol or html_protocol[1] != protocol:
        raise ValueError('Frontend HTML does not identify the generated protocol hash')

    receipt_path = within_worktree(args.asset_receipt)
    assets = receipt_path.parent
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('scope') != 'all' or receipt.get('result', {}).get('map', {}).get('errors') != []:
        raise ValueError('A complete successful standalone map + character receipt is required')
    if not receipt.get('result', {}).get('characters', {}).get('petSpecies', 0):
        raise ValueError('Character export validation is absent from the asset receipt')
    if not receipt.get('config', {}).get('whiteboardNamespace', '').startswith('konclui-native-local/'):
        raise ValueError('Candidate assets must isolate whiteboards from production')
    asset_files = {item['path']: item['sha256'] for item in receipt['files']}
    if len(asset_files) != len(receipt['files']):
        raise ValueError('Duplicate entries in asset receipt')
    verify(assets, asset_files, ['maps', 'resources', 'catalogues'])
    for name in ('maps/konclui-office/office.wam', 'maps/konclui-office/office.tmj',
                 'maps/konclui-office/koi/overlays.json', 'catalogues/woka.json', 'catalogues/companions.json',
                 'resources/konclui/accessories.json', 'resources/konclui/logo.svg',
                 'resources/konclui/fonts/urbanist-latin.woff2', 'resources/konclui/fonts/OFL.txt'):
        if name not in asset_files:
            raise ValueError(f'Required candidate asset is absent: {name}')
    wam = json.loads((assets / 'maps/konclui-office/office.wam').read_text())
    if wam.get('mapUrl') != 'office.tmj':
        raise ValueError('Candidate WAM must resolve the local office.tmj')
    for name, expected in receipt.get('inputs', {}).items():
        if sha(artifact_path(ROOT, name)) != expected:
            raise ValueError(f'Build input changed after asset receipt: {name}')

    protocol_paths = [within_worktree(path) for path in args.protocol_receipt]
    observed = []
    for path in protocol_paths:
        record = json.loads(path.read_text())
        observed.extend(record if isinstance(record, list) else [record])
    images = {}
    for service, reference in SERVICES.items():
        matches = [item for item in observed if item.get('imageReference') == reference]
        if len(matches) != 1:
            raise ValueError(f'One actual image inspection required for {service}')
        item = matches[0]
        if item.get('imageReference') != reference or item.get('protocolHash') != protocol:
            raise ValueError(f'Service image/protocol mismatch for {service}')
        if not re.fullmatch('sha256:[a-f0-9]{64}', item.get('imageId', '')):
            raise ValueError(f'Immutable local image ID missing for {service}')
        images[service] = item['imageId']

    for directory in ('konclui', 'konclui-pets'):
        (front / 'resources' / directory).mkdir(parents=True, exist_ok=True)

    STATE.mkdir(parents=True, exist_ok=True)
    private = STATE / 'private.env'
    if not private.exists():
        fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            for key in ('SECRET_KEY', 'MAP_STORAGE_API_TOKEN', 'MAP_STORAGE_AUTHENTICATION_TOKEN'):
                output.write(f'{key}={secrets.token_hex(32)}\n')
    elif private.is_symlink() or not private.is_file() or private.stat().st_mode & 0o077:
        raise ValueError('Candidate private.env must be a regular owner-only file')
    prepared = {'version': 1, 'project': 'konclui-native-candidate', 'buildLabel': args.label,
                'assetConfig': receipt['config'],
                'protocolHash': protocol, 'sourceFingerprint': front_manifest['sourceFingerprint'],
                'frontendManifestSha256': sha(front_manifest_path), 'assetReceiptSha256': sha(receipt_path),
                'sourceManifestSha256': sha(source_manifest_path),
                'protocolReceiptSha256': {path.relative_to(ROOT).as_posix(): sha(path) for path in protocol_paths},
                'serviceImages': images,
                'frontFiles': front_manifest['files'], 'assetFiles': asset_files}
    (STATE / 'prepared.json').write_text(json.dumps(prepared, indent=2) + '\n')
    runtime = {'CANDIDATE_FRONT': os.path.relpath(front, ROOT / 'deployment/konclui'),
               'CANDIDATE_ASSETS': os.path.relpath(assets, ROOT / 'deployment/konclui')}
    runtime.update({f'CANDIDATE_{service.upper().replace("-", "_")}_IMAGE': image
                    for service, image in images.items()})
    (STATE / 'runtime.env').write_text(''.join(f'{key}={value}\n' for key, value in runtime.items()))
    print(f'Prepared {args.label} for konclui-native-candidate on http://localhost:8094; no services started.')


if __name__ == '__main__':
    main()
