"""Plan of the HQ office: architecture, floors, pool and furniture as data, in 32 px tiles. Read by build.py.

The programme is the main office's (office/communication.py: four team rooms, two meeting rooms, twelve focus
booths, auditorium with stage and audience, cafe, two open work wings and the reception) plus its pool: the canal
that leaves the Koru fountain on the north facade, passes under a bridge and opens into the lake with the official K
deck, with koi in both. Drawn in the furniture catalogue's 32 px pixel language and coloured by the Koncluí design system
(palette.py): cool white walls with an ink cap, frameless glass with the turquoise film, light oak, white desks and
iMacs, petrol-teal chairs, mint only as an accent.

Images: the catalogue's (catalogue.py), some recoloured to the design system (colour names 'ds-*'), and the
Koncluí pieces drawn by this folder (glass, pool, fountain, signature furniture). Floors and walls become tiles; all
furniture and decoration are editor objects.

Mirror symmetry about the middle of column 43 (mx). Walls follow the catalogue's wall geometry, adapted to WorkAdventure's
tile collision:
  H wall (row, a, b, kind, material)  a face two rows tall (rows row and row+1, both blocked) from wall column a to
                      wall column b, its cap at the top, the face drawn below the wall line; kind 'n' or
                      's' (wall piece set), material 'solid' or 'glass'
  V wall (col, a, b, material)        a thin wall in column col (blocked) from row a to row b, its strip in the
                      middle of the column so that people on both sides stop the same 6 px from it
  doors               gaps of two tiles (the entrance three)
"""

W, H = 86, 56
AXIS = 43                                # the column the plan mirrors about (its middle)
BX0, BX1 = 6, 80                         # building: exterior wall columns
BY0, BY1 = 6, 48                         # north face rows 6-7 (inside), south face rows 48-49 (outside)


def mx(x, w=1):
    """Left column of the mirror image of something w tiles wide whose left column is x."""
    return 2 * AXIS + 1 - x - w


FLIP = {'Left': 'Right', 'Right': 'Left', 'Up': 'Up', 'Down': 'Down'}

# Floors: a catalogue floor tile, recoloured to a design-system ramp when the entry is (tile, ramp) (palette.FLOOR_RAMPS).
FLOORS = {
    'lawn': '@lawn',                     # textured grass drawn by lawn.py, 384 px
    'path': ('Stone_Tile', 'porcelain'),
    'hall': '@porcelain',                # this office's own patterns (signature.tile_pattern), 64 px
    'room': ('Wood_Slats_LightWood', 'oak'),
    'meeting': ('Wood_Herringbone_LightWood', 'oak'),
    'stage': ('Wood_Slats_Wood', 'oak'),
    'audience': ('Carpet_Stripe_Gray', 'petrol'),
    'booth': ('Wood_Slats_LightWood', 'oak'),
    'pod': ('Carpet_Texture', 'mist'),
    'cafe': ('Wood_Herringbone_LightWood', 'oak'),
    'lounge': ('Wood_Slats_LightWood', 'oak'),
    'lounge-warm': ('Wood_Slats_LightWood', 'oak-warm'),       # the café's lounge and games, a step warmer
    'cafe-warm': ('Wood_Herringbone_LightWood', 'oak-warm'),   # and the café's herringbone bands round it
    'reception': '@terrazzo',
    'boardwalk': '@boardwalk',
    'rug-tile': 'Tile_2tone_Orange',     # the lounges' terracotta tiles (the owner's Gather reference, 18/10/2026)
}

# ------------------------------------------------------------------------------------------------ architecture

H_WALLS = [  # (row, from wall column, to wall column, piece set, material)
    (BY0, BX0, 19, 'n', 'solid'),        # north facade: auditorium (the stage screen hangs on it)
    (BY0, 19, 41, 'n', 'glass'),         # team rooms 01-02: floor-to-ceiling glass
    (BY0, 41, 45, 'n', 'solid'),         # fountain backdrop
    (BY0, 45, 67, 'n', 'glass'),         # team rooms 03-04
    (BY0, 67, BX1, 'n', 'solid'),        # cafe kitchen
    (BY1, BX0, BX1, 's', 'glass'),       # south facade (face outside, on the lawn)
    (30, BX0, 19, 'n', 'solid'),         # auditorium | meeting 01
    (39, BX0, 19, 'n', 'solid'),         # meeting 01 | meeting 02
    (17, 19, 41, 'n', 'glass'),          # team rooms | hall
    (17, 45, 67, 'n', 'glass'),
    (24, 22, 34, 'n', 'solid'),          # west booth block, back to back
    (24, mx(34), mx(22), 'n', 'solid'),  # east booth block
    (38, 38, mx(38), 'n', 'feature'),    # reception: oak and ink feature wall with the logo, behind the desk
]
V_WALLS = [  # (column, from row, to row, material)
    (BX0, BY0, BY1 + 1, 'solid'), (BX1, BY0, BY1 + 1, 'solid'),
    (19, BY0, 31, 'solid'), (19, 32, BY1 - 1, 'glass'),     # auditorium solid, meeting rooms glass
    (67, BY0, 18, 'solid'), (67, 19, BY1 - 1, 'glass'),     # cafe: glass to the hall
    (30, BY0, 18, 'solid'), (mx(30), BY0, 18, 'solid'),      # between the team rooms
    (41, BY0, 18, 'glass'), (45, BY0, 18, 'glass'),          # team rooms 02 and 03 look onto the canal
    *[(c, 22, 27, 'solid') for c in (22, 26, 30, 34)],      # booth partitions, west
    *[(mx(c), 22, 27, 'solid') for c in (22, 26, 30, 34)],  # and east
]
DOORS_H = [  # (row of the face, first column, width)
    (17, 24, 2), (17, 35, 2), (17, mx(35, 2), 2), (17, mx(24, 2), 2),   # team rooms
    (BY1, AXIS - 1, 3),                                                  # main entrance
]
DOORS_V = [  # (column, first row); always two rows
    (19, 20), (19, 27),                  # auditorium: front (north corridor) and back
    (19, 35), (19, 44),                  # meeting rooms
    (67, 20), (67, 37),                  # cafe and lounge
]

