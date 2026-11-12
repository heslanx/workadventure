"""The "Modern Office" entity collection: 327 LimeZu singles from sources/modern-office/.

Called by wa_build.py; writes dist/entities/modern-office/collection.json (version 1.0, stable ids
modern-office-NNN) and its sprites. Each object gets a Portuguese name and tags for the map editor search,
plus collision and depth from its kind. Finishes and colours of the same piece share one name, so the editor
offers them as colour variants (with directions where the piece has them):

  flat   desks, tables, counters: every 32 px cell whose centre is covered collides; depth at the top edge
  floor  carpet tiles: no collision; depth at the top edge, under whatever stands on them
  tall   shelves, machines, partitions: only the bottom covered row collides; depth at the bottom (default)
  seat   chairs and sofas: no collision, so a seat runtime can place the avatar; depth at the bottom
  item   things that sit on a desk: no collision; depth at the bottom, above the desk
  wall   pictures, boards, air conditioners: no collision; depth at the bottom

A cell counts as covered when at least a quarter of its central 16 px is opaque (the engine samples the
central 16 px of each cell). Variants share a name and differ by colour or direction.
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import entity_categories

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'sources/modern-office'
COLLECTION = 'Modern Office'
T = 32

FINISH = {'madeira texturizada': '#d9a77c', 'madeira clara': '#d6bc95', 'cinza': '#7c7a74',
          'madeira listrada': '#e3cc9f', 'branco': '#ddd8e8', 'madeira mel': '#e0a95a', 'madeira escura': '#c0703a'}
DESK_PARTS = ('borda de trás, ponta esquerda', 'lateral esquerda', 'lateral esquerda com recorte', 'mesa individual',
              'borda de trás, ponta esquerda 2', 'borda de trás, meio', 'borda de trás, ponta direita', 'lateral esquerda 2',
              'centro', 'lateral direita', 'frente, ponta esquerda', 'frente, meio', 'frente, ponta direita',
              'borda de trás, ponta direita 2', 'lateral direita 2', 'lateral direita com recorte', 'mesa individual 2')


def catalog():
    """{number: (name, kind, colour, direction, tags)} for all 327 singles."""
    c = {}

    def put(n, name, kind, colour, tags, direction='Down'):
        assert n not in c, n
        c[n] = (name, kind, colour, direction, tags)

    for first, finish in ((0, 'madeira texturizada'), (17, 'madeira clara'), (34, 'cinza'),
                          (53, 'madeira listrada'), (70, 'branco')):
        for i, part in enumerate(DESK_PARTS):
            put(first + i, f'Mesa modular: {part}', 'flat', FINISH[finish], ['mesa', 'modular', finish])
    put(51, 'Quadro abstrato', 'wall', 'white', ['quadro', 'decoração', 'parede'])
    put(52, 'Quadro abstrato', 'wall', 'peru', ['quadro', 'decoração', 'parede'])
    for n, colour, label in ((87, 'olive', 'lisa'), (88, 'brown', 'lisa'), (89, 'grey', 'lisa'),
                             (90, 'lightgrey', 'lisa'), (92, 'olive', 'com trama'), (93, 'brown', 'com trama'),
                             (94, 'grey', 'com trama'), (91, 'lightgrey', 'clara 1'), (95, 'lightgrey', 'clara 2'),
                             (96, 'lightgrey', 'clara 3')):
        put(n, f'Placa de carpete {label}', 'floor', colour, ['carpete', 'piso', 'tapete'])
    put(97, 'Notebook fechado', 'item', 'black', ['notebook', 'computador', 'mesa'])
    put(98, 'Notebook fechado', 'item', 'silver', ['notebook', 'computador', 'mesa'])
    # The chair with the mesh panel faces down, towards the viewer (The Office places it north of desks).
    for colour, label, model in (('black', 'preta', (100, 99, 103, 104)), ('peru', 'caramelo', (106, 105, 109, 110))):
        up, down, left, right = model
        name = 'Cadeira de escritório'
        tags = ['cadeira', 'assento', 'escritório', label]
        for n, d in ((up, 'Up'), (down, 'Down'), (left, 'Left'), (right, 'Right')):
            put(n, name, 'seat', colour, tags, d)
    for n, d in ((101, 'Up'), (102, 'Down'), (238, 'Right'), (312, 'Left')):
        put(n, 'Cadeira de escritório, modelo 2', 'seat', 'black', ['cadeira', 'assento', 'escritório', 'preta'], d)
    for n, d in ((107, 'Up'), (108, 'Down'), (239, 'Right'), (311, 'Left')):
        put(n, 'Cadeira de escritório, modelo 2', 'seat', 'peru', ['cadeira', 'assento', 'escritório', 'caramelo'], d)
    put(111, 'Planta em vaso', 'item', 'green', ['planta', 'decoração'])
    put(112, 'Suculenta em vaso', 'item', 'green', ['planta', 'decoração'])
    put(138, 'Planta alta em vaso', 'item', 'green', ['planta', 'decoração'])
    for k, n in enumerate((113, 114, 115), 1):
        put(n, f'Diploma emoldurado {k}', 'wall', 'white', ['quadro', 'decoração', 'parede'])
    put(116, 'Quadro de avisos', 'wall', 'white', ['quadro', 'parede'])
    for k, n in enumerate((117, 118, 218, 223, 227, 232, 240, 315), 1):
        put(n, f'Telefone de mesa {k}', 'item', 'grey', ['telefone', 'mesa'])
    put(119, 'Teclado e mouse', 'item', 'black', ['teclado', 'mouse', 'computador', 'mesa'])
    put(123, 'Teclado e mouse', 'item', 'white', ['teclado', 'mouse', 'computador', 'mesa'])
    put(159, 'Teclado e mouse', 'item', 'grey', ['teclado', 'mouse', 'computador', 'mesa'])
    put(225, 'Teclado e mouse 2', 'item', 'grey', ['teclado', 'mouse', 'computador', 'mesa'])
    put(234, 'Teclado e mouse 3', 'item', 'grey', ['teclado', 'mouse', 'computador', 'mesa'])
    for colour, (left, up, right) in (('black', (120, 121, 122)), ('white', (124, 125, 126))):
        for n, d in ((left, 'Left'), (up, 'Up'), (right, 'Right')):
            put(n, 'Monitor visto de trás', 'item', colour, ['monitor', 'computador', 'mesa'], d)
    for colour, (left, down, right) in (('black', (153, 154, 155)), ('white', (156, 157, 158))):
        for n, d in ((left, 'Left'), (down, 'Down'), (right, 'Right')):
            put(n, 'Monitor ligado', 'item', colour, ['monitor', 'computador', 'tela', 'mesa'], d)
    for k, (n, colour) in enumerate(((222, 'black'), (224, 'black'), (231, 'black'), (233, 'white'),
                                     (305, 'white'), (306, 'black')), 2):
        put(n, f'Monitor ligado {k}', 'item', colour, ['monitor', 'computador', 'tela', 'mesa'])
    for k, (n, colour) in enumerate(((243, 'black'), (244, 'white'), (245, 'black'), (309, 'white'), (310, 'black')), 1):
        put(n, f'Monitor duplo em suporte {k}', 'item', colour, ['monitor', 'computador', 'tela', 'mesa'])
    put(127, 'Quadro branco', 'wall', 'white', ['quadro', 'reunião', 'parede'])
    put(128, 'Quadro branco com gráfico de barras', 'wall', 'white', ['quadro', 'reunião', 'gráfico', 'parede'])
    put(129, 'Quadro branco com gráficos', 'wall', 'white', ['quadro', 'reunião', 'gráfico', 'parede'])
    put(130, 'Quadro pop art grande', 'wall', 'orange', ['quadro', 'decoração', 'parede'])
    put(131, 'Quadro pop art pequeno', 'wall', 'orange', ['quadro', 'decoração', 'parede'])
    for k, n in enumerate((132, 133, 134, 135, 226), 1):
        put(n, f'Porta-retrato de lado {k}', 'item', 'tan', ['porta-retrato', 'decoração', 'mesa'])
    put(136, 'Porta-retrato de frente 1', 'item', 'tan', ['porta-retrato', 'decoração', 'mesa'])
    put(137, 'Porta-retrato de frente 2', 'item', 'tan', ['porta-retrato', 'decoração', 'mesa'])
    put(235, 'Porta-retrato com documento', 'item', 'tan', ['porta-retrato', 'papel', 'mesa'])
    put(139, 'Bandeja com papéis', 'item', 'white', ['papel', 'documento', 'mesa'])
    put(140, 'Bloco de notas', 'item', 'white', ['papel', 'mesa'])
    put(221, 'Bloco de notas 2', 'item', 'white', ['papel', 'mesa'])
    put(230, 'Bloco de notas 3', 'item', 'white', ['papel', 'mesa'])
    put(141, 'Pilha de papéis', 'item', 'white', ['papel', 'documento', 'mesa'])
    put(142, 'Pilha alta de papéis', 'item', 'white', ['papel', 'documento', 'mesa'])
    for n, colour in ((143, 'lightblue'), (144, 'lavender'), (145, 'grey'), (146, 'goldenrod')):
        put(n, 'Poltrona casulo', 'seat', colour, ['poltrona', 'assento', 'descanso'])
    put(147, 'Estante vazia', 'tall', 'silver', ['estante', 'armário'])
    put(148, 'Estante com objetos', 'tall', 'silver', ['estante', 'armário', 'decoração'])
    put(149, 'Ar-condicionado', 'wall', 'white', ['ar-condicionado', 'parede'])
    put(150, 'Ar-condicionado', 'wall', 'silver', ['ar-condicionado', 'parede'])
    put(151, 'Fragmentadora de papel', 'tall', 'grey', ['papel', 'equipamento'])
    put(152, 'Arquivo alto', 'tall', 'grey', ['arquivo', 'armário'])
    for k, n in enumerate((160, 161, 162, 163, 164, 165, 220, 229), 1):
        put(n, f'Luminária de mesa {k}', 'item', 'grey', ['luminária', 'luz', 'mesa'])
    put(166, 'Bebedouro com galão', 'tall', 'lightblue', ['bebedouro', 'água', 'copa'])
    for n, label, colour in ((168, 'de frente', 'silver'), (167, 'de lado 1', 'silver'), (169, 'de lado 2', 'silver'),
                             (219, 'de frente 2', 'silver'), (171, 'de frente', 'black'), (170, 'de lado 1', 'black'),
                             (172, 'de lado 2', 'black'), (228, 'de frente 2', 'black')):
        put(n, f'Notebook aberto {label}', 'item', colour, ['notebook', 'computador', 'mesa'])
    for k, n in enumerate((173, 174, 175, 177, 178, 179, 181), 1):
        put(n, f'Sofá modular cinza, módulo {k}', 'seat', 'grey', ['sofá', 'assento', 'descanso'])
    put(176, 'Sofá de canto cinza', 'seat', 'grey', ['sofá', 'assento', 'descanso'], 'Left')
    put(180, 'Sofá de canto cinza', 'seat', 'grey', ['sofá', 'assento', 'descanso'], 'Right')
    for first, finish in ((182, 'madeira clara'), (185, 'madeira mel'), (188, 'madeira escura')):
        for i in range(3):
            put(first + i, f'Mesa de madeira, parte {i + 1}', 'flat', FINISH[finish], ['mesa', finish])
    put(191, 'Impressora multifuncional com folhas', 'tall', 'black', ['impressora', 'equipamento'])
    put(192, 'Impressora multifuncional com folhas', 'tall', 'white', ['impressora', 'equipamento'])
    for n, colour, label in ((193, 'black', 'Impressora com papel'), (194, 'black', 'Impressora'),
                             (195, 'black', 'Impressora com papel saindo'), (207, 'white', 'Impressora com papel'),
                             (208, 'white', 'Impressora'), (209, 'white', 'Impressora com papel saindo')):
        put(n, label, 'item', colour, ['impressora', 'equipamento', 'mesa'])
    for first, finish, parts in ((196, 'madeira texturizada', ('fundo', 'tampo', 'frente')),
                                 (199, 'madeira escura', ('fundo', 'tampo', 'frente')),
                                 (202, 'madeira mel', ('fundo', 'tampo', 'frente')),
                                 (205, 'madeira mel', ('fundo 2', 'frente 2'))):
        for i, part in enumerate(parts):
            put(first + i, f'Mesa comprida: {part}', 'flat', FINISH[finish], ['mesa', 'reunião', finish])
    put(210, 'Armário escuro com gavetas', 'tall', 'dimgrey', ['armário', 'arquivo'])
    put(211, 'Geladeira de bebidas', 'tall', 'dimgrey', ['geladeira', 'bebida', 'copa'])
    put(212, 'Máquina de lanches', 'tall', 'dimgrey', ['lanche', 'máquina', 'copa'])
    for n, label in ((213, 'com poste à esquerda'), (214, 'painel'), (215, 'com poste no meio'), (216, 'painel 2'),
                     (217, 'com poste à direita')):
        put(n, f'Divisória de vidro {label}', 'tall', 'lightsteelblue', ['divisória', 'vidro', 'parede'])
    put(236, 'Conjunto de mesa: computador, impressora e porta-retrato', 'item', 'grey', ['computador', 'mesa', 'conjunto'])
    put(237, 'Conjunto de mesa: computador, impressora e porta-retrato 2', 'item', 'grey', ['computador', 'mesa', 'conjunto'])
    put(241, 'Caneta', 'item', 'grey', ['papelaria', 'mesa'])
    put(313, 'Caneta 2', 'item', 'grey', ['papelaria', 'mesa'])
    put(242, 'Grampeador', 'item', 'black', ['papelaria', 'mesa'])
    put(314, 'Grampeador 2', 'item', 'black', ['papelaria', 'mesa'])
    for n, colour, k in ((246, 'white', ''), (307, 'white', ' 2'), (247, 'black', ''), (308, 'black', ' 2')):
        put(n, f'Gabinete de computador{k}', 'item', colour, ['computador', 'mesa'])
    put(248, 'Máquina de café com copos', 'item', 'dimgrey', ['café', 'copa'])
    put(249, 'Cafeteira com xícara', 'item', 'dimgrey', ['café', 'copa', 'mesa'])
    put(250, 'Cafeteira com grãos', 'item', 'dimgrey', ['café', 'copa', 'mesa'])
    for n, finish in ((251, 'madeira clara'), (252, 'cinza'), (253, 'branco'), (254, 'madeira texturizada'),
                      (255, 'madeira listrada')):
        put(n, 'Mesa baixa comprida', 'flat', FINISH[finish], ['mesa', 'mesa baixa', finish])
    pieces = ('ponta com gaveta', 'tampo', 'mesa em L', 'mesa estreita')
    for first, finish in ((256, 'madeira clara'), (260, 'madeira texturizada'), (264, 'madeira listrada'),
                          (268, 'branco'), (272, 'cinza')):
        for i, piece in enumerate(pieces):
            put(first + i, f'Mesa: {piece}', 'flat', FINISH[finish], ['mesa', finish])
    mirrored = ('mesa estreita 2', 'mesa em L espelhada', 'tampo 2', 'ponta com gaveta espelhada')
    for first, finish in ((276, 'madeira texturizada'), (280, 'madeira clara'), (284, 'branco'),
                          (288, 'madeira listrada'), (292, 'cinza')):
        for i, piece in enumerate(mirrored):
            put(first + i, f'Mesa: {piece}', 'flat', FINISH[finish], ['mesa', finish])
    for n, finish in ((296, 'madeira clara'), (297, 'madeira mel'), (298, 'madeira escura')):
        put(n, 'Bancada de café', 'flat', FINISH[finish], ['café', 'copa', 'mesa', finish])
    for n, finish, printer in ((299, 'madeira clara', 'preta'), (300, 'madeira mel', 'preta'),
                               (301, 'madeira escura', 'branca'), (302, 'madeira mel', 'branca'),
                               (303, 'madeira clara', 'branca'), (304, 'madeira escura', 'preta')):
        put(n, f'Mesa com impressora {printer}', 'flat', FINISH[finish], ['impressora', 'mesa', finish])
    for n, colour, model in ((316, 'steelblue', ''), (317, 'steelblue', ', modelo 2'), (318, 'chocolate', ''),
                             (319, 'chocolate', ', modelo 2'), (322, 'dimgrey', ''), (323, 'dimgrey', ', modelo 2'),
                             (324, 'goldenrod', ''), (325, 'goldenrod', ', modelo 2')):
        put(n, f'Mochila{model}', 'item', colour, ['mochila', 'bolsa'])
    put(320, 'Maço de dinheiro', 'item', 'green', ['dinheiro'])
    put(321, 'Pilha de dinheiro', 'item', 'green', ['dinheiro'])
    put(326, 'Monte de dinheiro', 'item', 'green', ['dinheiro'])
    return c


# Where the avatar sits on each seat prefab (px from the sprite's top-left), the way it faces, and the depth
# offset that draws a seated avatar over chairs it sits in front of (facing down or sideways). A chair seen
# from behind keeps its bottom depth, so its backrest covers the sitter's back. Corner sofas (176, 180) still
# need two anchors each and are not seats yet.
# Seen from behind, the sitter's head must clear the backrest: anchor 18 px down the sprite, not 34 (the auditorium
# stream measured it in the engine, 2026-10-13); a chair at a desk sits 6 px lower so the body stays off the desk.
SEAT_FRONT, SEAT_BACK = ((16, 40), 'down', -24), ((16, 18), 'up', 0)
SEAT_LEFT, SEAT_RIGHT = ((13, 38), 'left', -24), ((19, 38), 'right', -24)
SEATS = {**{n: SEAT_FRONT for n in (99, 102, 105, 108, 143, 144, 145, 146)},
         **{n: SEAT_BACK for n in (100, 101, 106, 107)},
         **{n: SEAT_LEFT for n in (103, 109, 311, 312)},
         **{n: SEAT_RIGHT for n in (104, 110, 238, 239)},
         **{n: ((16, 38), 'down', -24) for n in (173, 174, 175, 177, 178, 179, 181)}}


# Brand variants (owner, 2026-10-13: small changes to the pieces we have are fine). The black office chair in
# the brand navy, in its four directions: same name, so the editor offers navy as a colour of that chair.
NAVY_RAMP = ['#0B0D33', '#171C4A', '#232B66', '#323D86', '#4A58A8', '#7482CC']
NAVY = '#232B66'
VARIANTS = [(f'konclui-chair-navy-{d.lower()}', n, 'Cadeira de escritório', NAVY, d)
            for n, d in ((99, 'Down'), (100, 'Up'), (103, 'Left'), (104, 'Right'))]
# Drawn brand rug: (id, width, height in px). Muted brand teal with a darker border and a light inner line.
RUGS = [('konclui-rug-teal-224x192', 224, 192)]
RUG_COLOURS = dict(field='#3F7B82', border='#2C6468', line='#9FC9CB', weave='#4A878E')


def prefab_seats():
    """Seat templates for the seating runtime: every placed copy of these prefabs is a seat."""
    seats = [(f'modern-office-{n:03d}', a, facing) for n, (a, facing, _) in sorted(SEATS.items())]
    seats += [(vid, SEATS[n][0], SEATS[n][1]) for vid, n, *_ in VARIANTS]
    out = [dict(collectionName=COLLECTION, prefabId=pid, anchorOffset=dict(x=a[0], y=a[1]), direction=facing)
           for pid, a, facing in seats]
    import furniture                          # the auditorium stream's own seat templates
    if furniture.auditorium and hasattr(furniture.auditorium, 'prefab_seats'):
        out += furniture.auditorium.prefab_seats()
    return out


def recolour(img, ramp):
    """Map the opaque pixels onto a colour ramp by luminance rank, keeping the shading and the alpha."""
    a = np.asarray(img).copy()
    body = a[..., 3] > 0
    lum = a[..., :3].astype(int) @ [299, 587, 114]
    levels = np.unique(lum[body])
    rgb = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in ramp]
    for i, level in enumerate(levels):
        a[body & (lum == level), :3] = rgb[min(len(rgb) - 1, i * len(rgb) // len(levels))]
    return Image.fromarray(a, 'RGBA')


def rug(width, height):
    """Low-pile rug in native pixels: border, inner line, a two-pixel weave on the field."""
    c = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) + (255,) for k, v in RUG_COLOURS.items()}
    img = Image.new('RGBA', (width, height))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, width - 1, height - 1), radius=6, fill=c['border'])
    d.rounded_rectangle((5, 5, width - 6, height - 6), radius=4, fill=c['field'])
    d.rounded_rectangle((9, 9, width - 10, height - 10), radius=3, outline=c['line'])
    for y in range(12, height - 12, 4):
        for x in range(12 + (y // 4 % 2) * 2, width - 12, 4):
            d.point((x, y), fill=c['weave'])
    return img


def covered(img, minimum=64):
    """rows x cols of booleans: at least `minimum` of the 256 pixels of the cell's central 16 px are opaque."""
    alpha = img.getchannel('A')
    grid = []
    for top in range(0, img.height, T):
        row = []
        for left in range(0, img.width, T):
            centre = alpha.crop((left + 8, top + 8, left + 24, top + 24))
            row.append(sum(1 for a in centre.getdata() if a) >= minimum)
        grid.append(row)
    return grid


