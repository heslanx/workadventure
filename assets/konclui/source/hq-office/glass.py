"""Frameless glass in the catalogue's wall geometry (no perspective of its own): the same cap and thin strip as a wall, so
glass and solid walls meet at the same lines, coloured by the design system.

One span for every east-west wall (audit round 2, rule R2): from the first ink row to the last opaque row a wall is SPAN = 60
rows, a cap of CAP = 3, a face of 55 and a base of BASE = 2. A solid 'n' wall piece measures it (rows 4..63 of its 64 px
tile); a glass face and a door leaf take the same count, rows 4..63 on a north wall and 0..59 on a south one, and nothing
below the base: no shadow, no light pool (the runtime casts those).

  face(width, facade, south, anchors)  a glass face `width` px wide and 64 px tall: the cap where the wall line is (row 4, or
                              row 0 on a south facade, like the 'n' and 's' wall pieces), clear tinted glass with two
                              reflections per bay, the turquoise safety film at eye height on partitions, slim ink mullions on
                              facades, a base channel. The mullions split each run between two anchors (the ends, door jambs,
                              partitions that meet the glass) into equal bays of about 96 px
  strip()                     one 32 px piece of a thin glass wall, its 4 px line in the middle of the column (x 14)
  post()                      the 4 px ink post that ends a glass face or frames a door
  door_h(), door_v()          a sliding glass door in a face or a thin wall, frames 0 (closed) to DOOR_FRAMES - 1 (open)
  foot(south)                 the row of a face tile where its base starts (where a person in front of it stands)
  anchors(P, row, a, b)       the x offsets, from the left of the face of wall (row, a, b), where something meets the glass
The glass is translucent: whatever floor lies under it shows through, tinted. Every partly transparent pixel of these pieces
is glass by design (the pane, its reflections, the film, mullions and joints); the cap and the base are opaque.
"""
from PIL import Image, ImageDraw, ImageOps

from palette import INK, TURQUOISE, rgb

T = 32
SPAN, CAP, BASE = 60, 3, 2
FACE = SPAN - CAP - BASE                 # 55 rows of glass between the cap and the base
GLASS = rgb('#BCEAF0')
EDGE = rgb('#2B3A78')
JOINT = rgb('#93C7D2')
RIM = rgb('#EEF3F6')                     # the solid wall's face colour, which is also its cap highlight
SILL = rgb('#C2CFD7')                    # the solid wall's base line: a threshold, neutral
PANE_ALPHA = 64                          # fx.glass_mask reads panes at alpha 40..110 and strips at 200 (and white streaks at 52, 70, 210)
FILM_ALPHA = 235                         # translucent.py declares the levels a tileset may use: walls {34, 40, 52, 64, 70, 170, 200,
DOOR_ALPHA = 74                          # 210, 230, 235}, doors {74, 210, 220, 235}; the audit wants film 120-150 and leaves at 64 (open item)
BAY = 96                                 # a facade's mullion pitch (three tiles); partitions' joints keep two tiles
BAY_MIN = 64
REMNANT = 4                              # what is left of a leaf when its door is open: the stile, tucked against the jamb


def _a(c, alpha):
    return (*c, alpha)


def _top(south):
    return 0 if south else 4


def foot(south=False):
    """The row (inside the 64 px face tile pair) where the base of a face starts."""
    return _top(south) + SPAN - BASE


def _cap(d, x0, x1, top, south):
    """The cap rows of a wall run from x0 to x1 (inclusive): an ink line two rows deep under a highlight row, which is the wall
    piece's own cap ('n': face colour on top, 's': the blue bevel on top)."""
    d.line((x0, top, x1, top), fill=_a(EDGE if south else RIM, 255))
    d.rectangle((x0, top + 1, x1, top + 2), fill=_a(rgb(INK), 255))


def _base(d, x0, x1, top):
    """The base: the floor channel, ink over the bevel colour, last opaque row of the span."""
    d.line((x0, top + SPAN - 2, x1, top + SPAN - 2), fill=_a(rgb(INK), 255))
    d.line((x0, top + SPAN - 1, x1, top + SPAN - 1), fill=_a(EDGE, 255))


