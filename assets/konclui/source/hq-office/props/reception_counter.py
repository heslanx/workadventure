"""The reception counter "Balcão de recepção Koncluí" as a volume recipe: true dimensions, every face drawn from them.

A 5.0 m long counter on a 5 x 1 tile footprint, in two levels, the way a real reception desk is built:

    transaction ledge  0.31 m deep (10 px), top at 1.05 m (22 px): where the visitor leans. Its front is the counter's face:
                       a 0.10 m oak lip that overhangs the body by 2 px at each end, the reeded body, a 1 px dark oak base. The face is 22 px tall (the owner's counter
                       anchor is 22 px: seat 10, desk 16, counter 22, door 42); the drawing it replaces was 36 px, a navy slab
    working desk       a box behind the ledge: 0.31 m deep (10 px), top at 0.86 m (18 px), its front edge at y = 12 px and the
                       ledge's back edge at y = 22, so 10 px of floor between them that the ledge hides; 4 px shorter than the
                       ledge at each end. Where the receptionist works and where the computer stands. In the picture it shows
                       what every other piece shows, a top face (10 rows) and a front face (6 rows above the ledge's back edge,
                       the rest is behind the ledge): a mid oak (#A47B54, 44 of luminance under the top's #C6AB8B; the office desks and armchairs
                       use about 50 between their top and front) with two darker panel seams, outlined in its own dark tone where it
                       meets the ledge. The top's board joint is a tone between the two, so the only dark band is the front.
                       Before, the desk was flush against the ledge and 2 px lower, so the ledge hid all of its
                       front and the desk was one flat taupe rectangle with no thickness (owner, 2026-11-24: "I cannot tell if it
                       is a bridge, a rug, a wall"). The oblique projection draws no end faces, so the thickness is the front
                       face and the outline. The chair behind it is seen down to the desk's back edge (row 16 of the picture)
                       and the computer's foot stands on its top face (SURFACE_ROW).

The whole is 0.69 m deep (22 px: the desk's back edge to the ledge's front, the floor between them counted once) and stands on the front tile of the 2-tile-high picture: its base front edge is the picture's
last row, so the footprint is the lower tile row; the 22 px of face, the ledge and the working desk rise above it (oblique:
height is drawn straight up). A visitor stands on the tile in front, and the avatar's head (18 of its 32 rows) reaches 16 px up
the face when the body touches the counter: the K sits in the upper part of the panel, but a visitor centred on the counter
still covers it (see the study's note on a stand-off row).

The face: oak end posts, reeded oak (a 3 px reed with a light edge and a shaded edge, a 1 px groove) left and right of a 60 px
navy panel with a 1 px brass frame on its sides, a 1 px line of the brand turquoise across its top (the wordmark's line) and the
Koncluí K, 15 px tall, in white: the logo's K (kmark.K_PLAQUE: the stem fused with the arm, the leg set off by a one-pixel diagonal gap, the foot set off by a one-pixel gap). The K is the only white or bright-brand pixel group of the face, which is what the light
declaration for a sign (fx.py, kind 'sign') reads: the line is the turquoise step office.hex holds at 02A8A6, one step under
that reading's threshold, so the sign's light and its glow stay on the K. The base is dark oak, 1 px: the runtime casts the
shadow, the picture paints none. The ledge's top carries a thin brass inlay a pixel in from its edge (as the bell's brass)
and a few hand-placed seams, butt joints and glints; the working desk's top is a step darker. The ledge fills the picture's width, so its
two end columns are the canvas edge: they are drawn in the face's dark oak (LEDGE_ENDS), an ink of the piece, which is what
tools/contract.py asks of a solid run on the edge; the rest of the ledge's outline stays the mid oak.

Palette: the ledge's and the desk's top and lip tones, the white (kmark.WHITE, the palette's step nearest the logo's #FBFBFB), the navy panel, the turquoise and the white are tones of
tools/palettes/office.hex; the face's mid oak (the feature wall's own ramp behind the counter), the grooves, the outlines, the
dark oak base, the desk's front face and the brass are not in the file (office.hex has no mid or dark wood and no metal).

Everything is authored in px/32 and px/21 so that every edge lands on a pixel boundary: tools/projection.json gives the scales.
"""
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))
_HQ = Path(__file__).resolve().parents[1]
if str(_HQ) not in sys.path:
    sys.path.insert(0, str(_HQ))