def physics(img, kind):
    """(collisionGrid or None, depthOffset) for one sprite."""
    top = img.getchannel('A').getbbox()[1]
    depth = top - img.height if kind in ('flat', 'floor') else 0
    # A desk's back edge fills only the lower half of its tile: it stays walkable, so a chair facing the desk
    # can sit right against it (owner, 2026-10-13: chairs were too far from the desks).
    cells = covered(img, 129 if kind == 'flat' else 64)
    if kind == 'flat':
        grid = [[int(c) for c in row] for row in cells]
    elif kind == 'tall':
        bottom = max((r for r, row in enumerate(cells) if any(row)), default=None)
        grid = [[int(c and r == bottom) for c in row] for r, row in enumerate(cells)]
    else:
        grid = None
    return (grid if grid and any(map(any, grid)) else None), depth


def build(dist, extra_prefabs=()):
    """Write dist/entities/modern-office/; return the collection path relative to dist. extra_prefabs: callables
    that add their own prefabs through add() (wa_build passes furnishing_expansion.build_prefabs when enabled)."""
    out = dist / 'entities/modern-office'
    if out.exists():
        shutil.rmtree(out)
    (out / 'sprites').mkdir(parents=True)
    entries = catalog()
    sprites = sorted(SRC.glob('modern-office-*.png'))
    assert sorted(int(p.stem[-3:]) for p in sprites) == sorted(entries), 'catalog and sprites differ'
    order = list(entries)                       # catalogue order, so a category's grid groups related pieces
    seen, collection = set(), []

    def add(pid, img, name, kind, colour, direction, tags, depth_override=None, source=None):
        assert (name, colour, direction) not in seen, (pid, name, colour, direction)
        seen.add((name, colour, direction))
        grid, depth = physics(img, kind)
        if depth_override is not None:
            depth = depth_override
        if source:
            shutil.copyfile(source, out / 'sprites' / f'{pid}.png')      # originals stay byte-identical
        else:
            img.save(out / 'sprites' / f'{pid}.png')
        # One tag per object, its editor category (entity_categories.py): the editor makes a category per tag.
        entity = dict(id=pid, name=name, tags=[entity_categories.office(kind, tags)], imagePath=f'sprites/{pid}.png',
                      direction=direction, color=colour)
        if grid:
            entity['collisionGrid'] = grid
        if depth:
            entity['depthOffset'] = depth
        collection.append(entity)

    for path in sorted(sprites, key=lambda p: order.index(int(p.stem[-3:]))):
        n = int(path.stem[-3:])
        name, kind, colour, direction, tags = entries[n]
        add(path.stem, Image.open(path).convert('RGBA'), name, kind, colour, direction, tags,
            SEATS[n][2] if n in SEATS else None, source=path)
    for vid, n, name, colour, direction in VARIANTS:
        _, kind, _, _, tags = entries[n]
        add(vid, recolour(Image.open(SRC / f'modern-office-{n:03d}.png').convert('RGBA'), NAVY_RAMP), name, kind,
            colour, direction, tags, SEATS[n][2])
    for rid, width, height in RUGS:
        add(rid, rug(width, height), 'Tapete Koncluí', 'floor', RUG_COLOURS['field'], 'Down', ['tapete', 'piso'])
    # Floor plants (owner, 2026-10-13: small plants belong on desks and sideboards, the floor gets large ones):
    # Modern Interiors singles by the same artist, byte-identical (sources/modern-interiors/manifest.json). 'tall'
    # puts the collision on the pot's row; depthOffset discounts the transparent margin under each pot.
    plants = ROOT / 'sources/modern-interiors'
    for p in json.loads((plants / 'manifest.json').read_text()):
        add(p['id'], Image.open(plants / p['image']).convert('RGBA'), p['name'], 'tall', p['colour'], 'Down',
            ['planta', 'decoração', 'piso'], p['depth_offset'], source=plants / p['image'])
    import furniture                          # its optional auditorium module brings its own prefabs
    if furniture.auditorium:
        furniture.auditorium.build_prefabs(add)
    for hook in extra_prefabs:
        hook(add)
    # Bespoke art keeps the same prefab identities and measured physics/seat contracts.
    import interior_finishes
    interior_finishes.apply(out, collection)
    import signature_interiors
    signature_interiors.apply(out, collection)
    import modular_workstations
    modular_workstations.floor_contract(out, {'collection': collection})
    doc = dict(collectionName=COLLECTION, tags=[], version='1.0', collection=collection)
    (out / 'collection.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    return 'entities/modern-office/collection.json'
