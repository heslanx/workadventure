#!/usr/bin/env python3
"""Verify frozen asset inputs and report scoped remote build outputs."""
import ast
import base64
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def verify_inputs():
    manifest = json.loads((ROOT / 'source-manifest.json').read_text())
    for name, expected in manifest['files'].items():
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or sha(path) != expected:
            raise ValueError(f'Frozen input differs: {name}')
    fingerprint = hashlib.sha256(''.join(f'{name}\0{manifest["files"][name]}\n'
                                       for name in sorted(manifest['files'])).encode()).hexdigest()
    if fingerprint != manifest['sourceFingerprint']:
        raise ValueError('Frozen input fingerprint mismatch')
    print(json.dumps({'verifiedInputs': len(manifest['files']), 'sourceFingerprint': fingerprint}))


def versions():
    record = {'python': platform.python_version(), 'platform': platform.platform(),
              'architecture': platform.machine(), 'cpuCount': os.cpu_count(),
              'scope': 'Host observations, not proof that requested resource limits were enforced'}
    for name in ('numpy', 'Pillow'):
        try:
            record[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            record[name] = None
    for name in ('cpu.max', 'memory.max'):
        path = Path('/sys/fs/cgroup') / name
        if path.is_file():
            record[name] = path.read_text().strip()
    print(json.dumps(record, indent=2))
    return record['numpy'] == '2.5.3' and record['Pillow'] == '12.3.0'


def whiteboards():
    path = ROOT / 'assets/konclui/source/hq-office/build.py'
    tree = ast.parse(path.read_text())
    names = {'uid', 'whiteboard_link'}
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id == 'NS' for target in node.targets))
    scope = {'uuid': uuid, 'hashlib': hashlib, 'base64': base64, 'NS': namespace}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), 'exec'), scope)
    key = 'meeting_01/board'
    entity = scope['uid'](key)
    original = scope['whiteboard_link'](key)
    isolated = scope['whiteboard_link'](key, 'konclui-native-local/konclui-office/')
    if original == isolated or entity != scope['uid'](key):
        raise ValueError('Whiteboard isolation changed no link or changed entity identity')
    digest = hashlib.sha256((namespace + key).encode()).digest()
    expected = f'https://excalidraw.com/#room={digest[:10].hex()},{base64.urlsafe_b64encode(digest[10:26]).decode().rstrip("=")}'
    if original != expected:
        raise ValueError('Direct-build default whiteboard behavior changed')
    print(json.dumps({'whiteboardLinksDiffer': True, 'entityIdPreserved': entity,
                      'defaultBehaviorPreserved': True, 'scope': 'Pure source seam; no map build or external request'}))


def outputs():
    output = ROOT / '.local/konclui/asset-build'
    scope = 'all' if (output / 'all-receipt.json').exists() else 'characters'
    receipt_path = output / f'{scope}-receipt.json'
    if not receipt_path.is_file():
        raise ValueError('No successful scoped asset receipt')
    receipt = json.loads(receipt_path.read_text())
    for item in receipt['files']:
        if sha(output / item['path']) != item['sha256']:
            raise ValueError(f'Output hash differs: {item["path"]}')
    result = {'scope': scope, 'receiptSha256': sha(receipt_path), 'files': len(receipt['files']),
              'bytes': sum(item['bytes'] for item in receipt['files']), 'result': receipt['result'],
              'config': receipt['config']}
    if scope == 'all':
        wam = json.loads((output / 'maps/konclui-office/office.wam').read_text())
        source = ast.parse((ROOT / 'assets/konclui/source/hq-office/build.py').read_text())
        namespace = next(ast.literal_eval(node.value) for node in source.body if isinstance(node, ast.Assign)
                         and any(isinstance(target, ast.Name) and target.id == 'NS' for target in node.targets))
        if receipt['config']['whiteboardNamespace'] == namespace:
            raise ValueError('Candidate reused production whiteboard namespace')
        plan = ast.parse((ROOT / 'assets/konclui/source/hq-office/plan.py').read_text())
        boards = next(ast.literal_eval(node.value) for node in plan.body if isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == 'WHITEBOARDS' for target in node.targets))
        for key in boards:
            entity_id = str(uuid.uuid5(uuid.NAMESPACE_URL, namespace + key))
            properties = wam['entities'][entity_id]['properties']
            actual = next(prop['link'] for prop in properties if prop.get('application') == 'excalidraw')
            digest = hashlib.sha256((receipt['config']['whiteboardNamespace'] + key).encode()).digest()
            expected = f'https://excalidraw.com/#room={digest[:10].hex()},{base64.urlsafe_b64encode(digest[10:26]).decode().rstrip("=")}'
            if actual != expected:
                raise ValueError(f'Whiteboard link is not isolated: {key}')
        result['verifiedIsolatedWhiteboards'] = len(boards)
        result['whiteboardProperties'] = sum(prop.get('application') == 'excalidraw'
                                            for entity in wam['entities'].values() for prop in entity.get('properties', []))
    (ROOT / 'out/asset-summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    action = sys.argv[1]
    if action == 'inputs': verify_inputs()
    elif action == 'versions': sys.exit(0 if versions() else 1)
    elif action == 'whiteboards': whiteboards()
    elif action == 'outputs': outputs()
    else: raise ValueError(f'Unknown action: {action}')
