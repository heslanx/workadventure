"""Export the v3 avatar catalog as layers for WorkAdventure's own customizer (local office).

The native customizer (v1.34.x) stacks one 96x128 sheet per part, always in the order body, eyes, hair,
clothes, hat, accessory, and resolves texture ids across every part, so ids must be unique
([code] play/src/front/Components/Woka/WokaCustomizeScene.svelte, play/src/pusher/services/LocalWokaService.ts).
It has no colour picker and one texture per part. So each catalog option becomes one sheet in its authored
colour; skin, eyes, hair and beard are repeated in the catalog's curated colours. Slots the engine lacks
ride in `accessory` (beard, glasses, headset, handhelds, gloves, aura, cape).

Sections come from the contract (avatars/sections.json, read by avatars/sections.py), the same one production's
lists derive from: the engine's textures (untouched) and ours share sections by kind, and costumes keep their
universe's name in every tab. The "nothing" of hair, hat and accessory is the engine's own empty texture.

Accessory sections follow the catalog's draw order, each with an exclusivity group. The native customizer
consumer must enforce one piece per group: the engine draws any number of layers, and its server returns them by
collection order ([code] LocalWokaService#fetchWokaDetails), so collection order is the draw order for everyone.

Draw passes the engine cannot reproduce, characterized in the reference exporter parity report:
  - a back plane (capes, balloon, wooden staff) is kept only where the body never covers it, since the
    engine cannot draw anything behind the body;
  - clothes always cover hair, as they do for the engine's own long hairs: long hair loses its back locks
    under any outfit, and accessories (capes, backpacks) sit over the hair instead of under it;
  - hats cannot clip hair (`hairClip`), and the headset band is the one fitted to the default hair.

python3 avatars/native_export.py --base <upstream woka.json> --out <resources> --catalogues <catalogues>
Exports PNG layers, woka.json and accessories.json only. Native Svelte owns the UI.
The historical renderer comparison requires the legacy compositor and is not a standalone build gate.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'avatars'))
import sections  # noqa: E402  (avatars/sections.py, the section contract)

CATALOG = ROOT / 'avatars/catalog.json'
URL = 'resources/konclui'
W, H = 96, 128

PART = {'body': 'body', 'eyes': 'eyes', 'hair': 'hair', 'outfit': 'clothes', 'hat': 'hat',
        'beard': 'accessory', 'glasses': 'accessory', 'headset': 'accessory', 'handheld': 'accessory',
        'gloves': 'accessory', 'aura': 'accessory', 'cape': 'accessory'}
NATIVE_ORDER = ('body', 'eyes', 'hair', 'clothes', 'hat', 'accessory')
CURATED = ('body', 'eyes', 'hair', 'beard')         # natural colours: one sheet per curated swatch
HEADSET_HAIR = 'short'                              # the catalog's default hair (defaults.parts.hair)


def raster(option, color):
    """One palette/RLE image (catalog contract, design/avatars/backend-contract.md) as a 128x96x4 array."""
    rgb = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    palette = np.array([[(c * shade + 127) // 255 for c in rgb] + [a] if shade is not None else [r, g, b, a]
                        for r, g, b, a, shade in option['palette']], dtype=np.uint8)
    pixels = option['pixels']
    index = np.repeat(np.array(pixels[::2]), np.array(pixels[1::2]))
    return palette[index].reshape(H, W, 4)


def over(dst, src):
    """The catalog's hard-alpha composite: opaque source pixels replace, transparent ones do nothing."""
    mask = src[..., 3] > 0
    dst[mask] = src[mask]
    return dst


def body_cover(catalog):
    """Pixels some body option covers, in any frame: a back plane drawn there would sit in front of the body."""
    bodies = next(c for c in catalog['categories'] if c['id'] == 'body')['options']
    return np.any([raster(o, '#808080')[..., 3] > 0 for o in bodies], axis=0)


def layer(slot, option, color, cover):
    """The option as one native sheet: back plane (outside the body), main image, then any front planes."""
    sheet = np.zeros((H, W, 4), np.uint8)
    planes = option.get('planes', {})
    if 'back' in planes:
        back = raster(planes['back'], color)
        back[cover] = 0
        over(sheet, back)
    if 'band' in planes:                            # headset: the band fitted to the default hair, then the hardware
        band = planes['band']
        over(sheet, raster(band.get('variants', {}).get(HEADSET_HAIR, band), color))
    over(sheet, raster(option, color))
    return sheet


