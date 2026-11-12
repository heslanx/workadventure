#!/usr/bin/env python3
"""Build selected Konclui sources without the legacy checkout, gateway or services."""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/konclui/source'
DEFAULT_OUTPUT = ROOT / '.local/konclui/asset-build'
MARKER = '.konclui-asset-build'
WHITEBOARD_NAMESPACE = 'konclui-native-local/konclui-office/'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_map(output):
    subprocess.run([
        sys.executable, '-B', str(SOURCE / 'hq-office/build.py'),
        '--out', str(output / 'maps/konclui-office'),
        '--renders', str(output / 'review/map'),
        '--whiteboard-namespace', WHITEBOARD_NAMESPACE,
    ], check=True, cwd=ROOT, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    return json.loads((output / 'review/map/build.json').read_text())


def build_characters(output):
    resources = output / 'resources'
    catalogues = output / 'catalogues'
    pets = resources / 'konclui-pets'
    petkit = load_module('petkit', SOURCE / 'pets/tools/petkit.py')
    species = sorted((SOURCE / 'pets/species').glob('*/species.json'))
    if not species:
        raise ValueError('No selected pet species')
    for spec in species:
        if petkit.build(spec.parent, pets):
            raise ValueError(f'Pet atlas validation failed: {spec.parent.name}')
    exporter = load_module('native_export', SOURCE / 'avatars/native_export.py')
    _, woka, _, added = exporter.build(ROOT / 'play/src/pusher/data/woka.json', resources, catalogues)
    for source, relative in (
        ('theme/fonts/urbanist-latin.woff2', 'konclui/fonts/urbanist-latin.woff2'),
        ('theme/fonts/OFL.txt', 'konclui/fonts/OFL.txt'),
        ('theme/avatars/logo.svg', 'konclui/logo.svg'),
    ):
        destination = resources / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SOURCE / source, destination)
    sections = exporter.sections
    contract = sections.load()
    upstream = json.loads((ROOT / 'play/src/pusher/data/companions.json').read_text())
    items = [(texture, None) for collection in upstream for texture in collection['textures']]
    for piece in contract['legacyPieces']:
        if piece['part'] != 'companion':
            continue
        relative = Path('konclui/companion') / f'{piece["id"]}.png'
        destination = resources / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SOURCE / piece['file'], destination)
        items.append((sections.legacy_texture(piece, f'resources/{relative.as_posix()}'), None))
    companions = sections.collections(contract, 'companion', items, strict=True, positions=False)
    companions += sections.pet_collections(pets)
    companions = [{**collection, 'position': i} for i, collection in enumerate(companions)]
    (catalogues / 'companions.json').write_text(sections.render(companions))

    from PIL import Image
    textures = [texture for part in woka.values() for collection in part['collections']
                for texture in collection['textures']]
    textures += [texture for collection in companions for texture in collection['textures']]
    ids = [texture['id'] for texture in textures]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate avatar/companion identifiers')
    exported = 0
    for texture in textures:
        if not texture['url'].startswith('resources/konclui'):
            continue
        with Image.open(output / texture['url']) as image:
            if image.size != (96, 128):
                raise ValueError(f'Invalid native picker size: {texture["id"]}: {image.size}')
            image.load()
        exported += 1
    forbidden = [path for path in resources.rglob('*') if path.suffix in {'.js', '.html'}]
    if forbidden:
        raise ValueError(f'Character exporter produced executable page content: {forbidden}')
    return {'petSpecies': len(species), 'addedAvatarLayers': added, 'verifiedCustomPickers': exported,
            'companions': sum(len(collection['textures']) for collection in companions)}


def write_receipt(output, scope, result):
    inventory = []
    folders = {'map': ('maps',), 'characters': ('resources', 'catalogues'),
               'all': ('maps', 'resources', 'catalogues')}[scope]
    for folder in folders:
        for path in sorted((output / folder).rglob('*')):
            if path.is_file():
                data = path.read_bytes()
                inventory.append({'path': path.relative_to(output).as_posix(), 'bytes': len(data),
                                  'sha256': hashlib.sha256(data).hexdigest()})
    inputs = [ROOT / 'assets/konclui/provenance.json',
              ROOT / 'play/src/pusher/data/woka.json', ROOT / 'play/src/pusher/data/companions.json',
              Path(__file__).resolve()]
    inputs += [SOURCE / relative for relative in (
        'hq-office/build.py', 'hq-office/signature.py', 'hq-office/pool.py',
        'avatars/native_export.py', 'avatars/sections.py', 'pets/tools/petkit.py', 'pets/tools/catalog.py',
    )]
    receipt = {'scope': scope, 'result': result, 'config': {'whiteboardNamespace': WHITEBOARD_NAMESPACE},
               'inputs': {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in inputs}, 'files': inventory}
    (output / f'{scope}-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'scope': scope, 'result': result, 'files': len(inventory),
                      'bytes': sum(item['bytes'] for item in inventory)}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=('all', 'map', 'characters'), default='all')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.out.resolve()
    if output.exists() and any(output.iterdir()) and not (output / MARKER).is_file():
        parser.error(f'Refusing an unowned nonempty output directory: {output}')
    output.mkdir(parents=True, exist_ok=True)
    (output / MARKER).write_text('Generated by tools/build-konclui-assets.py\n')
    result = {}
    if args.only in ('all', 'map'):
        result['map'] = build_map(output)
    if args.only in ('all', 'characters'):
        result['characters'] = build_characters(output)
    write_receipt(output, args.only, result)


if __name__ == '__main__':
    main()