# Rooms: key -> (left wall col, top face row, right wall col, bottom face row); the floor runs from wall middle to
# wall middle and from the top face to the cap of the bottom one. Interior = (l+1 .. r-1, t+2 .. b-1).
ROOMS = {
    'auditorium': (BX0, BY0, 19, 30),
    'meeting_01': (BX0, 30, 19, 39),
    'meeting_02': (BX0, 39, 19, BY1),
    'room_01': (19, BY0, 30, 17),
    'room_02': (30, BY0, 41, 17),
    'room_03': (45, BY0, mx(30), 17),
    'room_04': (mx(30), BY0, 67, 17),
    'cafe': (67, BY0, BX1, BY1),
}
def vb(c):
    """The tile boundary a V wall of column c stands on: its west edge on the west half of the plan, its east edge on
    the east half, so the plan stays mirrored and the column joins the room on the far side."""
    return c if c <= AXIS else c + 1


# Booths: key -> interior (x0, y0, x1, y1) inclusive, four tiles between two thin partitions, and the desk column.
# a1-a3 west top (open north), a4-a6 west bottom (open south), b east, numbered from the axis outwards. Two tiles
# deep (owner, 18/10/2026: a strip was left between the top desks and the back wall, and behind the bottom chairs):
# the desk against the back wall, the chair before it, and the corridor as the way in.
BOOTHS, BOOTH_DESK = {}, {}
for i, c in enumerate((30, 26, 22)):
    e = mx(c, 4)
    for n, (y0, y1) in ((i + 1, (22, 23)), (i + 4, (26, 27))):
        BOOTHS[f'booth_a{n}'], BOOTH_DESK[f'booth_a{n}'] = (c, y0, c + 3, y1), c + 1
        BOOTHS[f'booth_b{n}'], BOOTH_DESK[f'booth_b{n}'] = (e, y0, e + 3, y1), mx(c + 1, 3)

# Pool (pool.py draws it): the canal between team rooms 02 and 03 from the fountain to the lake, a bridge where the
# north corridor crosses it, and the lake with the K deck. Tiles, inclusive.
POOL = dict(
    canal=(AXIS - 1, BY0 + 2, AXIS + 1, 24),     # water columns 42-44 from row 8 down into the lake
    lake=(37, 24, 49, 36),                       # 13 x 13 tiles, rounded corners
    bridge=(AXIS - 2, 21, AXIS + 2, 22),         # centred between the corridor and the lake, the canal's full width
    slot_end=19,                                 # the team rooms' glass walls flank the canal down to this row
    fountain=(AXIS - 1, BY0, AXIS + 1, BY0 + 3), # Koru on the facade at the canal head
    deck_scale=0.62,                             # K deck width / lake width
    koi=11,
)

# Floor zones over the building floor, painted in order: (floor, x0, y0, x1, y1) inclusive tiles.
ZONES = [
    ('pod', 21, 30, 34, 38), ('pod', mx(34), 30, mx(21), 38),
    ('boardwalk', 37, 21, 40, 22), ('boardwalk', mx(40), 21, mx(37), 22),   # oak boardwalk to the bridge
    ('reception', 32, 40, mx(32), 47),
    ('lounge', 21, 41, 31, 47), ('lounge', mx(31), 41, mx(21), 47),
    ('stage', 7, 8, 18, 12), ('audience', 7, 13, 18, 29),
    ('lounge-warm', 68, 31, 79, 47), ('cafe-warm', 68, 30, 80, 30), ('cafe-warm', 80, 31, 80, 47),
    ('rug-tile', 23, 41, 29, 47), ('rug-tile', mx(29), 41, mx(23), 47),
]

# Functional areas (WAM) for the parts of the hall: key -> (x0, y0, x1, y1) inclusive tiles.
HALL_AREAS = {
    'commercial_west': (20, 29, 35, 39),
    'commercial_east': (mx(35), 29, mx(20), 39),
    'entry_plaza': (20, 40, 66, 47),
    'lake': (36, 19, 50, 39),
}
STAGE_ROWS = 5                           # the auditorium's first five interior rows are the stage

# ------------------------------------------------------------------------------------------------ furniture
# Each piece: dict(key, type, colour, dir, x, y) with x, y the tile of the top-left of the trimmed image, or
# seat=(sx, sy) for seating (build.py derives x, y from the seat anchor), or on=parent key for a small piece standing
# on another (build.py centres it on the parent's picture, dx px off, its bottom `s` px below the parent's top;
# SURFACE by parent type when s is None). px/py nudge decoration by pixels. Colours 'ds-*' are design-system
# recolours of the catalogue picture (palette.py); type 'Koncluí: ...' is a piece of this folder (signature.py).

PIECES = []
SURFACE = {'Office Desk': 27, 'Modern Executive Desk': 28, 'Kitchen Cabinet (Large)': 13,
           'Conference Table 2x3': 40, 'Octagonal Table 2x3': 34, 'Round Coffee Table': 16, 'Filing Cabinet': 8,
           'Mid Century Side Table': 8, 'Bookcase (Medium)': 6, 'Mid Century Credenza': 6}