import numpy as np  # noqa: E402
import kmark  # noqa: E402
import volume as V  # noqa: E402

NAME = 'reception_counter'

X = 1 / 32                          # one ground px
Z = 1 / 21                          # one height px
W_PX = 160                          # 5 tiles
LEDGE_Z, LEDGE_Y0 = 22, 22          # ledge top height (px) and the y (px) where it starts, the front edge being y = 32
DESK_Z, DESK_Y0, DESK_Y1 = 18, 2, 12  # working desk top height, its back edge and its front edge (ground px; the footprint's front edge is y = 32)
DESK_X0 = 4                         # the desk's left edge, px: 4 px shorter than the ledge at each end
FRONT_SEAMS = (54, 105)             # the two seams of the desk's front, px: three equal panels
PC_FOOT_Y = 10                      # where the computer's foot stands on the desk top, ground px (its back edge is DESK_Y0)
PIC_ROWS = 64                       # the two-tile picture the counter is drawn into, bottom aligned
SURFACE_ROW = PIC_ROWS - 32 + PC_FOOT_Y - DESK_Z      # that point's row in the picture: the surface value of the piece
LIP_Z = 20                          # the oak lip is z 20 .. 22
PLINTH_Z = 1

PANEL_X0, PANEL_X1 = 50, 109        # the ink panel, x px inclusive (60 px, centred on the counter); brass frames it at 49 and 110
BODY_X0 = 2                         # the face's body is inset 2 px each end: the top overhangs it
K_COL0 = 73
K_ROW0 = 2                          # the K's first row, counted from the panel's top (the lip's underside)

OAK = ('#8C6646', '#B88F66', '#C6AB8B', '#D9BA95', '#E8CCA8')       # the ledge: lip is [3], top is [4]; [2..4] are office.hex tones
SLAT = ('#4F3622', '#6F4B30', '#8C6646', '#B88F66', '#CFAA80')      # the face's slats: face is [3], the reed's light [4] and shade [2]
DESK = ('#7A5636', '#8F6A47', '#A47B54', '#C6AB8B')                   # the working desk, a ramp of four: ink [0], front seams [1], front face [2], top [3] (a palette step)
DESK_TOP_SEAM = '#B39571'                                               # the top's board joint: between the top's tone and the front's, so the only dark band is the front
PLINTH = ('#3B281A', '#4F3622', '#5E412A')                              # dark oak: a base that is wood, not a painted shadow bar
NAVY_PANEL = '#0D184F'
NAVY_EDGE = '#1B2A6B'
WHITE = kmark.WHITE
MINT = '#53FFC8'

# the K of the brand icon, 15 x 15 (kmark.K_PLAQUE; tools/test_kmark.py measures it against the official vector)
K = kmark.K_PLAQUE


def _south_mask(x0_px, x1_px, rows=None, cols=None, ox=0):
    """A mask of the south face over columns x0..x1 (px inclusive) and, when given, rows (j from the top edge, 21 per metre)."""
    def mask(a, b):
        i = np.floor(a / X + 1e-6).astype(int) + ox
        out = (i >= x0_px) & (i <= x1_px)
        if rows is not None:
            j = np.floor(b / Z + 1e-6).astype(int)
            out &= (j >= rows[0]) & (j <= rows[1])
        if cols is not None:
            out &= cols(i)
        return out
    return mask


def _k_mask(col0, row0, ox=0):
    grid = np.array([[c == '#' for c in r] for r in K])

    def mask(a, b):
        i = np.floor(a / X + 1e-6).astype(int) + ox - col0
        j = np.floor(b / Z + 1e-6).astype(int) - row0
        ok = (i >= 0) & (i < grid.shape[1]) & (j >= 0) & (j < grid.shape[0])
        out = np.zeros(a.shape, bool)
        out[ok] = grid[j[ok], i[ok]]
        return out
    return mask