def bays(width, anchors=(), pitch=BAY):
    """x of the interior mullions of a run `width` px wide whose glass is held at `anchors` (partitions, door jambs): the run
    between two anchors is cut into equal bays, as many as fit the pitch, none narrower than BAY_MIN unless the run itself is."""
    cuts = sorted({0, width, *(int(x) for x in anchors if 0 < x < width)})
    out = []
    for lo, hi in zip(cuts, cuts[1:]):
        n = max(1, min(round((hi - lo) / pitch), (hi - lo) // BAY_MIN))
        out += [lo + (hi - lo) * i // n for i in range(1, n)]
    return out


def anchors(P, row, a, b):
    """Where something stands against the glass face of wall (row, a, b) of plan P, as x offsets from the face's left edge: the
    two sides of each door gap in it and every thin wall (a partition, or the next building wall) that meets it."""
    left = P.vb(a) * T - 2
    out = []
    for drow, g, w in P.DOORS_H:
        if drow == row and P.vb(a) < g < P.vb(b):
            out += [g * T - left, (g + w) * T - left]
    for c, r0, r1, _ in P.V_WALLS:
        bx = P.vb(c)
        if P.vb(a) < bx < P.vb(b) and (r0 <= row + 1 and r1 >= row or r1 + 1 == row or r0 == row + 2):
            out.append(bx * T - left)
    return sorted(set(out))


def face(width, facade=False, south=False, anchors=()):
    img = Image.new('RGBA', (width, 2 * T))
    d = ImageDraw.Draw(img)
    top = _top(south)
    last = top + CAP + FACE - 1                                                    # the glass's last row
    _cap(d, 0, width - 1, top, south)
    d.rectangle((0, top + CAP, width - 1, last), fill=_a(GLASS, PANE_ALPHA))
    pitch = BAY if facade else 2 * T
    cuts = sorted({0, width, *(int(x) for x in anchors if 0 < x < width), *bays(width, anchors, pitch)})  # a joint at each anchor too
    for x0, x1 in zip(cuts, cuts[1:]):                                             # reflections, upper left of a bay
        for off, w, alpha in ((10, 2, 70), (17, 1, 52)):
            for i in range(22):
                x, y = x0 + off + i, top + 26 - i
                if x + w - 1 < x1 - 1 and y > top + CAP:
                    d.line((x, y, x + w - 1, y), fill=(255, 255, 255, alpha))
        if x0:                                                                     # joints / mullions
            if facade:
                d.rectangle((x0 - 1, top + CAP, x0, last), fill=_a(rgb(INK), 230))
            else:
                d.line((x0, top + CAP, x0, last), fill=_a(JOINT, 170))
    if not facade:                                                                 # safety film, dashed, at eye height
        for x in range(0, width, 8):
            d.rectangle((x, top + 29, min(x + 5, width - 1), top + 30), fill=_a(rgb(TURQUOISE), FILM_ALPHA))
    _base(d, 0, width - 1, top)
    return img


def strip():
    img = Image.new('RGBA', (T, T))
    d = ImageDraw.Draw(img)
    d.line((14, 0, 14, T - 1), fill=_a(rgb(INK), 255))
    d.line((15, 0, 15, T - 1), fill=(255, 255, 255, 210))
    d.line((16, 0, 16, T - 1), fill=_a(GLASS, 200))
    d.line((17, 0, 17, T - 1), fill=_a(rgb(INK), 255))
    return img


def post(height=2 * T, top=4):
    """The 4 px post that ends a face or frames a door, as tall as the wall (SPAN rows from `top`): ink with the bevel colour
    in its two middle columns, so it reads the same from either side."""
    img = Image.new('RGBA', (4, height))
    d = ImageDraw.Draw(img)
    south = top == 0
    d.rectangle((0, top, 3, top + SPAN - 1), fill=_a(rgb(INK), 255))
    d.line((0, top, 3, top), fill=_a(EDGE if south else RIM, 255))
    d.rectangle((1, top + CAP, 2, top + SPAN - 1), fill=_a(EDGE, 255))
    d.rectangle((0, top + SPAN - BASE, 3, top + SPAN - BASE), fill=_a(rgb(INK), 255))
    return img


DOOR_FRAMES = 5                          # 0 closed .. 4 open


def _leaf_len(half, frame):
    """How far one leaf reaches from its jamb: half the opening when closed, the stile alone when open."""
    return REMNANT + (half - REMNANT) * (DOOR_FRAMES - 1 - frame) // (DOOR_FRAMES - 1)


def door_h(width_tiles, frame, south=False):
    """A sliding glass door in a face gap `width_tiles` wide, two rows tall: two leaves that part from the middle and slide into
    the jambs (frame 0 closed, DOOR_FRAMES - 1 open, where a stile of REMNANT px is left each side). The head beam and the
    threshold cross the opening in every frame; the leaves are the face's own glass (cap, pane, base, SPAN rows)."""
    w = width_tiles * T
    top = _top(south)
    last = top + CAP + FACE - 1
    img = Image.new('RGBA', (w, 2 * T))
    d = ImageDraw.Draw(img)
    d.line((0, top + SPAN - 1, w - 1, top + SPAN - 1), fill=_a(SILL, 255))         # the threshold: a floor track, neutral
    half = w // 2
    leaf = _leaf_len(half, frame)
    left = Image.new('RGBA', (half, 2 * T))
    ld = ImageDraw.Draw(left)
    ld.rectangle((0, top + CAP, leaf - 1, last), fill=_a(GLASS, DOOR_ALPHA))
    if not south:                                                                  # the film, as on the fixed glass of a partition
        for x in range(0, leaf, 8):
            ld.rectangle((x, top + 29, min(x + 5, leaf - 1), top + 30), fill=_a(rgb(TURQUOISE), FILM_ALPHA))
    ld.line((leaf - 1, top + CAP, leaf - 1, last), fill=_a(rgb(INK), 255))         # the meeting stile
    hx = leaf - 5
    if hx >= 0:                                                                    # the pull bar, mirrored on the other leaf
        ld.rectangle((hx, top + 22, hx + 1, top + 36), fill=_a(rgb(INK), 255))
    _base(ld, 0, leaf - 1, top)
    img.alpha_composite(left, (0, 0))
    img.alpha_composite(ImageOps.mirror(left), (w - half, 0))
    d = ImageDraw.Draw(img)
    _cap(d, 0, w - 1, top, south)                                                  # the head beam, over everything
    return img


def door_v(frame):
    """A sliding glass leaf in a thin-wall gap (two rows), 64 x 64 with the wall line in the middle: closed it spans the gap;
    opening, its two halves slide up and down into the wall, leaving a stile of REMNANT px at each jamb with an ink cap on its
    end, and a neutral threshold runs between them."""
    img = Image.new('RGBA', (2 * T, 2 * T))
    d = ImageDraw.Draw(img)
    half = _leaf_len(T, frame)
    d.line((31, 0, 31, 2 * T - 1), fill=_a(SILL, 255))                             # the threshold, 2 px wide
    d.line((32, 0, 32, 2 * T - 1), fill=_a(SILL, 255))
    for y0, y1 in ((0, half), (2 * T - half, 2 * T)):
        d.line((30, y0, 30, y1 - 1), fill=_a(rgb(INK), 255))
        d.line((31, y0, 31, y1 - 1), fill=(255, 255, 255, 210))
        d.line((32, y0, 32, y1 - 1), fill=_a(GLASS, 220))
        d.line((33, y0, 33, y1 - 1), fill=_a(rgb(INK), 255))
    for y in (0, 2 * T - 2):                                                       # the jamb caps, in line with the wall
        d.rectangle((30, y, 33, y + 1), fill=_a(rgb(INK), 255))
    return img
