"""The Koru fountain of the main office at native resolution (one art pixel per map pixel, 32 per tile), drawn for pool.py:
the niche in the facade, the official Koru lit from the upper left on a stone corbel, and the water it pours.

  statue(koru, ...)   the layer that sits above the walls layer: niche, plinth, Koru, corbel, the shadows they cast
  stream(k, ...)      frame k of 8 (220 ms): the stream, the splash where it lands, rings, bubbles, the stirred water
  stirred(...)        the water the fountain animates itself: the water shader leaves it alone

Light comes from the upper left, as everywhere in the map: lit edges are the top and left ones, shade and the outline
the bottom and right ones. Palettes are small and fixed; nothing is dithered or blended (alpha only on water, where the
fountain's own motion has to show the floor through it).
"""
import numpy as np
from PIL import Image

from palette import rgb

FRAMES = 8
SQUASH = 2.0                                                   # splash and rings are this much wider than tall (the oblique view)
TEAL = [rgb(c) for c in ('#8BE3E5', '#5CC6CC', '#33AAB3', '#1F8E99', '#13707C', '#0B4C56')]   # the Koru's body, lit -> deep
BEAK = dict(lit=rgb('#F7C979'), base=rgb('#F3AA50'), shade=rgb('#C8642E'), mouth=rgb('#B43D32'), tongue=rgb('#F57466'))
OUTLINE = rgb('#08323A')
STONE = [rgb(c) for c in ('#F4EFE4', '#EBE4D6', '#E3DBCB', '#D3CAB8', '#BDB29D', '#9E9381')]    # warm limestone, lit -> joint
RECESS = [rgb(c) for c in ('#103444', '#183C50', '#204860', '#2A5470')]                          # slate petrol behind the Koru
SLATE = [rgb(c) for c in ('#1E2A42', '#2C3D56', '#385068', '#5A7088', '#8FA5BC', '#B8CCE0')]     # the corbel, deep -> lit
MOSS = [rgb(c) for c in ('#2C6E3F', '#4D8A2F', '#72AD35', '#99CD45')]
FOAM = [rgb(c) for c in ('#FFFFFF', '#E9FBFC', '#BFEFF0')]
JET = dict(lit=rgb('#F4FFFD'), hi=rgb('#BFF7F2'), body=rgb('#5FE4D9'), dash=rgb('#E9FBFC'), thin=rgb('#2FB9B8'), mid=rgb('#3FCBC6'), shade=rgb('#3AC4C2'))
BOWL = rgb('#008087')
MINT = rgb('#78DCCB')
RING = [rgb('#8FEAE2'), rgb('#D4FBF6')]                                                          # ring crests: back arc, front arc


def _eyes(idx, h, width):
    """The pixels of the Koru's closed eyes: small shapes of the vector's eye colour in the head (the same tone is also
    used for big areas of shade, which stay as they are)."""
    seen = np.zeros(idx.shape, bool)
    eyes = np.zeros(idx.shape, bool)
    for y0 in range(int(h * 0.55)):
        for x0 in range(width):
            if idx[y0, x0] != 3 or seen[y0, x0]:
                continue
            stack, part = [(y0, x0)], []
            seen[y0, x0] = True
            while stack:
                y, x = stack.pop()
                part.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < width and idx[yy, xx] == 3 and not seen[yy, xx]:
                        seen[yy, xx] = True
                        stack.append((yy, xx))
            ys, xs = zip(*part)
            if len(part) < 60 and max(xs) - min(xs) < 22:
                eyes[ys, xs] = True
    return eyes


# Feather lines the owner drew over the Koru (20/10/2026, "falta um pouco mais de textura e profundidade"): on each wing
# a long one from the top tip to the shoulder and two shorter ones below it, and two arcs down each side of the belly.
# Points in the picture's pixels (98 wide), left side; the right side mirrors them. (start, bend, end) of a curve.
FEATHERS = (((6, 6), (15, 9), (25, 17)), ((10, 24), (18, 24.5), (26, 29)), ((11, 37), (19, 36.5), (27, 38)),
            ((30, 31), (31.5, 43), (43, 48)), ((42, 37), (43, 44), (47, 47)))