BRASS = ('#6B430F', '#A36A17', '#D69A2A', '#E8B53F')
CYAN = '#02A8A6'                    # the brand turquoise's own office.hex step: under fx.py's glyph threshold, so the sign light keeps reading the K alone


def materials():
    return {
        'oak': V.Material('oak', OAK, ink=OAK[0]),
        'slat': V.Material('slat', SLAT, ink=SLAT[0]),
        'desk': V.Material('desk', DESK, ink=DESK[0]),
        'plinth': V.Material('plinth', PLINTH, ink=PLINTH[0]),
        'gap': V.flat_material('gap', SLAT[1], ink=SLAT[0]),
        'seam': V.flat_material('seam', OAK[2], ink=OAK[0]),
        'plank': V.flat_material('plank', OAK[3], ink=OAK[0]),
        'desk-seam': V.flat_material('desk-seam', DESK_TOP_SEAM, ink=DESK[0]),
        'desk-front-seam': V.flat_material('desk-front-seam', DESK[1], ink=DESK[0]),
        'panel': V.flat_material('panel', NAVY_PANEL, ink=SLAT[0]),
        'panel-edge': V.flat_material('panel-edge', NAVY_EDGE, ink=SLAT[0]),
        'brass': V.flat_material('brass', BRASS[2], ink=SLAT[0]),
        'cyan': V.flat_material('cyan', CYAN, ink=SLAT[0]),
        'inlay': V.flat_material('inlay', BRASS[2], ink=OAK[0]),
        'glint': V.flat_material('glint', '#F0D6B2', ink=OAK[0]),
        'end': V.flat_material('end', OAK[0], ink=SLAT[0]),
        'post': V.flat_material('post', SLAT[4], ink=SLAT[0]),
        'reed-hi': V.flat_material('reed-hi', SLAT[4], ink=SLAT[0]),
        'reed-lo': V.flat_material('reed-lo', SLAT[2], ink=SLAT[0]),
        'k': V.flat_material('k', WHITE, ink=SLAT[0], detail=True),
    }


def _top_marks(h=(), v=(), mat=None):
    """Hand-placed marks on a top, in ground px from its back-left corner: h = (row, x0, x1) runs along the board, v = (x, row0,
    row1) a butt joint across it. No two marks touch."""
    def mask(a, b):
        j = np.floor(b / X + 1e-6).astype(int)
        i = np.floor(a / X + 1e-6).astype(int)
        out = np.zeros(a.shape, bool)
        for row, x0, x1 in h:
            out |= (j == row) & (i >= x0) & (i <= x1)
        for x, r0, r1 in v:
            out |= (i == x) & (j >= r0) & (j <= r1)
        return out
    return V.Decal('top', mat, mask)


# The ledge's top is two boards along the counter (a seam at row 4) with their butt joints staggered, a brass inlay a pixel in
# from the front edge, and a few glints where the light would catch the grain; the working desk's top is two boards the same way.
LEDGE_GRAIN = [
    _top_marks(h=[(4, 0, W_PX - 1)], v=[(46, 1, 3), (127, 1, 3), (86, 5, 7)], mat='seam'),
    _top_marks(h=[(8, 4, W_PX - 5)], mat='inlay'),
    _top_marks(h=[(1, 20, 24), (2, 100, 103), (6, 30, 34), (6, 132, 135)], mat='glint'),
]
# The ledge's two end columns (px 0 and px W_PX - 1, on its top and its lip) are its silhouette on the picture's own left and right
# edge (5.0 m on a 5 tile picture), so they are drawn in the face's dark oak, an ink of the piece, and not in the ledge's mid oak:
# tools/contract.py edge_touch reads a solid run on the canvas edge as a cut picture unless it is ink. Those two columns are the whole
# of it (10 px each at the pixel size); the ledge's other outlines keep the mid oak.
def _ledge_ends(a, b):
    return np.isin(np.floor(a / X + 1e-6).astype(int), (0, W_PX - 1))


