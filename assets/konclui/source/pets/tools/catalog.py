"""Export the upstream companion list plus generated pet families using explicit input/output paths.
Stable IDs are pet-<species>-<colour>; runtime atlases and pickers share the species manifest.
"""
import argparse
import json
import sys
from pathlib import Path

BASE_URL = 'resources/konclui-pets'  # local-wa/docker-compose.yml mounts pets/out there
FAMILIES = [('koru', 'Koru'), ('brasil', 'Brasil'), ('sede', 'Sede'), ('fantasia', 'Fantasia'),
            ('halloween', 'Halloween'), ('time', 'Pets do time')]


def manifests(output_root):
    for path in sorted(Path(output_root).glob('*/*.json')):
        if path.stem == path.parent.name:
            yield json.loads(path.read_text())


def pet_collections(output_root):
    """One collection per pet family, in FAMILIES order; production adds them to its list too (avatars/sections.py)."""
    by_family = {key: [] for key, _ in FAMILIES}
    for m in manifests(output_root):
        for v in m['variants']:
            by_family.setdefault(m['family'], []).append({
                'id': f'pet-{m["species"]}-{v["id"]}',
                'name': m['name'] if len(m['variants']) == 1 else f'{m["name"]} · {v["name"]}',
                'url': f'{BASE_URL}/{m["species"]}/{v["picker"]}',
            })
    return [{'name': label, 'position': 0, 'textures': by_family[key]} for key, label in FAMILIES if by_family[key]]


def catalogue(upstream, output_root):
    collections = json.loads(Path(upstream).read_text()) + pet_collections(output_root)
    for i, c in enumerate(collections):
        c['position'] = i
    return collections


def main():
    parser = argparse.ArgumentParser(description='Export native companion catalogue from explicit inputs')
    parser.add_argument('--upstream', required=True)
    parser.add_argument('--pets', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = Path(args.out)
    text = json.dumps(catalogue(args.upstream, args.pets), ensure_ascii=False, indent=1) + '\n'
    if args.check:
        same = target.exists() and target.read_text() == text
        print('companions.json up to date' if same else 'companions.json differs')
        return 0 if same else 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')
    print(f'{target}: {sum(len(c["textures"]) for c in json.loads(text))} companions')
    return 0


if __name__ == '__main__':
    sys.exit(main())
