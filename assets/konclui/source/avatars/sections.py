"""Avatar customization sections: the contract (avatars/sections.json) and the lists derived from it.

The contract says, per part, which sections a player sees, in what order, under which pt-BR name, and which
textures each section holds (sections.schema.json describes the shape). Every list the engine serves derives from it:
  - the local customizer list (avatars/native_export.py -> local-wa/woka/woka.json);
  - the production lists (this script -> admin-api/woka.json and admin-api/companions.json).

The engine (v1.34.x) shows sections in list order, and two of its behaviours read only the first one
([code] play/src/front/Components/Woka/WokaCustomizeScene.svelte): a visitor with no saved avatar starts with the
first texture of each part's first section, and "Randomizar" draws from the first section alone.

python3 avatars/sections.py          writes admin-api/woka.json and admin-api/companions.json
python3 avatars/sections.py --check  exits 1 when either differs from what the contract derives (writes nothing)
Stdlib only, no network.
"""
import argparse
import fnmatch
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'pets/tools'))
from catalog import pet_collections  # noqa: E402

CONTRACT = ROOT / 'avatars/sections.json'
PARTS = ('woka', 'body', 'eyes', 'hair', 'clothes', 'hat', 'accessory')   # wokaPartNames, the engine's order
CUSTOMIZER = PARTS[1:]                                                  # the tabs of "Customizar seu personagem"


def load(path=CONTRACT):
    contract = json.loads(Path(path).read_text(encoding='utf-8'))
    validate(contract)
    return contract


def validate(contract):
    """The rules sections.schema.json cannot express on its own (tests/test_avatar_sections.py runs the schema)."""
    reserved = set(contract['reservedNames'])
    for part, spec in contract['parts'].items():
        sections = spec['sections']
        for key in ('id', 'name'):
            values = [s[key] for s in sections]
            if len(set(values)) != len(values):
                raise ValueError(f'{part}: repeated section {key}')
        for section in sections:
            if section['name'] in reserved:
                raise ValueError(f"{part}: '{section['name']}' is reserved")
            if section.get('empty') and (len(section['members']) != 1 or not isinstance(section['members'][0], str)
                                         or '*' in section['members'][0]):
                raise ValueError(f"{part}/{section['id']}: an empty section names exactly one texture")
        if part == 'accessory' and any('group' not in s for s in sections if not s.get('empty')):
            raise ValueError('accessory: every section but the empty one needs a group')
    ids = [piece['id'] for piece in contract['legacyPieces']]
    if len(set(ids)) != len(ids):
        raise ValueError('repeated legacy piece')


def matches(member, texture_id, collection):
    if isinstance(member, str):
        return fnmatch.fnmatchcase(texture_id, member)
    return collection is not None and collection == member['collection']


def organize(contract, part, items, strict=False):
    """[(section, [texture, ...])] in display order, for the sections that hold something.

    items: [(texture, collection)] in source order; collection is the catalog option's, None for the rest.
    Raises unless every texture matches exactly one member; with strict (the list is the whole inventory of the
    part), also when a member matches nothing.
    """
    sections = contract['parts'][part]['sections']
    owner = {}
    for s, section in enumerate(sections):
        for m, member in enumerate(section['members']):
            hits = [(pos, texture) for pos, (texture, collection) in enumerate(items)
                    if matches(member, texture['id'], collection)]
            if strict and not hits:
                raise ValueError(f"{part}/{section['id']}: {member} matches no texture")
            for pos, texture in hits:
                if texture['id'] in owner:
                    first = sections[owner[texture['id']][0]]['id']
                    raise ValueError(f"{part}: {texture['id']} is in {first} and {section['id']}")
                owner[texture['id']] = (s, m, pos)
    missing = [texture['id'] for texture, _ in items if texture['id'] not in owner]
    if missing:
        raise ValueError(f'{part}: no section for {missing}')
    result = []
    for s, section in enumerate(sections):
        held = sorted(((owner[t['id']][1:], t) for t, _ in items if owner[t['id']][0] == s), key=lambda e: e[0])
        if held:
            result.append((section, [texture for _, texture in held]))
    return result


def collections(contract, part, items, strict=False, positions=True):
    """organize() as the engine's collections: [{name, position, textures}], textures numbered per section."""
    out = []
    for index, (section, textures) in enumerate(organize(contract, part, items, strict)):
        clean = [{k: v for k, v in t.items() if k != 'position'} for t in textures]
        if positions:
            clean = [{**t, 'position': i} for i, t in enumerate(clean)]
        out.append({'name': section['name'], 'position': index, 'textures': clean})
    return out


def woka_list(contract, base, items, strict=False):
    """A whole woka list: the engine's part attributes (required, ...) kept, collections from the contract."""
    return {part: {key: (collections(contract, part, items[part], strict) if key == 'collections' else value)
                   for key, value in base[part].items()} for part in PARTS}


def engine_items(base):
    """{part: [(texture, None)]} of an engine woka list, in its order."""
    return {part: [(t, None) for c in base[part]['collections'] for t in c['textures']] for part in PARTS}


def legacy_texture(piece, url=None):
    return {'id': piece['id'], 'name': piece['name'], 'url': url or piece['url']}


def labels(contract):
    """Tab label and heading of each customizer part, for local-wa/accessories.js."""
    return {part: {'tab': contract['parts'][part]['label'], 'heading': contract['parts'][part]['heading']}
            for part in CUSTOMIZER}


def production_lists(contract, upstream_woka, upstream_companions, pet_output):
    """admin-api/woka.json and admin-api/companions.json: the engine's lists plus the legacy pieces."""
    base = json.loads(Path(upstream_woka).read_text(encoding='utf-8'))
    companions = json.loads(Path(upstream_companions).read_text(encoding='utf-8'))
    items = engine_items(base)
    pets = [(t, None) for c in companions for t in c['textures']]
    for piece in contract['legacyPieces']:
        (pets if piece['part'] == 'companion' else items[piece['part']]).append((legacy_texture(piece), None))
    # The office's own pets (pets/out) follow the contract's sections, as in the local list; their art is served at
    # /resources/konclui-pets/ (pets/tools/upload_pets.py).
    companion_list = collections(contract, 'companion', pets, strict=True, positions=False) + pet_collections(pet_output)
    return (woka_list(contract, base, items),
            [{**c, 'position': i} for i, c in enumerate(companion_list)])


def render(data):
    return json.dumps(data, ensure_ascii=False, indent=1) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--check', action='store_true', help='compare instead of writing')
    parser.add_argument('--woka', required=True)
    parser.add_argument('--companions', required=True)
    parser.add_argument('--pets', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    woka, companions = production_lists(load(), args.woka, args.companions, args.pets)
    drift = []
    for path, data in ((output / 'woka.json', woka), (output / 'companions.json', companions)):
        text = render(data)
        if args.check:
            if not path.exists() or path.read_text(encoding='utf-8') != text:
                drift.append(str(path))
        else:
            path.write_text(text, encoding='utf-8')
    summary = {part: [c['name'] for c in woka[part]['collections']] for part in PARTS}
    summary['companion'] = [c['name'] for c in companions]
    print(json.dumps({'sections': summary, 'drift': drift}, ensure_ascii=False, indent=1))
    return 1 if drift else 0


if __name__ == '__main__':
    sys.exit(main())
