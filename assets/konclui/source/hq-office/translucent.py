"""The office's DECLARED translucent layers: the only pictures allowed partial alpha, each with its reason, and how many of
them really carry it (asserted by `sheetcheck.py`: a new translucent sprite, or one that stopped being translucent,
fails the check until this file says so on purpose).

Everything else is binary alpha (0 or 255): `build.py` runs `tools/pixelgrid.py binary_alpha` on every entity picture
it writes, and the check fails any other partial alpha. Decided on evidence, per case (tools/README.md has the numbers):

  * baked contact shadows, plates and 1 px halos of a piece the runtime DOES shadow (a footprint in the manifest's
    `shadows`: 61 placed pieces, MEASURED): NOT declared. The runtime draws its own soft shadow from the footprint
    (fx.py `shadows`), so the plate is dropped by the pipeline. TRADE-OFF: that runtime shadow exists only while
    `features.shadows` is on and the room has an fx manifest. With the `lean` preset (effectSwitches.ts: `lean: []`),
    with `konclui.fx.off` (qa.py uses it) and in a room with no fx manifest nothing replaces the plate, so those 61
    pieces have no shadow there. To keep a baked plate for them too, declare them (names in `baked-shadow`, its count,
    its levels): the owner's call, the default is binary alpha wherever the runtime can shadow.
  * the same baked shadow on a piece the runtime draws NO shadow for (fx.py FLAT: a wall frame, a TV, a lounge piece whose
    shadow lounge.py paints in its picture; 30 placed prefabs, MEASURED): declared, layer `baked-shadow`. Dropped, the
    piece would have no shadow at all. `lost_only_shadow` makes the build fail when a placed FLAT piece that is not
    declared loses a shadow to the repair, so a new one cannot be dropped silently.
  * glass: a pane the player must see through. Opaque, it is a wall of colour. Declared.
  * a lamp's baked pool of light: the picture's own soft glow. The lamp's dynamic light (fx.py LIGHT_NAMES) is separate
    and unmeasured against it in a browser, so the baked glow stays until a real run shows it doubles the light. Declared.
  * the tilesets of the walls and doors (glass tint, painted reflections) and the light overlay (an alpha gradient by
    definition): fx.py `glass_mask` reads the glass alpha levels by value. Declared, with the exact levels they may use.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import pixelgrid as PG  # noqa: E402

# Entity layers: layer -> (reason, prefab names). A name is the editor's name of the prefab (collection.json).
ENTITY_LAYERS = {
    'glass': ('a pane the player sees through (desk top, record-player lid, window pane, glass door)',
              ('Mesa em meia-lua', 'Vitrola mid-century', 'Interior clássico 65',
               'Janela guilhotina', 'Janela guilhotina aberta', 'Janela pequena de batente')),
    'lamp-light-pool': ("the lamp's own baked pool of light under its shade",
                        ('Luminária de arco com cúpula', 'Luminária de mesa com cúpula clara',
                         'Luminária de mesa com cúpula clara (sobre móvel)', 'Criado-mudo de nogueira')),
    'baked-shadow': (
        "the picture's own contact or drop shadow on a piece the runtime draws no footprint shadow for (fx.py FLAT)",
        ('Aparador baixo de teca com livros e plantas', 'Ave-do-paraíso grande', 'Balcão de bar de teca com cafeteira',
         'Banqueta de bar turquesa', 'Banquinho com samambaia', 'Costela-de-adão grande', 'Mesa com Lig 4',
         'Mesa de air hockey', 'Mesinha redonda de nogueira com caneca', 'Par de pufes', 'Pebolim do salão de jogos',
         'Quadro: Koncluí', 'Quadro: Koru acenando', 'Quadro: Koru apresentando', 'Quadro: Koru com o checklist',
         'Quadro: Koru comemorando', 'Quadro: Koru no café', 'Quadro: Koru no notebook', 'Quadro: a cozinha',
         'Quadro: a equipe', 'Quadro: a gestora e o checklist', 'Quadro: o K da Koncluí', 'Quadro: o K em menta',
         'Quadro: o café', 'Quadro: o prato', 'Quadro: o restaurante', 'Quadro: o salão',
         'Sofá de três lugares ardósia com almofadas', 'Suporte de tacos e alvo de dardos', 'TV de parede')),
}

# The partial levels a declared entity layer may use, None for any (the lamp's glow is a gradient). MEASURED over the build.
ENTITY_LEVELS = {
    'glass': {51, 128, 179, 192, 204, 230},
    'baked-shadow': {22, 26, 28, 30, 40, 44, 48, 50, 56, 70, 100, 128, 130, 166},
}

# The count asserted by the check: how many pictures of each layer carry partial alpha (MEASURED, tools/README.md).
# Enforced by build.py (check_dist), by BuiltOffice over $KONCLUI_DIST and by DeclaredBudget (tools/test_pixelgrid.py),
# NOT by the mocked DeclaredLayers tests: change a number here and DeclaredBudget says so until it is changed on purpose.
EXPECTED_ENTITY_FILES = {'glass': 77, 'lamp-light-pool': 4, 'baked-shadow': 32}

# Tileset layers: file name -> (layer, the only partial levels it may use, None for any).
TILESET_LAYERS = {
    'Konclui_Walls.png': ('tileset-glass-walls', {34, 40, 52, 64, 70, 170, 200, 210, 230, 235}),
    'Konclui_Doors.png': ('tileset-glass-doors', {74, 210, 220, 235}),
    'Konclui_Light.png': ('tileset-light-overlay', None),
}
EXPECTED_TILESET_FILES = {'tileset-glass-walls': 1, 'tileset-glass-doors': 1, 'tileset-light-overlay': 1}

_BY_NAME = {name: layer for layer, (_, names) in ENTITY_LAYERS.items() for name in names}


def layer_of(name):
    """The declared entity layer of a prefab name, or None."""
    return _BY_NAME.get(name)


# prefab name -> the partial-alpha px `snapped` dropped from its picture in this process (the repair's own ledger).
DROPPED = {}


def snapped(name, image):
    """The picture the build writes for the prefab `name`: a declared translucent one as it is, any other with binary
    alpha (`PG.binary_alpha`). Returns `image` itself when nothing changes. Records what it drops in DROPPED."""
    import numpy as np
    from PIL import Image
    if layer_of(name):
        return image
    pixels = np.asarray(image.convert('RGBA'))
    fixed = PG.binary_alpha(pixels)
    if fixed is pixels:
        return image
    partial = (pixels[..., 3] > 0) & (pixels[..., 3] < 255)
    DROPPED[name] = int((partial & (fixed[..., 3] == 0)).sum())
    return Image.fromarray(fixed, 'RGBA')


def lost_only_shadow(dist):
    """[(prefab name, px)] of the PLACED pieces the runtime draws no footprint shadow for (the manifest's `shadows` is
    None: fx.py FLAT) that the repair dropped partial alpha from (a declared piece is never repaired, so it is never in
    DROPPED): their baked shadow was the only one, and it is gone. Read after fx.py wrote the manifest, in the process
    that built the pictures."""
    import json
    import fx
    shadows = json.loads((Path(dist) / 'fx' / 'manifest.json').read_text())['shadows']
    lost = {entry['name']: DROPPED[entry['name']] for key, entry in fx.placed_sprites(Path(dist)).items()
            if key in shadows and shadows[key] is None and DROPPED.get(entry['name'])}
    return sorted(lost.items())


def declared_entity(dist):
    """`declared_for(path)` over a build's entities/ and seats/front/: the declared layer (and its levels) of the first
    declared prefab that uses the picture. A seat front is the same prefab's picture, so it follows the prefab's name."""
    import json
    by_path = {}
    for collection in sorted((Path(dist) / 'entities').glob('*/collection.json')):
        for entry in json.loads(collection.read_text()).get('collection', []):
            layer = layer_of(entry.get('name'))
            if layer and entry.get('imagePath'):
                by_path[(collection.parent / entry['imagePath']).resolve()] = layer
                by_path[(Path(dist) / 'seats' / 'front' / f"{entry['id']}.png").resolve()] = layer
    return lambda path: (PG.Declared(by_path[Path(path).resolve()], ENTITY_LEVELS.get(by_path[Path(path).resolve()]))
                         if Path(path).resolve() in by_path else None)


def declared_tileset(path):
    entry = TILESET_LAYERS.get(Path(path).name)
    return PG.Declared(*entry) if entry else None