def _add(piece, mirror):
    PIECES.append(piece)
    if mirror:
        twin = dict(piece, key=piece['key'] + '/e', dir=FLIP[piece['dir']], mirror_of=piece['key'])
        if 'on' in piece:
            twin.update(on=piece['on'] + '/e', dx=-piece.get('dx', 0))
        PIECES.append(twin)


def put(key, type_, colour, direction, x, y, px=0, py=0, mirror=True):
    """One piece and, when mirror, its mirror image across the axis (key suffix /e, Left and Right swapped)."""
    _add(dict(key=key, type=type_, colour=colour, dir=direction, x=x, y=y, px=px, py=py), mirror)


def sit(key, type_, colour, direction, sx, sy, mirror=True):
    _add(dict(key=key, type=type_, colour=colour, dir=direction, seat=(sx, sy)), mirror)


def on(parent, key, type_, colour, direction, dx=0, s=None, mirror=True):
    _add(dict(key=key, type=type_, colour=colour, dir=direction, on=parent, dx=dx, s=s), mirror)


LAMP_DESKS = ('room_01/ws0', 'room_02/ws0')   # their left end holds the desk lamp
DESK = ('Office Desk', 'white')
CHAIR = ('Office Chair', 'ds-petrol')
PC = ('iMac', 'white')
PLANT_POT = 'white'


# Each person's desk differs (owner, 18/10/2026): a drink, some paper, something personal or a gadget, picked from the
# desk key so a rebuild gives every desk the same things back. (type, colours, directions) per kind.
DESK_PROPS = {
    'drink': [('Mug (Regular)', ('black', 'blue', 'green', 'orange', 'pink', 'red'), ('Down', 'Left', 'Right')),
              ('Mug (Wide)', ('grey', 'coffee', 'blue', 'green'), ('Down', 'Left', 'Right')),
              ('Mug (Tall)', ('grey', 'black', 'green', 'purple'), ('Down', 'Left')),
              ('Teacup', ('lightblue', 'green', 'pink'), ('Down',)), ('Iced Coffee', ('brown', 'lightbrown'), ('Down',)),
              ('Boba Tea', ('brown', 'green', 'pink', 'purple'), ('Down',)),
              ('Hydroflask', ('teal', 'black', 'green', 'pink', 'blue'), ('Down',)),
              ('Quencher Tumbler', ('grey', 'green', 'pink', 'purple'), ('Down',)),
              ('Soda (Can)', ('red', 'green', 'blue'), ('Down',))],
    'paper': [('Document (Single)', ('white', 'lightcoffee'), ('Down', 'Left')),
              ('Inkpen Notes', ('blue', 'green', 'orange', 'teal'), ('Down',)),
              ('Notebook (Closed)', ('blue', 'green', 'grey', 'pink', 'black'), ('Down',)), ('Book (Closed)', ('blue', 'green', 'darkbrown', 'grey'), ('Down',))],
    'personal': [('Koncluí: photo frame', ('beach', 'mountain', 'pet', 'family'), ('Down',)),
                 ('Tiny Cactus', ('white', 'orange'), ('Down',)), ('Sprout', ('green',), ('Down',)),
                 ('Potted Grass', ('white',), ('Down',)), ('Small potted Hosta', ('white',), ('Down',)),
                 ('Aloe Vera', ('grey',), ('Down',)), ('Rubber Ducky', ('yellow',), ('Down', 'Left')),
                 ('Apple', ('red', 'green'), ('Down',))],
    'gadget': [('Tablet and Phone', ('black', 'grey'), ('Down',)), ('Headphones', ('black', 'blue', 'pink', 'green'), ('Down',))],
}
PROP_CHANCE = {'drink': 0.7, 'paper': 0.55, 'personal': 0.6, 'gadget': 0.25}


def personalise(desk, seed, skip_left=False):
    """Up to three things on a desk, on the free ends either side of the screen."""
    import random
    import zlib
    rnd = random.Random(zlib.crc32(seed.encode()))
    slots = [-31, 31] if not skip_left else [31]
    rnd.shuffle(slots)
    for kind in rnd.sample(list(DESK_PROPS), k=len(DESK_PROPS)):
        if not slots:
            break
        if rnd.random() > PROP_CHANCE[kind]:
            continue
        type_, colours, dirs = rnd.choice(DESK_PROPS[kind])
        colour = rnd.choice(colours) if colours else None
        on(desk, f'{seed}/prop-{kind}', type_, colour, rnd.choice(dirs), dx=slots.pop() + rnd.randint(-3, 3),
           s=P_SURFACE_BACK + rnd.randint(0, 6), mirror=False)


P_SURFACE_BACK = 21                      # px below a desk's top where small things stand (its middle band)


def workstation(key, x, y, facing='up', mirror=True):
    """A desk at (x, y) (three tiles wide, collision on its top row) with its iMac and chair: facing up the chair is
    under the desk's front row, facing down above the desk."""
    if facing == 'up':
        put(key + '/desk', *DESK, 'Down', x, y, mirror=mirror)
        on(key + '/desk', key + '/pc', *PC, 'Down', mirror=mirror)
        sit(key + '/chair', *CHAIR, 'Up', x + 1, y + 1, mirror=mirror)
    else:
        put(key + '/desk', *DESK, 'Up', x, y, mirror=mirror)
        on(key + '/desk', key + '/pc', *PC, 'Up', mirror=mirror)
        sit(key + '/chair', *CHAIR, 'Down', x + 1, y - 1, mirror=mirror)
    for desk in ([key + '/desk', key + '/desk/e'] if mirror else [key + '/desk']):
        personalise(desk, desk.replace('/desk', ''), skip_left=desk.startswith(LAMP_DESKS))