def _feather_lines(h, width):
    """The feather lines as masks: the line, the pixel beside it towards the light (up and left: the edge of the
    feather above, catching it), and the two away from it (down and right: the shade that feather throws on the one
    below). Points are in the picture with its 1 px margin, hence the - 1."""
    line, lit, shade = (np.zeros((h, width), bool) for _ in range(3))

    def put(mask, x, y):
        x, y = int(round(x)), int(round(y))
        if 0 <= y < h and 0 <= x < width:
            mask[y, x] = True

    for side in (0, 1):
        for (x0, y0), (xc, yc), (x1, y1) in FEATHERS:
            x0, xc, x1, y0, yc, y1 = x0 - 1, xc - 1, x1 - 1, y0 - 1, yc - 1, y1 - 1
            if side:
                x0, xc, x1 = (width - 1 - x for x in (x0, xc, x1))
            for t in np.linspace(0, 1, 80):
                x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * xc + t * t * x1
                y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * yc + t * t * y1
                dx, dy = 2 * (1 - t) * (xc - x0) + 2 * t * (x1 - xc), 2 * (1 - t) * (yc - y0) + 2 * t * (y1 - yc)
                nx, ny = -dy, dx                                  # a normal to the curve, turned down and right
                if nx + ny < 0:
                    nx, ny = -nx, -ny
                norm = max(np.hypot(nx, ny), 1e-6)
                nx, ny = nx / norm, ny / norm
                put(line, x, y)
                put(lit, x - nx, y - ny)
                put(shade, x + nx, y + ny)
                put(shade, x + 2 * nx, y + 2 * ny)
    return line, lit & ~line, shade & ~line & ~lit


def _scales(h, width, solid):
    """A sparse texture of small feathers: a 3 px cup every few pixels in staggered rows, on the belly and the wings,
    away from the face and the silhouette's edge."""
    cups = np.zeros((h, width), bool)
    inner = solid.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        inner &= np.roll(np.roll(solid, dy, 0), dx, 1)
    for row, y in enumerate(range(30, h - 6, 4)):                 # the belly and the lower body
        for x in range(36 + 3 * (row % 2), width - 36, 6):
            for cx, cy in ((x - 1, y), (x, y + 1), (x + 1, y)):
                if inner[cy, cx]:
                    cups[cy, cx] = True
    for side in (0, 1):                                           # the wings, between the feather lines
        for row, y in enumerate(range(16, 40, 5)):
            for x in range(4 + 3 * (row % 2), 24, 6):
                xx = width - 1 - x if side else x
                for cx, cy in ((xx - 1, y), (xx, y + 1), (xx + 1, y)):
                    if 0 <= cx < width and inner[cy, cx]:
                        cups[cy, cx] = True
    return cups


