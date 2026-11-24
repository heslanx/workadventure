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
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import pixelgrid as PG  # noqa: E402

# Entity layers: layer -> (reason, prefab names). A name is the editor's name of the prefab (collection.json).
_DECLARED_LAYERS = {
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

# The pieces whose picture lounge.py paints a contact shadow into with `shade_row` (MEASURED: the pictures of
# `lounge.pieces()` built with and without it differ for exactly these declared names, and test_fx_kinds.py asserts it).
# KONCLUI_PAINTED_SHADOWS=0 builds them without the rows, so they stop carrying partial alpha and stop being declared: the
# lighting plan's last slice, taken when the runtime draws every object's own shadow. Declared names the rows do not explain
# (the frames and the TV, the catalogue's own foosball and Lig 4 table) keep their picture's shadow either way.
LOUNGE_ROW_SHADOWS = ('Aparador baixo de teca com livros e plantas', 'Ave-do-paraíso grande', 'Balcão de bar de teca com cafeteira',
                      'Banqueta de bar turquesa', 'Banquinho com samambaia', 'Costela-de-adão grande',
                      'Mesinha redonda de nogueira com caneca', 'Mesa de air hockey', 'Par de pufes',
                      'Sofá de três lugares ardósia com almofadas', 'Suporte de tacos e alvo de dardos')
# Pictures of those names that carry partial alpha in the default build: the baked-shadow count they take with them.
LOUNGE_ROW_SHADOW_FILES = 13
BASE_ENTITY_FILES = {'glass': 77, 'lamp-light-pool': 4, 'baked-shadow': 32}


def painted_shadows(environ=os.environ):
    """True (the default) while the lounge pieces keep their painted contact shadow; KONCLUI_PAINTED_SHADOWS=0 is False.
    The same switch as `lounge.painted_shadows`."""
    return environ.get('KONCLUI_PAINTED_SHADOWS', '1') != '0'


# The volume pieces (KONCLUI_VOLUME_PIECES, a comma list; empty by default, and then the build is byte for byte what it was). A
# switch name replaces or touches up one piece; "all" is every name whose piece reads better lit than today's (air-hockey and
# arc-lamp-proxy). The stool (the art review judged it worse in charm) and plant-proxy (lit, the tall bird of paradise's white pot
# turns into a flat grey bucket) have not passed: they are taken only by name. Each name lists what its pictures STOP carrying: the layer whose partial alpha goes (a painted contact shadow,
# a baked pool of light), the prefab names and how many pictures, so the file counts follow. A piece BAKED from a recipe is new art:
# its name leaves the declaration and its picture is judged by the palette and the drawing contract like any other. A piece whose
# hand-drawn picture is KEPT (VOLUME_LEGACY: a touch-up and a proxy volume) keeps its name declared, so it keeps its standing
# (the palette check leaves it out as it always did); only fx.py's "painted" list and the runtime's shadow stop treating it as
# painted (VOLUME_UNPAINTED).
VOLUME_ENV = 'KONCLUI_VOLUME_PIECES'
# "casters-all" changes no picture and no declaration: it only adds the legacy pieces' shadow heights (contract/pieces.json) to the
# manifest's "casters", so the owner can judge them alone. Without it "casters" holds only the pieces the other names replace or touch.
VOLUME_CASTERS_ALL = 'casters-all'
VOLUME_NAMES = ('air-hockey', 'stool', 'arc-lamp-proxy', 'plant-proxy', VOLUME_CASTERS_ALL)
VOLUME_ALL = ('air-hockey', 'arc-lamp-proxy')
VOLUME_LEGACY = ('arc-lamp-proxy', 'plant-proxy')
VOLUME_DROPS = {
    'air-hockey': {'baked-shadow': (('Mesa de air hockey',), 1)},
    'stool': {'baked-shadow': (('Banqueta de bar turquesa',), 1)},
    'arc-lamp-proxy': {'lamp-light-pool': (('Luminária de arco com cúpula',), 1)},
    'plant-proxy': {'baked-shadow': (('Ave-do-paraíso grande',), 2)},
}
# Prefab names whose picture paints no shadow of its own once the switch name is on: fx.py stops treating them as FLAT, so the
# runtime draws their footprint shadow (the lamp's name matches FLAT through "cúpula", the others through their own pattern).
VOLUME_UNPAINTED = {
    'air-hockey': ('Mesa de air hockey',), 'stool': ('Banqueta de bar turquesa',),
    'arc-lamp-proxy': ('Luminária de arco com cúpula',), 'plant-proxy': ('Ave-do-paraíso grande',),
}


def volume_pieces(environ=os.environ):
    """The set of switch names KONCLUI_VOLUME_PIECES asks for: a comma list of VOLUME_NAMES and "all" (VOLUME_ALL), case and
    spaces ignored, empty (the default) for none. An unknown name is a ValueError: a typo must not build the default silently."""
    chosen = set()
    for token in str(environ.get(VOLUME_ENV, '')).split(','):
        token = token.strip().lower()
        if not token:
            continue
        if token == 'all':
            chosen |= set(VOLUME_ALL)
        elif token in VOLUME_NAMES:
            chosen.add(token)
        else:
            raise ValueError(f'{VOLUME_ENV}: unknown piece {token!r}; one of {", ".join(VOLUME_NAMES)} or all')
    return frozenset(chosen)


def volume_value(volume):
    """The switch as the build records it (fx/manifest.json "volume"): the chosen names in VOLUME_NAMES order, comma separated."""
    return ','.join(n for n in VOLUME_NAMES if n in volume)


def entity_layers(painted=True, volume=frozenset()):
    """ENTITY_LAYERS for a build that keeps (`painted`) or drops the lounge's painted shadow rows, and whose baked `volume` pieces
    (not VOLUME_LEGACY ones) no longer carry the partial alpha their names were declared for."""
    drop = {layer: {n for name in volume if name not in VOLUME_LEGACY for n in VOLUME_DROPS.get(name, {}).get(layer, ((), 0))[0]}
            for layer in _DECLARED_LAYERS}
    return {layer: (why, tuple(n for n in names if n not in drop[layer]
                               and (painted or layer != 'baked-shadow' or n not in LOUNGE_ROW_SHADOWS)))
            for layer, (why, names) in _DECLARED_LAYERS.items()}


def expected_entity_files(painted=True, volume=frozenset()):
    out = dict(BASE_ENTITY_FILES)
    if not painted:
        out['baked-shadow'] -= LOUNGE_ROW_SHADOW_FILES
    for name in volume:
        for layer, (names, files) in VOLUME_DROPS.get(name, {}).items():
            # a picture the lounge rows already took out of the count (painted off) has no partial alpha left to lose
            counted = painted or layer != 'baked-shadow' or not any(n in LOUNGE_ROW_SHADOWS for n in names)
            out[layer] -= files if counted else 0
    return out


def configure(volume=frozenset(), painted=None):
    """Point this module's declarations at a build made with `volume` (a set of switch names) and, optionally, `painted`
    (True or False; None keeps the process's own). verify.py calls it with the build's recorded switch, so a build is judged
    by what it was made with whatever the environment says now. Returns nothing; `configured()` reads it back."""
    global ENTITY_LAYERS, EXPECTED_ENTITY_FILES, _BY_NAME, _VOLUME
    painted = painted_shadows() if painted is None else painted
    _VOLUME = frozenset(volume)
    ENTITY_LAYERS = entity_layers(painted, _VOLUME)
    EXPECTED_ENTITY_FILES = expected_entity_files(painted, _VOLUME)
    _BY_NAME = {name: layer for layer, (_, names) in ENTITY_LAYERS.items() for name in names}


def configured():
    """The volume set the declarations below were built for."""
    return _VOLUME


def unpainted_names(volume):
    """The prefab names whose picture, with `volume` on, paints no shadow of its own (VOLUME_UNPAINTED): fx.py leaves them out of
    "painted" and of FLAT, so the runtime draws their shadow."""
    return {n for name in volume for n in VOLUME_UNPAINTED.get(name, ())}


_VOLUME = volume_pieces()
ENTITY_LAYERS = entity_layers(painted_shadows(), _VOLUME)

# The partial levels a declared entity layer may use, None for any (the lamp's glow is a gradient). MEASURED over the build.
ENTITY_LEVELS = {
    'glass': {51, 128, 179, 192, 204, 230},
    'baked-shadow': {22, 26, 28, 30, 40, 44, 48, 50, 56, 70, 100, 128, 130, 166},
}

# The count asserted by the check: how many pictures of each layer carry partial alpha (MEASURED, tools/README.md).
# Enforced by build.py (check_dist), by BuiltOffice over $KONCLUI_DIST and by DeclaredBudget (tools/test_pixelgrid.py),
# NOT by the mocked DeclaredLayers tests: change a number here and DeclaredBudget says so until it is changed on purpose.
EXPECTED_ENTITY_FILES = expected_entity_files(painted_shadows(), _VOLUME)

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