# Team rooms 01 and 02 (03 and 04 mirror them): six workstations, an aisle on the west side, plants and a credenza.
for room, l in (('room_01', 19), ('room_02', 30)):
    x0 = l + 1
    for i in range(3):
        workstation(f'{room}/ws{i}', x0 + 1 + i * 3, 9)
        workstation(f'{room}/ws{i + 3}', x0 + 1 + i * 3, 13)
    put(f'{room}/plant', 'Fiddle-leaf Fig', PLANT_POT, 'Down', x0 + 9, 15)
    put(f'{room}/credenza', 'Mid Century Credenza', 'white', 'Down', x0, 14)
    # a shared printer on the credenza (Modern Office, sheets.py: a desktop machine; owner, 18/10/2026: "vão colocar
    # algum móvel por baixo?")
    on(f'{room}/credenza', f'{room}/printer', 'Impressora multifuncional com folhas', 'white', 'Down')
    on(f'{room}/ws0/desk', f'{room}/ws0/lamp', 'Molecular Lamp', 'black', 'Down', dx=-34)

# Auditorium: stage with the Koncluí screen and a lectern, eight rows of eight seats facing the stage, plants.
put('aud/screen', 'Koncluí: LED wall', 'ink', 'Down', 9, BY0, mirror=False)
put('aud/lectern', 'Lectern (Modern)', 'white', 'Down', 12, 10, px=16, mirror=False)
for i, x in enumerate((7, 18)):
    put(f'aud/plant{i}', 'Bird of Paradise (Green)', PLANT_POT, 'Down', x, 7, mirror=False)
EAMES = ('Eames Lounger', 'black')      # the owner's chair from the Gather boardroom (18/10/2026)
for r in range(8):
    for c in (8, 9, 10, 11, 14, 15, 16, 17):
        sit(f'aud/seat-{r}-{c}', *EAMES, 'Up', c, 14 + 2 * r, mirror=False)
put('aud/camera', 'Camera On Tripod', 'black', 'Up', 13, 12, mirror=False)    # in the centre aisle, before the seats
sit('aud/stage-w', *EAMES, 'Right', 9, 10, mirror=False)    # a panel talk: two guests either side of the lectern
sit('aud/stage-e', *EAMES, 'Left', 16, 10, mirror=False)
for side, x, drink in (('w', 9, ('Mug (Regular)', 'green')), ('e', 16, ('Hydroflask', 'teal'))):
    put(f'aud/stage-{side}-table', 'Mid Century Side Table', 'black', 'Down', x, 11, mirror=False)
    on(f'aud/stage-{side}-table', f'aud/stage-{side}-drink', *drink, 'Down', mirror=False)

# Meeting rooms: two joined 2x3 oak tables for ten, screen and whiteboard on the wall, a plant.
for room, t in (('meeting_01', 30), ('meeting_02', 39)):
    y0 = t + 2
    put(f'{room}/table-a', 'Conference Table 2x3', 'lightcoffee', 'Down', 10, y0 + 2, mirror=False)
    put(f'{room}/table-b', 'Conference Table 2x3', 'lightcoffee', 'Down', 13, y0 + 2, mirror=False)
    for c in (11, 12, 13, 14):
        sit(f'{room}/n{c}', *EAMES, 'Down', c, y0 + 1, mirror=False)
        sit(f'{room}/s{c}', *EAMES, 'Up', c, y0 + 4, mirror=False)
    sit(f'{room}/w', *EAMES, 'Right', 9, y0 + 2, mirror=False)
    sit(f'{room}/e', *EAMES, 'Left', 16, y0 + 2, mirror=False)
    # a room in use (the owner's Gather references): a laptop, an open book and papers on the table, files with a
    # globe in the bottom corner (in the top one the globe would cover the pictures), a flipchart by the whiteboard,
    # a floor lamp
    on(f'{room}/table-a', f'{room}/laptop', 'Laptop Computer', 'grey', 'Down', dx=-26, mirror=False)
    on(f'{room}/table-b', f'{room}/book', 'Book (Open)', 'darkbrown', 'Down', dx=-18, mirror=False)
    on(f'{room}/table-b', f'{room}/papers', 'Document (Stack)', 'white', 'Down', dx=26, mirror=False)
    put(f'{room}/files', 'Filing Cabinet', 'grey', 'Down', 6, y0 + 4, mirror=False)
    on(f'{room}/files', f'{room}/globe', 'Globe', 'lightblue', 'Down', mirror=False)
    put(f'{room}/easel', 'Poster Easel', 'white', 'Down', 17, t + 1, mirror=False)
    put(f'{room}/floor-lamp', 'Fringe Floor Lamp', 'black', 'Down', 18, y0 + 4, mirror=False)
    put(f'{room}/screen', 'Television Screen (Wall)', 'grey', 'Down', 11, t, px=16, mirror=False)
    put(f'{room}/board', 'Whiteboard (Wall-mounted)', 'white', 'Down', 15, t, mirror=False)
    put(f'{room}/plant', 'Monstera', PLANT_POT, 'Down', 7, y0 + 4, mirror=False)
    on(f'{room}/table-a', f'{room}/phone', 'Conference Phone', 'white', 'Down', dx=48, mirror=False)

# Focus booths: one workstation each; the top row opens to the north corridor, the bottom row to the south.
for key, (x0, y0, x1, y1) in BOOTHS.items():
    if key[-1] in '123':
        workstation(f'{key}/ws', BOOTH_DESK[key], y0 + 1, facing='down', mirror=False)
    else:
        workstation(f'{key}/ws', BOOTH_DESK[key], y0, facing='up', mirror=False)

# Open work wings: two rows of four workstations on a petrol carpet, per side.
for row, y in enumerate((31, 35)):
    for i in range(4):
        workstation(f'wing/ws{row}{i}', 22 + 3 * i, y)