def variants(catalog):
    """(slot, option, colour, texture id, name) for every native texture we add; 'none' options add nothing,
    the engine's own empty textures are the "nothing" (avatars/sections.json)."""
    defaults = catalog['defaults']['colors']
    for category in catalog['categories']:
        slot = category['id']
        swatches = [c['value'] for c in catalog['colors'][slot]]
        for option in category['options']:
            if option['id'] == 'none':
                continue
            if slot in CURATED and 'collection' not in option:     # themed pieces keep their character's colour
                colours = swatches
            else:
                colours = [option.get('defaultColor') or defaults[slot]]
            for colour in colours:
                suffix = f'-{colour[1:].lower()}' if len(colours) > 1 else ''
                label = f"{option['label']} ({colour})" if len(colours) > 1 else option['label']
                yield slot, option, colour, f"kc-{slot}-{option['id']}{suffix}", label


def build(base_path, output_dir, catalogue_dir):
    out = Path(output_dir)
    catalogue_dir = Path(catalogue_dir)
    catalogue_dir.mkdir(parents=True, exist_ok=True)
    contract = sections.load()
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    base = json.loads(Path(base_path).read_text(encoding='utf-8'))
    cover = body_cover(catalog)
    generated = out / 'konclui'
    marker = generated / '.native-avatar-export'
    if generated.is_symlink() or (generated.exists() and any(generated.iterdir()) and not marker.is_file()):
        raise ValueError(f'Refusing an unowned avatar output directory: {generated}')
    generated.mkdir(parents=True, exist_ok=True)
    marker.write_text('Generated avatar resources; safe to rebuild\n')
    for child in generated.iterdir():
        if child == marker:
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    for part in NATIVE_ORDER:
        (out / 'konclui' / part).mkdir()

    items = sections.engine_items(base)             # part -> [(texture, collection)]: the engine's, then ours
    added = {part: 0 for part in sections.PARTS}

    def add(part, tid, name, sheet, collection=None):
        Image.fromarray(sheet, 'RGBA').save(out / 'konclui' / part / f'{tid}.png', optimize=True)
        items[part].append(({'id': tid, 'name': name, 'url': f'{URL}/{part}/{tid}.png'}, collection))
        added[part] += 1

    for slot, option, colour, tid, name in variants(catalog):
        add(PART[slot], tid, name, layer(slot, option, colour, cover), option.get('collection'))
    for piece in contract['legacyPieces']:
        if piece['part'] in NATIVE_ORDER:           # the companion list is the engine's own here
            sheet = np.array(Image.open(ROOT / piece['file']).convert('RGBA'))
            assert sheet.shape == (H, W, 4), piece['id']
            add(piece['part'], piece['id'], piece['name'], sheet)

    ids = [texture['id'] for part in items.values() for texture, _ in part]
    assert len(set(ids)) == len(ids), 'texture ids must be unique across parts'
    merged = sections.woka_list(contract, base, items, strict=True)
    (catalogue_dir / 'woka.json').write_text(json.dumps(merged, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    write_multi_accessory(contract, merged, out)
    return catalog, merged, cover, added


def write_multi_accessory(contract, merged, out):
    """Export ordered exclusivity groups and labels for the native customizer."""
    spec = {s['name']: s for s in contract['parts']['accessory']['sections']}
    pieces, none = [], None
    for collection in merged['accessory']['collections']:
        for texture in collection['textures']:
            url = '/' + texture['url'].lstrip('/')
            if spec[collection['name']].get('empty'):
                none = {'id': texture['id'], 'url': url}
            else:
                pieces.append({'id': texture['id'], 'group': spec[collection['name']]['group'], 'url': url})
    data = {'none': none['id'], 'noneUrl': none['url'], 'pieces': pieces, 'labels': sections.labels(contract)}
    (out / 'konclui/accessories.json').write_text(json.dumps(data, ensure_ascii=False) + '\n', encoding='utf-8')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True, help='target upstream play/src/pusher/data/woka.json')
    parser.add_argument('--out', required=True, help='generated resources directory')
    parser.add_argument('--catalogues', required=True, help='generated catalogue directory')
    args = parser.parse_args()
    catalog, merged, cover, added = build(args.base, args.out, args.catalogues)
    result = {'added': {p: added[p] for p in NATIVE_ORDER},
              'total': {p: sum(len(c['textures']) for c in merged[p]['collections']) for p in sections.PARTS},
              'collections': {p: [c['name'] for c in merged[p]['collections']] for p in sections.PARTS}}
    print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