LEDGE_ENDS = [V.Decal('top', 'end', _ledge_ends), V.Decal('south', 'end', _ledge_ends)]
DESK_GRAIN = [
    _top_marks(h=[(5, 0, W_PX - 9)], v=[(58, 0, 4), (118, 6, 9)], mat='desk-seam'),
    _top_marks(h=[(2, 24, 28), (7, 70, 74), (3, 134, 137)], mat='glint'),
]


def _front_seams(xs):
    """The desk's front panels: a one-pixel darker line at each x (absolute px), the full height of the face."""
    def mask(a, b):
        i = np.floor(a / X + 1e-6).astype(int) + DESK_X0
        return np.isin(i, xs)
    return V.Decal('south', 'desk-front-seam', mask)


def recipe():
    """Four stacked boxes, every edge on a pixel: the working desk (inset 4 px, set back behind the ledge), the ledge's top and lip (the full 5.0 m), the
    face's body (inset 2 px: the top overhangs it) and the plinth (inset 3 px)."""
    W = W_PX * X
    y_front = 32 * X
    face_top = LIP_Z * Z
    B0 = BODY_X0                                                   # the body's left edge, px: its decals are in absolute px
    post = 6                                                       # the end posts, px
    gap_l, gap_r = BODY_X0 + post, PANEL_X1 + 2                     # the first reed gap of each zone

    def reeds(phase):
        def cols(i):
            left = (i >= gap_l) & (i <= PANEL_X0 - 2) & ((i - gap_l) % 4 == phase)
            right = (i >= gap_r) & (i <= W_PX - B0 - post - 1) & ((i - gap_r) % 4 == phase)
            return left | right
        return cols
    m = lambda x0, x1, **kw: _south_mask(x0, x1, ox=B0, **kw)
    face = [
        V.Decal('south', 'post', m(B0, B0 + post - 1)),
        V.Decal('south', 'post', m(W_PX - B0 - post, W_PX - B0 - 1)),
        V.Decal('south', 'gap', m(0, W_PX, cols=reeds(0))),
        V.Decal('south', 'reed-hi', m(0, W_PX, cols=reeds(1))),
        V.Decal('south', 'reed-lo', m(0, W_PX, cols=reeds(3))),
        V.Decal('south', 'panel', m(PANEL_X0, PANEL_X1)),
        V.Decal('south', 'brass', m(PANEL_X0 - 1, PANEL_X0 - 1)),
        V.Decal('south', 'brass', m(PANEL_X1 + 1, PANEL_X1 + 1)),
        V.Decal('south', 'panel-edge', m(PANEL_X0, PANEL_X0, rows=(1, 30))),
        V.Decal('south', 'cyan', m(PANEL_X0 - 1, PANEL_X1 + 1, rows=(0, 0))),
        V.Decal('south', 'k', _k_mask(K_COL0, K_ROW0, ox=B0)),
    ]
    solids = [
        V.box(DESK_X0 * X, DESK_Y0 * X, 0, W - DESK_X0 * X, DESK_Y1 * X, DESK_Z * Z, 'desk',
              decals=DESK_GRAIN + [_front_seams(FRONT_SEAMS)]),
        V.box(B0 * X, LEDGE_Y0 * X, PLINTH_Z * Z, W - B0 * X, y_front, face_top, 'slat', decals=face),
        V.box(0, LEDGE_Y0 * X, face_top, W, y_front, LEDGE_Z * Z, 'oak', bevel=0.04, decals=LEDGE_GRAIN + LEDGE_ENDS),
        V.box((B0 + 1) * X, LEDGE_Y0 * X, 0, W - (B0 + 1) * X, y_front, PLINTH_Z * Z, 'plinth'),
    ]
    return V.Recipe(NAME, solids, (5, 1), anchors={'top': (W / 2, PC_FOOT_Y * X, DESK_Z * Z)},
                    materials=materials(), kind='stand', symmetric=False,
                    notes='Reception counter 5.0 x 0.69 x 1.05 m, a 22 px face, a ledge and a desk set back behind it; footprint the front tile row.')


RECIPE = recipe