put('wing/plant-a', 'Snake Plant', PLANT_POT, 'Down', 21, 29)
put('wing/plant-b', 'Snake Plant', PLANT_POT, 'Down', 34, 29)
put('wing/cooler', 'Water Cooler', 'white', 'Down', 34, 36)

# Around the pool: the catalogue's ground plants (ferns, hostas, echinacea; none of them blocks) along the lake's sides and
# at the canal mouth, so the bank's planting spills onto the walkways.
POOL_PLANTS = [((36, 24), 'Fern', 'green'), ((35, 27), 'Hosta', 'green'), ((36, 30), 'Echinacea', 'pink'),
               ((35, 33), 'Fern', 'green'), ((36, 35), 'Hosta', 'green'), ((38, 37), 'Hosta', 'green'),
               ((41, 37), 'Echinacea', 'yellow'),
               ((40, 20), 'Echinacea', 'white'), ((40, 23), 'Fern', 'green'),   # framing the bridge's ends
               ((38, 23), 'Hosta', 'green'), ((38, 20), 'Fern', 'green')]
for (x, y), kind, colour in POOL_PLANTS:
    put(f'pool/{kind.lower()}-{x}-{y}', kind, colour, 'Down', x, y)

# Reception: the feature wall with the logo, the desk facing the entrance, the K mat, totems outside, planters by the
# glass and a lounge with a rug on each side of the desk (plus the waiting lounges further out).
put('reception/desk', 'Koncluí: reception desk', 'oak', 'Down', AXIS - 2, 42, mirror=False)
on('reception/desk', 'reception/pc', *PC, 'Up', dx=-28, mirror=False)
on('reception/desk', 'reception/orchid', 'Ceramic Planter', 'white', 'Down', dx=50, mirror=False)
sit('reception/chair', *CHAIR, 'Down', AXIS, 41, mirror=False)
put('reception/mat', 'Koncluí: entrance mat', 'ink', 'Down', AXIS - 1, 46, mirror=False)
put('reception/totem', 'Koncluí: logo totem', 'ink', 'Down', AXIS - 3, BY1 + 1)
put('reception/planter', 'Koncluí: planter', 'white', 'Down', AXIS - 5, 46)
put('reception/rug', 'Koncluí: rug 5x3', 'mist', 'Down', 32, 42)
sit('reception/sofa-n', 'Knoll Couch', 'ds-petrol', 'Down', 34, 42)
sit('reception/sofa-s', 'Knoll Couch', 'ds-petrol', 'Up', 34, 44)
put('reception/table', 'Round Coffee Table', 'white', 'Down', 34, 43)
on('reception/table', 'reception/table-plant', 'Ceramic Planter', 'white', 'Down')
sit('reception/arm', 'Knoll Armchair', 'white', 'Left', 37, 43)
put('reception/plant', 'Bird of Paradise (Green)', PLANT_POT, 'Down', 32, 40)
put('reception/lamp', 'Arc Lamp', 'black', 'Down', 36, 40)
# The sales bell (owner, 20/10/2026: "Esquecemos de colocar o sino das vendas aqui no ambiente"): right of the desk, in
# front of the feature wall, seen from the entrance; Space in its area rings it for everyone (runtime/bell.mjs).
BELL_TILE = (AXIS + 4, 40)
BELL_AREA = (AXIS + 3, 40, AXIS + 5, 42)    # inclusive tiles round the bell, clear of the receptionist's chair
put('reception/bell', 'Koncluí: sino da venda', 'ouro', 'Down', *BELL_TILE, mirror=False)
# The lounges as the owner's Gather reference (18/10/2026, "isso aqui mesmo é lindo"): on a 7 x 7 terracotta tile
# square (ZONES), a graphite couch and armchair facing in at the top, the same pair the other way round at the bottom,
# a round wooden coffee table with two small plants, a side table with notebooks, a monstera at each corner.
for x, y in ((22, 40), (28, 40), (22, 46), (28, 46)):          # the plant's picture is 3 tiles wide: centred on x + 1
    put(f'lounge/plant-{x}-{y}', 'Monstera', PLANT_POT, 'Down', x, y)
sit('lounge/sofa-n', 'LeCorbusier Couch', 'black', 'Down', 25, 42)
sit('lounge/arm-n', 'LeCorbusier Armchair', 'black', 'Down', 27, 42)
put('lounge/table', 'Round Coffee Table', 'coffee', 'Down', 24, 43)
on('lounge/table', 'lounge/table-plant', 'Ceramic Planter', 'white', 'Down', dx=12)
on('lounge/table', 'lounge/table-sprout', 'Sprout', 'green', 'Down', dx=-12)
put('lounge/side', 'Mid Century Side Table', 'lightcoffee', 'Down', 28, 44)
on('lounge/side', 'lounge/side-notes', 'Notebook (Closed)', 'green', 'Down')
sit('lounge/arm-s', 'LeCorbusier Armchair', 'black', 'Up', 24, 46)
sit('lounge/sofa-s', 'LeCorbusier Couch', 'black', 'Up', 26, 46)
put('lounge/lamp', 'Arc Lamp', 'black', 'Down', 21, 46)
put('lounge/books', 'Estante 6', '#ffffff', 'Down', 30, 40)    # a bookcase at the lounge's corner (sheets.py)

# Hall: plants against the team rooms' glass between the doors.
for x in (20, 29, 31, 40):
    put(f'hall/plant{x}', 'Fiddle-leaf Fig', PLANT_POT, 'Down', x, 18)

# Cafe: white kitchen along the north wall, oak dining tables, then a lounge with games.
for i, x in enumerate((68, 70, 72, 74)):
    put(f'cafe/counter{i}', 'Kitchen Cabinet (Large)', 'white', 'Down', x, 8, mirror=False)