def koru(big, width=96):
    """The official Koru vector (rendered large) at native size, quantised to its own colours and lit from the upper
    left: the vector's own light and dark stretched over four steps, a 1 px edge of light on the silhouette's top and
    left and one step lighter just inside it, a step darker on its bottom and right; the closed eyes and the vector's beak, mouth and tongue kept as drawn; a 1 px outline
    outside the silhouette's bottom and right edges. Returns the picture and the beak tip in it."""
    big = big.crop(big.getbbox())
    h = round(big.height * width / big.width)
    a = np.asarray(big.resize((width, h), Image.Resampling.LANCZOS)).astype(float)
    solid = a[..., 3] > 110
    pal = np.array(TEAL[1:] + [BEAK['base'], BEAK['shade'], BEAK['mouth'], BEAK['tongue'], BEAK['lit']], float)
    idx = ((a[..., None, :3] - pal[None, None]) ** 2).sum(-1).argmin(-1)
    idx = np.where(solid, idx, -1)
    pad = np.pad(solid, 2)
    near = lambda dy, dx: pad[2 + dy:2 + dy + h, 2 + dx:2 + dx + width]
    lit1 = solid & (~near(-1, 0) | ~near(0, -1))
    shade1 = solid & (~near(1, 0) | ~near(0, 1)) & ~lit1
    lit2 = solid & (~near(-2, 0) | ~near(0, -2)) & ~lit1 & ~shade1
    teal = (idx >= 0) & (idx < 5)
    lum = a[..., :3] @ np.array([0.299, 0.587, 0.114])           # the vector's own light and dark (its face discs, belly and wing gradients),
    lo, hi = np.percentile(lum[teal], (3, 97))                    # stretched over four steps of the ramp: hard bands, nothing blended
    tone = 4 - np.searchsorted((0.22, 0.52, 0.88), np.clip((lum - lo) / (hi - lo), 0, 1), side='right')
    wings = np.abs(np.arange(width) - width / 2)[None, :] > width * 0.30
    tone = np.where(wings & (tone > 3), 3, tone)                  # the darkest of the vector's gradient stays in the body, not the wing tops
    belly = (np.arange(h)[:, None] > h * 0.58) & ~wings & (tone >= 3)
    tone = np.where(belly, tone - 1, tone)                        # and the belly's lobes read a step lighter than the body round them
    tone = np.where(lit1, 0, np.where(lit2, tone - 1, np.where(shade1, tone + 1, tone)))
    line, edge, under = _feather_lines(h, width)                 # the owner's feather lines: dark, lit above, shaded below
    cups = _scales(h, width, solid) & ~line & ~edge
    tone = np.where(line, np.maximum(np.minimum(tone + 2, 5), 4), np.where(edge, np.maximum(tone - 1, 1),
                    np.where(under | cups, np.minimum(tone + 1, 5), tone)))
    eyes = _eyes(idx, h, width)
    eyes |= np.roll(eyes, 1, 0) & solid                          # 2 px thick, with a light line under them
    under = np.roll(eyes, 1, 0) & ~eyes & teal
    tone[under] = np.minimum(tone[under], 2) - 1
    tone[eyes] = 5
    rgbq = np.zeros((h, width, 3))
    rgbq[teal] = np.array(TEAL, float)[np.clip(tone, 0, 5)[teal]]
    rgbq[idx >= 5] = pal[idx[idx >= 5]]
    bill = np.isin(idx, (5, 6, 7, 8, 9))                          # the bill: a lit edge on its top and left, a dark one on its bottom and right
    bp = np.pad(bill, 1)
    b_near = lambda dy, dx: bp[1 + dy:1 + dy + h, 1 + dx:1 + dx + width]
    rgbq[(idx == 5) & bill & (~b_near(-1, 0) | ~b_near(0, -1))] = BEAK['lit']
    rgbq[np.isin(idx, (5, 9)) & bill & (~b_near(1, 0) | ~b_near(0, 1))] = BEAK['shade']
    out = np.zeros((h + 2, width + 2, 4), np.uint8)
    out[1:-1, 1:-1, :3] = rgbq.astype(np.uint8)
    out[1:-1, 1:-1, 3] = solid * 255
    full = out[..., 3] > 0
    ring = np.zeros_like(full)
    for dy, dx in ((1, 0), (0, 1), (1, 1)):                      # below, right of and diagonal to the silhouette
        ring |= np.roll(np.roll(full, dy, 0), dx, 1)
    ring &= ~full
    out[ring] = (*OUTLINE, 255)
    mid = np.isin(idx, (5, 6, 9))                                 # the lowest pixel of the bill near the middle of the upper half
    mid[:, :int(width * 0.35)] = False
    mid[:, int(width * 0.65):] = False
    mid[int(h * 0.6):] = False
    ys, xs = np.nonzero(mid)
    tip = (int(xs[ys.argmax()]) + 1, int(ys.max()) + 1) if len(ys) else ((width + 2) // 2, (h + 2) // 3)
    return Image.fromarray(out, 'RGBA'), tip


def _facade(width, height):
    """The niche in its own pixels (width x height): a thin cornice, plain limestone piers, pilasters with a capital and
    a base either side of a slate recess, and a plinth. Returns the picture and (recess x0, x1, cornice, plinth row)."""
    rng = np.random.default_rng(3)
    img = np.empty((height, width, 3), np.uint8)
    pier, pilaster = 18, 8
    rec0, rec1 = pier + pilaster, width - pier - pilaster
    cornice, bottom = 3, height - 3
    img[:, :width // 2] = STONE[1]                                # light comes from the left: the right half is a step darker
    img[:, width // 2:] = STONE[2]
    speck = rng.random((height, width))                           # sparse flecks in the stone, never in a line
    img[speck < 0.016] = STONE[2]
    img[speck > 0.99] = STONE[0]
    img[cornice:bottom, 0] = STONE[0]                             # the piers' outer edges catch the light
    img[cornice:bottom, width - 1] = STONE[0]
    img[cornice:bottom, rec0:rec1] = RECESS[2]                    # the recess: deep under the cornice and by the left pilaster, lit at the foot
    foot = bottom - 12 + np.round(1.6 * np.sin(np.arange(rec0, rec1) * 0.37)).astype(int)
    for i, x in enumerate(range(rec0, rec1)):
        img[foot[i]:bottom, x] = RECESS[3]
    img[cornice:cornice + 2, rec0:rec1] = RECESS[0]
    img[cornice + 2:cornice + 4, rec0:rec1] = RECESS[1]
    img[cornice:bottom, rec0:rec0 + 3] = RECESS[1]
    for p0 in (pier, width - pier - pilaster):                    # pilasters: lit on the left, shaded on the right, a capital and a base a little wider
        img[cornice:bottom, p0:p0 + pilaster] = STONE[1] if p0 < width // 2 else STONE[2]
        img[cornice:bottom, p0] = STONE[0] if p0 < width // 2 else STONE[1]
        img[cornice:bottom, p0 + pilaster - 2:p0 + pilaster] = STONE[3]
        for y0_ in (cornice, bottom - 4):
            for r, c in enumerate((STONE[0], STONE[1], STONE[2], STONE[4])):
                img[y0_ + r, p0 - 1:p0 + pilaster + 1] = c
        img[cornice + 4, p0:p0 + pilaster] = STONE[3]             # the capital's shadow on the shaft
    for r, c in enumerate((STONE[0], STONE[2], STONE[4])):        # the cornice: lit, face, shaded underside
        img[r, :] = c
    for r, c in enumerate((STONE[0], STONE[3], STONE[5])):        # the plinth
        img[bottom + r, :] = c
    return img, (rec0, rec1, cornice, bottom)


def statue(koru_big, x0, y0, w, h, canal_cx, facade, corbel_y, water):
    """The layer that sits above the walls layer, in the region's map px (w x h at x0, y0): the niche over the facade
    (facade = x0, y0, x1, y1 of the wall's face), the Koru on its corbel and the shadows they cast on the water.
    The corbel's lip is drawn over the Koru's foot, so she ends on it. Returns the layer, the beak tip in map px and the water it shades
    (a region mask: the pool darkens the still water with it, as with the deck's shadow, under the plants)."""
    layer = np.zeros((h, w, 4), np.uint8)
    fx0, fy0, fx1, fy1 = facade
    pic, rect = _facade(fx1 - fx0, fy1 - fy0 + 3)
    layer[fy0 - y0:fy0 - y0 + pic.shape[0], fx0 - x0:fx0 - x0 + pic.shape[1], :3] = pic
    layer[fy0 - y0:fy0 - y0 + pic.shape[0], fx0 - x0:fx0 - x0 + pic.shape[1], 3] = 255
    owl, tip = koru(koru_big)
    ox, oy = int(canal_cx - owl.width / 2 - x0), int(corbel_y - owl.height + 6 - y0)
    owl_a = np.zeros((h, w), bool)                                # the shadow the Koru throws on the back wall
    owl_a[oy:oy + owl.height, ox:ox + owl.width] = np.asarray(owl)[..., 3] > 0
    rec0, rec1, cornice, bottom = rect
    wall = np.zeros((h, w), bool)
    wall[fy0 - y0 + cornice:fy0 - y0 + bottom, fx0 - x0 + rec0:fx0 - x0 + rec1] = True
    layer[np.roll(np.roll(owl_a, 2, 0), 2, 1) & wall & ~owl_a, :3] = RECESS[0]
    layer_img = Image.fromarray(layer, 'RGBA')
    layer_img.alpha_composite(owl, (ox, oy))
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = int(canal_cx - x0), int(corbel_y - y0)
    top = cy - 4
    bracket = np.zeros((h, w, 4), np.uint8)                       # a hanging basin: a pale lip, a body in two blocks narrowing to a dark foot
    halves = (28, 28, 27, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17)
    for dy, half in enumerate(halves):
        row = (yy == top + dy) & (np.abs(xx - cx + 0.5) < half)
        bracket[row, :3] = SLATE[5] if dy == 0 else SLATE[4] if dy == 1 else SLATE[2] if dy < 11 else SLATE[0]
        bracket[row, 3] = 255
        if dy >= 2:
            bracket[row & (xx >= cx + half - 4), :3] = SLATE[1] if dy < 11 else SLATE[0]    # shade on the right
        if 2 <= dy < 11:
            bracket[row & (xx < cx - half + 2), :3] = SLATE[3]                              # lit on the left
    for gx in (-9, 9):                                                                    # the joints between its blocks
        bracket[(xx == cx + gx) & (yy >= top + 2) & (yy < top + 11), :3] = SLATE[1]
    for gx, ln in ((-17, 7), (-4, 6), (12, 7), (21, 5)):                                  # wet stains running down the face
        bracket[top + 2:top + 2 + ln, cx + gx, :3] = SLATE[0]
    for mx, strands in ((-22, ((0, 5), (1, 3), (2, 6), (3, 2))), (20, ((0, 3), (1, 6), (2, 2), (3, 5)))):   # moss hanging from the lip in strands, lighter at the top
        for dx_, ln in strands:
            for r in range(ln):
                bracket[top + r, cx + mx + dx_, :3] = MOSS[3] if r == 0 else MOSS[2] if r < 2 else MOSS[1] if r < 4 else MOSS[0]
                bracket[top + r, cx + mx + dx_, 3] = 255
    layer_img.alpha_composite(Image.fromarray(bracket, 'RGBA'))
    out = np.asarray(layer_img).copy()
    shade = np.zeros((h, w), bool)                                  # shade on the water: under the plinth, and under and beside the corbel
    shade[fy1 - y0 + 3:fy1 - y0 + 7, fx0 - x0:fx1 - x0] = True
    shade |= (yy >= top + len(halves)) & (yy < top + len(halves) + 6 - np.abs(xx - cx) // 9) & (np.abs(xx - cx) < 24)
    return Image.fromarray(out, 'RGBA'), (x0 + ox + tip[0], y0 + oy + tip[1] + 1), shade & water & (out[..., 3] == 0)


def _hash(a, b):
    return ((np.asarray(a, np.int64) * 73856093) ^ (np.asarray(b, np.int64) * 19349663)) % 1000 / 1000.0


def _patches(dist, dx, dy):
    """The water the stream stirs: a lumpy bowl around the landing with a paler halo, and a tail of bubbles down the canal."""
    ang = np.arctan2(dy, dx)
    core = 14 + 3.0 * np.sin(ang * 3 + 1.0) + 1.8 * np.sin(ang * 5 - 0.7) + 1.0 * np.sin(ang * 11)
    bowl, halo = dist < core, dist < core + 2.4 + 0.8 * np.sin(ang * 8 + 2.0)
    tail = (dy > 2) & (dy < 60) & (np.abs(dx) < 7.5 * np.clip(1 - dy / 70, 0, 1) ** 0.9 + 1.2 * np.sin(dy * 0.31))
    return bowl, halo, tail


def _stirred(xs, ys, cx, cy1):
    """Where the fountain animates the water, for arrays of region px: the bowl and its tail, the reach of the rings
    and the column under the stream. Nothing is drawn outside it, so the water shader (which repaints open water) can
    be told to leave exactly this alone."""
    dx, dy = (xs - cx) / SQUASH, (ys - cy1).astype(float)
    dist = np.hypot(dx, dy)
    bowl, halo, tail = _patches(dist, dx, dy)
    return halo | tail | (dist < 22) | ((ys < cy1) & (np.abs(xs - cx) < 8))


def stirred(x0, y0, w, h, bx, iy):
    """The region mask the water shader must leave alone."""
    ys, xs = np.mgrid[0:h, 0:w]
    return _stirred(xs, ys, int(bx - x0), int(iy - y0))


def stream(k, x0, y0, w, h, bx, by, iy, water):
    """Frame k of the stream that leaves the beak at (bx, by) and lands at (bx, iy), in the region's map px: a straight
    column widening from 3 to 8 px, a pixel at a time, as it falls (a white edge and a pale one on its left, a mid and a dark one on its
    right) with short dashes of light sliding down it, 4 px a frame; where it lands, curved arms of foam that rise and
    fall with the loop, round droplets of three sizes, five full rings that move outward and fade, a dark bowl of
    stirred water and bubbles trailing south. Returns an RGBA array of the region."""
    s = np.zeros((h, w, 4), np.uint8)
    cx, cy0, cy1 = int(bx - x0), int(by - y0), int(iy - y0)
    length = cy1 - cy0
    for y in range(cy0, cy1 + 2):
        t = (y - cy0) / length
        width = 3 if y - cy0 < 2 else int(round(4 + 4 * t))
        left = cx - width // 2 + int(round(0.8 * t * np.sin(2 * np.pi * (1.2 * t - k / FRAMES))))
        for c in range(width):
            if c == 0:
                col = JET['lit']
            elif c == 1 and width >= 5:
                col = JET['hi']
            elif c == width - 1:
                col = JET['shade']
            elif c == width - 2 and width >= 7:
                col = JET['mid']
            else:
                phase = (y - 4 * k + 7 * c) % 16
                col = JET['dash'] if phase < 3 else JET['thin'] if phase == 8 else JET['body']
            if y > cy1 - 2:
                col = FOAM[1]
            s[y, left + c, :3] = col
            s[y, left + c, 3] = 245
    ys, xs = np.mgrid[cy1 - 62:cy1 + 84, cx - 100:cx + 101]
    ok = (ys >= 0) & (ys < h) & (xs >= 0) & (xs < w)
    wm = np.zeros(ys.shape, bool)
    wm[ok] = water[ys[ok], xs[ok]]
    dx, dy = (xs - cx) / SQUASH, (ys - cy1).astype(float)
    dist = np.hypot(dx, dy)
    ok &= _stirred(xs, ys, cx, cy1)

    def paint(mask, col, alpha):
        yy_, xx_ = ys[mask & ok], xs[mask & ok]
        free = s[yy_, xx_, 3] < alpha
        s[yy_[free], xx_[free], :3] = col
        s[yy_[free], xx_[free], 3] = alpha

    drops = {1: ((0, 0, 0),), 2: ((0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 2)),                      # a drop: 1 px, 2 x 2 or 2 x 3, white
             3: ((0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 1), (0, 2, 1), (1, 2, 2))}                  # with its lower right a shade paler

    def dot(px, py, col, alpha, size=1):
        for ddx, ddy, shade in drops[size]:
            if 0 <= py + ddy < h and 0 <= px + ddx < w and _stirred(np.array(px + ddx), np.array(py + ddy), cx, cy1):
                s[py + ddy, px + ddx, :3] = col if size == 1 else FOAM[shade]
                s[py + ddy, px + ddx, 3] = alpha

    bowl, halo, tail = _patches(dist, dx, dy)
    paint(tail & wm, MINT, 60)
    paint(halo & wm, BOWL, 105)
    paint(bowl & wm, BOWL, 200)
    spacing = 2.7
    near = np.maximum(dist, 1e-6)
    slope = np.maximum(np.hypot(dx / (SQUASH * near), dy / near), 1e-3)   # how fast `dist` grows per pixel here: a ring 1 px thick all round, not 2 px at its sides
    for i in range(6):                                           # rings: whole ellipses, the front (south) arc brighter; each takes the next one's place
        r = 4 + (spacing * i + spacing * k / FRAMES) % (6 * spacing)    # after the 8 frames, so the loop has no seam
        fade = min(1, (r - 4) / 2.5) * (1 - (r - 4) / 24) ** 0.5
        ring = (np.abs(dist - r) / slope < 0.75) & wm & ~(_hash(np.floor((np.arctan2(dy, dx) + np.pi) / (2 * np.pi) * 24), i + 3) < 0.1)
        paint(ring & (dy > 0), RING[1], int(240 * fade))
        paint(ring & (dy <= 0), RING[0], int(235 * fade))
    for j in range(12):                                          # bubbles come up in the trail south of the splash
        if (k + 3 * j) % FRAMES < 3:
            dot(cx + int(round((_hash(j, 7) - 0.5) * 2 * (9 - 5 * (j % 5) / 4))), cy1 + 8 + int(_hash(j, 11) * 52), FOAM[1], 220)
    base = cy1 + 1
    for x in range(-10, 11):                                     # the crown: ragged columns of foam that rise and fall with the loop, tallest by the
        edge = 1 - abs(x) / 11                                   # stream, the bottom row broken and a fringe below it
        wave = 0.5 + 0.5 * np.sin(2 * np.pi * (k / FRAMES + _hash(x + 30, 1)))
        height = int(round(2 + 8 * edge * wave ** 0.9))
        for yy_ in range(base - height, base):
            dot(cx + x, yy_, FOAM[0] if yy_ < base - 1 else FOAM[1], 252)
        if _hash(x + 70, 2) < 0.7:
            dot(cx + x, base, FOAM[1], 250)
        if abs(x) < 8 and _hash(x + 90, 3) > 0.45:
            dot(cx + x, base + 1, FOAM[2], 240)
    paint((np.abs(xs - cx) < 3) & (ys >= cy1 - 2) & (ys <= cy1), FOAM[0], 255)
    for j in range(9):                                           # droplets: one parabola each, in three sizes, rising to about a quarter of the stream
        p = ((k + j * FRAMES / 9) % FRAMES) / FRAMES
        px = int(round(cx + (1 if j % 2 else -1) * (8 + (8 + 6 * (j % 3)) * p)))
        py = int(round(cy1 - 5 - (5 + 3 * (j % 3)) * 4 * p * (1 - p) + 7 * p * p))
        dot(px, py, FOAM[0], int(245 * (1 - p ** 6)), size=3 - j % 3)
    return s
