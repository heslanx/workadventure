"""Frameless glass in the catalogue's wall geometry (no perspective of its own): the same two-row face and thin strip as
a wall, so glass and solid walls meet at the same lines, coloured by the design system.

  face(width, facade, south)  a glass face `width` px wide and 64 px tall: the ink rail where the wall line is (row 4,
                              or row 0 on a south facade, like the 'n' and 's' wall pieces), clear tinted glass with
                              two reflections per pane, the turquoise safety film at eye height on partitions, slim ink
                              mullions every three tiles on facades, a floor channel and a soft shadow
  strip()                     one 32 px piece of a thin glass wall, its 4 px line in the middle of the column (x 14)
  post()                      the 4 px ink post that ends a glass face or frames a door
The glass is translucent: whatever floor lies under it shows through, tinted.
"""
from PIL import Image, ImageDraw

from palette import INK, TURQUOISE, rgb

T = 32
GLASS = rgb('#BCEAF0')
EDGE = rgb('#2B3A78')
JOINT = rgb('#93C7D2')


def _a(c, alpha):
    return (*c, alpha)


def face(width, facade=False, south=False):
    img = Image.new('RGBA', (width, 2 * T))
    d = ImageDraw.Draw(img)
    top = 0 if south else 4
    d.rectangle((0, top, width - 1, top + 1), fill=_a(rgb(INK), 255))             # rail where the wall line is
    d.line((0, top + 2, width - 1, top + 2), fill=_a(EDGE, 255))
    body = (0, top + 3, width - 1, 59)
    d.rectangle(body, fill=_a(GLASS, 64))
    pane = 3 * T if facade else 2 * T
    for x0 in range(0, width, pane):                                               # reflections, upper left of a pane
        for off, w, alpha in ((10, 2, 70), (17, 1, 52)):
            for i in range(22):
                x, y = x0 + off + i, top + 26 - i
                if x < width and y > top + 3:
                    d.line((x, y, min(x + w - 1, width - 1), y), fill=(255, 255, 255, alpha))
        if x0:                                                                     # joints / mullions
            if facade:
                d.rectangle((x0 - 1, top + 3, x0, 59), fill=_a(rgb(INK), 230))
            else:
                d.line((x0, top + 3, x0, 59), fill=_a(JOINT, 170))
    if not facade:                                                                 # safety film, dashed
        for x in range(0, width, 8):
            d.rectangle((x, 33, min(x + 5, width - 1), 34), fill=_a(rgb(TURQUOISE), 235))
    d.line((0, 60, width - 1, 60), fill=_a(rgb(INK), 255))                         # floor channel
    d.line((0, 61, width - 1, 61), fill=_a(EDGE, 255))
    d.rectangle((0, 62, width - 1, 63), fill=(10, 10, 61, 34))                     # contact shadow
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
    img = Image.new('RGBA', (4, height))
    d = ImageDraw.Draw(img)
    d.rectangle((0, top, 3, height - 3), fill=_a(rgb(INK), 255))
    d.line((1, top, 1, height - 3), fill=_a(EDGE, 255))
    return img


DOOR_FRAMES = 5                          # 0 closed .. 4 open


def door_h(width_tiles, frame, south=False):
    """A sliding glass door in a face gap `width_tiles` wide, two rows tall: two leaves that part from the middle and
    slide into the posts (frame 0 closed, DOOR_FRAMES - 1 open). Same rails and film as the face around it."""
    w = width_tiles * T
    img = Image.new('RGBA', (w, 2 * T))
    d = ImageDraw.Draw(img)
    top = 0 if south else 4
    leaf = (w // 2) * (DOOR_FRAMES - 1 - frame) // (DOOR_FRAMES - 1)
    for x0, x1, edge in ((0, leaf, leaf - 1), (w - leaf, w, w - leaf)):
        if x1 <= x0:
            continue
        d.rectangle((x0, top + 3, x1 - 1, 59), fill=_a(GLASS, 74))
        for x in range(x0, x1, 8):                                                 # the film, as on the fixed glass
            d.rectangle((x, 33, min(x + 5, x1 - 1), 34), fill=_a(rgb(TURQUOISE), 235))
        d.rectangle((x0, top, x1 - 1, top + 1), fill=_a(rgb(INK), 255))           # top rail of the leaf
        d.line((x0, 60, x1 - 1, 60), fill=_a(rgb(INK), 255))
        d.line((edge, top + 2, edge, 59), fill=_a(rgb(INK), 255))                  # the leaf's meeting edge
        hx = edge - 4 if edge > x0 + 4 else edge + 2
        if x0 <= hx < x1 - 1:
            d.rectangle((hx, 26, hx + 1, 40), fill=_a(rgb(INK), 255))             # pull bar
    return img


def door_v(frame):
    """A sliding glass leaf in a thin-wall gap (two rows), 64 x 64 with the wall line in the middle: closed it spans the
    gap; opening, its two halves slide up and down into the wall."""
    img = Image.new('RGBA', (2 * T, 2 * T))
    d = ImageDraw.Draw(img)
    half = T * (DOOR_FRAMES - 1 - frame) // (DOOR_FRAMES - 1)
    for y0, y1 in ((0, half), (2 * T - half, 2 * T)):
        if y1 <= y0:
            continue
        d.line((30, y0, 30, y1 - 1), fill=_a(rgb(INK), 255))
        d.line((31, y0, 31, y1 - 1), fill=(255, 255, 255, 210))
        d.line((32, y0, 32, y1 - 1), fill=_a(GLASS, 220))
        d.line((33, y0, 33, y1 - 1), fill=_a(rgb(INK), 255))
    return img