on('cafe/counter0', 'cafe/espresso', 'Espresso Machine', 'black', 'Down', mirror=False)
on('cafe/counter1', 'cafe/coffee', 'Single Coffee Machine', 'white', 'Down', dx=-10, mirror=False)
on('cafe/counter1', 'cafe/mug', 'Mug (Wide)', 'white', 'Down', dx=12, mirror=False)
on('cafe/counter3', 'cafe/fruit', 'Berry Basket', 'red', 'Down', mirror=False)
put('cafe/fridge', 'Fridge', 'grey', 'Down', 76, 7, mirror=False)
put('cafe/cooler', 'Water Cooler', 'white', 'Down', 79, 7, mirror=False)
# Each pair of tables its own chair (white, oak, black) and real food on them, Brazilian among it (owner's Gather
# references, 18/10/2026: spaces populated in a way that makes sense).
CAFE_CHAIRS = [('Cafe Chair', 'white'), ('Wabi Sabi Chair', 'lightcoffee'), ('Cafe Chair', 'black')]
CAFE_FOOD = [[('Coxinha', 'white', -14), ('Teacup', 'white', 14)], [('Pizza', 'brown', 0)],
             [('Açai Bowl', 'purple', -14), ('Ceramic Planter', 'white', 14)],
             [('Box of Donuts', 'orange', -10), ('Coffee Pot', 'black', 16)],
             [('Salad', 'teal', -12), ('Sushi Tray', 'lightcoffee', 14)], [('Ceramic Planter', 'white', 0)]]
for i, (x, y) in enumerate(((69, 12), (75, 12), (69, 18), (75, 18), (69, 24), (75, 24))):
    put(f'cafe/table{i}', 'Octagonal Table 2x3', 'lightcoffee', 'Down', x, y, mirror=False)
    for c in range(3):
        sit(f'cafe/table{i}/n{c}', *CAFE_CHAIRS[i // 2], 'Down', x + c, y - 1, mirror=False)
        sit(f'cafe/table{i}/s{c}', *CAFE_CHAIRS[i // 2], 'Up', x + c, y + 2, mirror=False)
    for k, (type_, colour, dx) in enumerate(CAFE_FOOD[i]):
        on(f'cafe/table{i}', f'cafe/table{i}/food{k}', type_, colour, 'Down', dx=dx, mirror=False)
# oak bookcases between the dining tables and the lounge, a plant and a bust on them
for key, x, (type_, colour) in (('books-w', 70, ('Small potted Hosta', 'green')),
                                ('books-e', 75, ('Marble Bust (Female)', 'white'))):
    put(f'cafe/{key}', 'Bookcase (Medium)', 'lightcoffee', 'Down', x, 28, mirror=False)
    on(f'cafe/{key}', f'cafe/{key}/top', type_, colour, 'Down', mirror=False)
put('cafe/plants', 'Plant Shelf', 'white', 'Down', 78, 27, mirror=False)
# The lounge and games room (owner, 20/10/2026: "muito triste", "pra deixar incrível"; dream loop on the target in
# .dream-loop/jogos/): no wall of its own in view, so a freestanding navy panel with the neon wave and two brand
# pictures over a long credenza closes the back, a bar with stools by the vending corner, a lounge on a lattice rug
# between two couches with cushions and lamps, and a navy carpet under the games with a pendant over the pool table.
# Row 30 stays a walkway between the café and both sides of the panel (the bookcases block row 29, the panel 31 and
# the credenza 32), and columns 78-80 stay open beside the credenza.
put('cafe/panel', 'Koncluí: painel', 'navy', 'Down', 71, 30, mirror=False)   # with its two pictures (lounge.py)
put('cafe/neon', 'Koncluí: neon', 'ondas', 'Down', 73, 30, px=24, py=-1, mirror=False)
put('cafe/credenza', 'Koncluí: aparador', 'teca', 'Down', 71, 31, mirror=False)
# the credenza, the bar, the couches and the tables carry what stands on them in their own pictures: each texture
# costs draw calls in every frame (lounge.py, dressed pieces)
# the bar along the vending corner, three stools before it
put('cafe/bar', 'Koncluí: balcão de bar', 'teca', 'Down', 68, 34, mirror=False)
for i in range(3):
    sit(f'cafe/stool{i}', 'Koncluí: banqueta', 'turquesa', 'Up', 68 + i, 36, mirror=False)
# the lounge: two couches facing over the coffee table, a lamp on a side table at each couch's left end
# the lower couch faces the games, its back to the coffee table (a front view, as the target draws both)
sit('cafe/sofa-n', 'Koncluí: sofá', 'manta', 'Down', 74, 34, mirror=False)
sit('cafe/sofa-s', 'Koncluí: sofá', 'almofadas', 'Down', 74, 38, mirror=False)
for key, y, kind, s in (('side-n', 33, 'alto', 50), ('side-s', 37, 'baixo', 43)):   # the nightstand on (72, y + 1)
    put(f'cafe/{key}', 'Koncluí: criado-mudo', kind, 'Down', 70, y, mirror=False)            # with its lamp's day pool
    on(f'cafe/{key}', f'cafe/{key}/lamp', 'Koncluí: luminária de mesa', 'creme', 'Down', dx=16, s=s, mirror=False)
put('cafe/coffee-table', 'Koncluí: mesa de centro', 'branca', 'Down', 73, 35, mirror=False)   # with the chessboard
put('cafe/lamp', 'Koncluí: luminária de arco', 'preto', 'Down', 76, 34, px=21, py=20, mirror=False)
put('cafe/guitar', 'Guitar', 'lightcoffee', 'Down', 77, 33, px=10, py=0, mirror=False)
put('cafe/plant-stand', 'Koncluí: banco de plantas', 'teca', 'Down', 76, 33, px=14, py=23, mirror=False)
# a vending corner by the café's glass (Modern Office, sheets.py): snacks and a drinks fridge, bottoms on one line
put('cafe/vending', 'Máquina de lanches', 'dimgrey', 'Down', 68, 33, mirror=False)
put('cafe/drinks', 'Geladeira de bebidas', 'dimgrey', 'Down', 70, 32, mirror=False)
# tall plants at the corners and either side of the lounge, drawn at the size the room asks for (lounge.py: no
# catalogue plant is this tall); x, y and px, py put each pot where the target measures it
BIRD, MONSTERA = ('Koncluí: planta ave-do-paraíso', 'branco'), ('Koncluí: planta costela-de-adão', 'branco')
for key, kind, x, y, px, py in (('palm0', BIRD, 68, 29, 5, 12), ('palm-ne', BIRD, 79, 29, 3, 20),
                                ('palm-e', (BIRD[0], 'alta'), 78, 33, 29, 10),
                                ('palm1', MONSTERA, 67, 43, 34, 23), ('palm-se', (BIRD[0], 'alta'), 79, 43, 4, 23)):
    put(f'cafe/{key}', *kind, 'Down', x, y, px=px, py=py, mirror=False)
put('cafe/palm-w', 'Koncluí: planta aglaonema', 'branco', 'Down', 70, 36, px=16, py=23, mirror=False)   # by the piano
# the games corner on its carpet: ping-pong and foosball on the left, the pool table under a pendant, a bank of four
# arcades along the top right (one game each), the cue rack and dartboard left of the pendant, beanbags and a little
# table before the arcades; every game has its terminal (owner, 20/10/2026: "ter todos terminais lá"): the four
# arcades, the ping-pong and pool tables, an air-hockey table and the piano either side of the lounge, a chessboard on
# the coffee table and a connect-four rack on a small table in the aisle. Seats stay out of every terminal's spot, so
# SPACE there only stands a seated person up.
put('cafe/carpet', 'Koncluí: carpete de jogos', 'navy', 'Down', 68, 40, px=22, py=2, mirror=False)
put('cafe/pingpong', 'Ping Pong Table', 'white', 'Down', 70, 41, mirror=False)
put('cafe/foosball', 'Koncluí: pebolim', 'verde', 'Down', 70, 43, mirror=False)   # the catalogue's, 15 px higher
put('cafe/pool', 'Pool Table', 'green', 'Down', 74, 42, mirror=False)
put('cafe/pendant', 'Koncluí: pendente', 'preto', 'Down', 74, 40, px=5, py=-2, mirror=False)
put('cafe/cues', 'Koncluí: tacos', 'escuro', 'Down', 72, 40, mirror=False)        # the cue rack and the dartboard
put('cafe/arcade-flappy', 'Arcade Machine', 'green', 'Down', 77, 40, mirror=False)
put('cafe/arcade-breakout', 'Koncluí: fliperama breakout', 'turquesa', 'Down', 78, 40, mirror=False)
put('cafe/arcade', 'Koncluí: fliperama tetris', 'cor', 'Down', 79, 40, mirror=False)     # the white one, recoloured
put('cafe/arcade-2048', 'Koncluí: fliperama 2048', 'cor', 'Down', 80, 40, mirror=False)
sit('cafe/beanbag-a', 'Koncluí: pufe', 'par', 'Down', 77, 44, mirror=False)        # grey here, mint at (78, 45)
put('cafe/game-table', 'Koncluí: mesinha', 'nogueira', 'Down', 78, 42, px=8, py=30, mirror=False)
put('cafe/lig4-table', 'Koncluí: mesa com lig 4', 'clara', 'Down', 72, 44, mirror=False)
put('cafe/airhockey', 'Koncluí: air hockey', 'navy', 'Down', 78, 37, mirror=False)
# the daytime pools of the lamps' light are drawn with the lamps and, the pendant's, with the carpet (lounge.py)
put('cafe/piano', 'Upright Piano', 'black', 'Down', 69, 37, mirror=False)

# Facades: bushes along the south glass, trees on the lawn.
for x in (8, 14, 22, 28, 34):
    put(f'facade/bush{x}', 'Rose Bush', 'white', 'Down', x, BY1 + 2)
TREES = [((1, 3), 'Maple Tree'), ((2, 14), 'Pine Tree (Large)'), ((1, 24), 'Birch Tree'), ((2, 35), 'Pine Tree (Small)'),
         ((1, 44), 'Maple Tree'), ((10, 0), 'Birch Tree'), ((21, 1), 'Pine Tree (Small)'), ((31, 0), 'Maple Tree'),
         ((17, 50), 'Pine Tree (Large)'), ((27, 50), 'Pine Tree (Small)'), ((4, 50), 'Birch Tree')]
for (x, y), kind in TREES:
    put(f'lawn/tree-{x}-{y}', kind, 'green', 'Down', x, y)
# A garden on each side of the entrance: a picnic table, and two Adirondack chairs facing over a tree-trunk table
put('garden/picnic', 'Picnic Table', 'coffee', 'Down', 10, 52)
sit('garden/chair-w', 'Adirondack Chair', 'lightcoffee', 'Right', 31, 53)
put('garden/trunk', 'Tree Trunk Coffee Table', 'brown', 'Down', 32, 53)
sit('garden/chair-e', 'Adirondack Chair', 'lightcoffee', 'Left', 34, 53)

# ------------------------------------------------------------------------------------------------ life
# Art, rugs and plants all over (owner, 18/10/2026: "mais vida no escritório inteiro").
# Framed pictures of the brand, of Koru and of the restaurants Koncluí serves (owner, 18/10/2026; frames.py). Each
# hangs from its canvas; x, px put its frame where the walls measured free: meeting rooms, a pair of the large size
# centred left of the TV; booths, centred on each; auditorium, in the 40 px each side of the screen; reception, the
# large size under the outer spotlights of the feature wall; café, in the band above the counter.
FRAMED = lambda art: f'Koncluí: quadro {art}'
for room, t, arts in (('meeting_01', 30, ('icp-cozinha', 'icp-salao')), ('meeting_02', 39, ('icp-gestor', 'icp-equipe'))):
    put(f'{room}/rug', 'Koncluí: rug 10x5', 'mist', 'Down', 8, t + 3, mirror=False)
    put(f'{room}/art', FRAMED(arts[0]), 'ink', 'Down', 6, t, px=19, mirror=False)
    put(f'{room}/art2', FRAMED(arts[1]), 'ink', 'Down', 9, t, px=3, mirror=False)
    put(f'{room}/clock', 'Wall Clock (Minimal Face)', 'teal', 'Down', 18, t, mirror=False)
for i, x in enumerate((6, 17)):                          # acoustic panels either side of the stage screen
    put(f'aud/panel{i}', 'Acoustic Panels', 'teal', 'Down', x, BY0, mirror=False)
put('aud/frame-w', FRAMED('koru-apresentando'), 'ink', 'Down', 7, BY0, px=12, mirror=False)
put('aud/frame-e', FRAMED('koru-comemorando'), 'ink', 'Down', 15, BY0, px=20, mirror=False)
BOOTH_ART = {'booth_a4': 'marca-k', 'booth_b4': 'koru-checklist', 'booth_a5': 'marca-palavra', 'booth_b5': 'icp-prato',
             'booth_a6': 'koru-notebook', 'booth_b6': 'marca-k-menta'}
for key, art in BOOTH_ART.items():                       # the bottom booths' wall, one picture each
    put(f'{key}/art', FRAMED(art), 'ink', 'Down', BOOTHS[key][0] + 1, 24, mirror=False)
put('reception/frame-w', FRAMED('koru-acenando'), 'ink', 'Down', 38, 38, px=4, mirror=False)
put('reception/frame-e', FRAMED('icp-fachada'), 'ink', 'Down', 46, 38, px=26, mirror=False)
put('cafe/frame-w', FRAMED('koru-cafe'), 'ink', 'Down', 70, BY0 - 1, px=6, py=20, mirror=False)
put('cafe/frame-e', FRAMED('icp-cafe'), 'ink', 'Down', 78, BY0 - 1, px=9, py=20, mirror=False)
put('cafe/shelf', 'Floating Bookshelf', 'lightcoffee', 'Down', 68, BY0, mirror=False)
put('cafe/clock', 'Wall Clock (Minimal Face)', 'green', 'Down', 72, BY0, mirror=False)
put('cafe/wall-plant', 'Wall Plant Small', 'white', 'Down', 73, BY0, px=8, mirror=False)
put('cafe/rug', 'Koncluí: tapete 6x3', 'losangos', 'Down', 71, 35, px=22, py=2, mirror=False)
for room, l in (('room_01', 19), ('room_02', 30)):    # a tall plant by the facade glass in every team room
    put(f'{room}/corner', 'Bird of Paradise (Green)', PLANT_POT, 'Down', l, 7)
for i, (x, y) in enumerate(((20, 20), (20, 39), (34, 46))):
    put(f'hall/big-plant{i}', 'Bird of Paradise (Blooming)', PLANT_POT, 'Down', x, y)
# outside: benches facing the entrance path, flower beds
sit('lawn/bench', 'Park Bench', 'lightcoffee', 'Right', AXIS - 3, 53)
for i, (x, y, colour) in enumerate(((AXIS - 3, 51, 'pink'), (AXIS - 4, 54, 'white'), (AXIS - 5, 52, 'yellow'),
                                     (AXIS - 3, 55, 'pink'))):
    put(f'lawn/flowers{i}', 'Echinacea', colour, 'Down', x, y)

START = (AXIS, 52)                       # arrival tile, on the path outside the entrance

# ------------------------------------------------------------------------------------------------ interactions
# Objects you can use (runtime/interactions.mjs, build.py): the game each object opens (pages of
# map/campus_web/games), the whiteboards (a shared Excalidraw board per room, on SPACE), room capacities.
# Listed order breaks a tie between two terminals' spots (runtime/interactions.mjs spotAt): row 39 is as near the
# air-hockey table's front as the arcades' backs, and belongs to the table.
GAMES = {'cafe/airhockey': ('airhockey', 'air hockey'), 'cafe/piano': ('piano', 'piano'),
         'cafe/coffee-table': ('xadrez', 'xadrez'), 'cafe/lig4-table': ('lig4', 'Lig 4'),
         'cafe/arcade': ('tetris', 'Tetris'), 'cafe/arcade-breakout': ('breakout', 'Breakout'),
         'cafe/arcade-flappy': ('flappy', 'Flappy Koru'), 'cafe/arcade-2048': ('2048', '2048'),
         'cafe/pingpong': ('pingpong', 'pingue-pongue'), 'cafe/pool': ('sinuca', 'sinuca')}
WHITEBOARDS = {'meeting_01/board': 'Quadro da Reunião 01', 'meeting_02/board': 'Quadro da Reunião 02'}
CAPACITY = {'meeting_01': 10, 'meeting_02': 10, **{f'room_0{n}': 12 for n in range(1, 5)}, **{k: 1 for k in BOOTHS}}
GAME_VARIABLES = ['mesaSinuca', 'mesaXadrez', 'mesaLig4', 'recordesPong', 'recordesAirHockey', 'recordes2048',
                  'recordesTetris', 'recordesBreakout', 'recordesFlappy']
