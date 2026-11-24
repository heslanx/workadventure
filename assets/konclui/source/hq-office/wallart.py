"""The two pictures that hang either side of the reception's LED wall, drawn by hand in code at their own size (58 x 42
px) so every edge is a decision, not a downscale: Koru greeting beside a plant, and the restaurant Koncluí serves.

Shapes are filled at 4x and cut at half coverage (round things stay symmetric), painted in layers into a flat picture
of a few tones; the owl's silhouette then gets a 1 px outline in its darkest teal, never black.
"""
import numpy as np
from PIL import Image, ImageDraw

import kmark
from palette import rgb

SUB = 4


class Canvas:
    """A flat picture at 1x, painted by shapes drawn at SUB x."""

    def __init__(self, w, h, ground):
        self.w, self.h = w, h
        self.px = np.zeros((h, w, 3), np.uint8)
        self.px[:] = rgb(ground)
        self.owner = np.zeros((h, w), np.int16)             # which layer id painted a pixel (0 = ground)
        self.ox = 0

    def _mask(self, draw):
        im = Image.new('L', (self.w * SUB, self.h * SUB), 0)
        draw(ImageDraw.Draw(im), SUB)
        return np.asarray(im).reshape(self.h, SUB, self.w, SUB).mean((1, 3)) >= 127.5

    def fill(self, mask, colour, tag=0):
        self.px[mask] = rgb(colour)
        self.owner[mask] = tag
        return mask

    def rect(self, x0, y0, x1, y1, colour, tag=0):
        """Inclusive pixel rectangle."""
        m = np.zeros((self.h, self.w), bool)
        x0, x1 = x0 + self.ox, x1 + self.ox
        m[max(0, y0):y1 + 1, max(0, x0):x1 + 1] = True
        return self.fill(m, colour, tag)

    def ellipse(self, cx, cy, rx, ry, colour, tag=0):
        return self.fill(self._mask(lambda d, s: d.ellipse(((cx + self.ox - rx) * s, (cy - ry) * s, (cx + self.ox + rx) * s - 1, (cy + ry) * s - 1), fill=255)), colour, tag)

    def poly(self, pts, colour, tag=0):
        return self.fill(self._mask(lambda d, s: d.polygon([((x + self.ox) * s, y * s) for x, y in pts], fill=255)), colour, tag)

    def rounded(self, x0, y0, x1, y1, r, colour, tag=0):
        return self.fill(self._mask(lambda d, s: d.rounded_rectangle(((x0 + self.ox) * s, y0 * s, (x1 + self.ox + 1) * s - 1, (y1 + 1) * s - 1), radius=r * s, fill=255)), colour, tag)

    def dot(self, x, y, colour, tag=0):
        x += self.ox
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y, x] = rgb(colour)
            self.owner[y, x] = tag

    def image(self):
        return Image.fromarray(self.px, 'RGB')


def outline(c, tags, colour):
    """1 px outline round the union of the layers `tags` (4-neighbour), only onto ground."""
    body = np.isin(c.owner, tags)
    edge = np.zeros_like(body)
    edge[1:] |= body[:-1]
    edge[:-1] |= body[1:]
    edge[:, 1:] |= body[:, :-1]
    edge[:, :-1] |= body[:, 1:]
    c.px[edge & ~body & (c.owner == 0)] = rgb(colour)


# ---------------------------------------------------------------------------------------------------- Koru

KORU = dict(line='#0A4B55', dark='#0F6C76', body='#1B8791', mid='#2E9FA8', light='#4FBDC4', belly='#7FD3D3',
            beak='#F3AA50', beak_lit='#F7C979', white='#FFFFFF', pupil='#0A2F3A')
WALL_GROUND = '#C8EBD6'


def koru_greeting(w=58, h=42):
    """Koru facing us, the right wing up in a wave, beside a potted plant."""
    k = KORU
    c = Canvas(w, h, WALL_GROUND)
    c.rect(0, 36, w - 1, h - 1, '#B2DEC4')                              # the shelf the pot and the owl stand on
    c.rect(0, 36, w - 1, 36, '#9FD1B5')
    c.ox = -1                                                           # plant, left
    leaf = ('#2F7A4B', '#3F9A5C', '#63B879')
    for pts, col in (([(10, 26), (3, 20), (6, 14), (11, 21)], leaf[1]), ([(11, 26), (11, 12), (15, 18), (14, 26)], leaf[0]),
                     ([(12, 26), (20, 20), (19, 13), (13, 21)], leaf[1]), ([(11, 26), (5, 25), (3, 29), (10, 28)], leaf[0]),
                     ([(13, 26), (20, 26), (22, 30), (14, 28)], leaf[0]), ([(12, 24), (9, 17), (12, 9), (14, 17)], leaf[2])):
        c.poly(pts, col, 9)
    c.poly([(5, 29), (18, 29), (16, 36), (7, 36)], '#D9C9AE', 8)       # the pot
    c.rect(5, 29, 17, 30, '#EADCC3', 8)
    c.poly([(15, 31), (17, 31), (16, 36), (14, 36)], '#BFAF93', 8)
    outline(c, [8, 9], '#3C5D45')
    c.ox = 0
    c.ox = -1                                                           # the owl: wing behind, body, tufts, face
    c.rounded(24, 12, 49, 36, 9, k['dark'], 1)                          # body
    c.poly([(25, 14), (24, 7), (31, 12)], k['dark'], 1)                 # tufts
    c.poly([(48, 14), (49, 7), (42, 12)], k['dark'], 1)
    c.poly([(47, 22), (52, 14), (55, 6), (56, 9), (55, 17), (53, 24), (49, 30)], k['mid'], 1)    # the waving wing
    c.poly([(26, 24), (21, 28), (22, 35), (27, 33)], k['mid'], 1)                              # the other wing, down
    c.ellipse(31, 20, 6.5, 6.5, k['light'], 2)                          # face discs
    c.ellipse(42, 20, 6.5, 6.5, k['light'], 2)
    for cx in (31, 42):
        c.ellipse(cx, 20, 4, 4, k['white'], 3)                          # eyes
        c.ellipse(cx + (1 if cx == 31 else -1), 21, 2, 2, k['pupil'], 3)
        c.dot(cx + (0 if cx == 31 else -2), 20, k['white'], 3)
    c.poly([(35, 23), (39, 23), (37, 27)], k['beak'], 3)                # beak
    c.dot(36, 23, k['beak_lit'], 3)
    c.ellipse(37, 32, 6, 4, k['belly'], 4)                              # belly
    c.rect(29, 37, 32, 38, k['beak'], 5)                                # feet
    c.rect(41, 37, 44, 38, k['beak'], 5)
    outline(c, [1, 2, 3, 4, 5], k['line'])
    c.ox = 0
    return c.image()


# ---------------------------------------------------------------------------------------------------- restaurant

def restaurant(w=58, h=42):
    """A corner restaurant with a green awning, warm windows and a pot at the door, seen straight on."""
    c = Canvas(w, h, '#BFE0F0')
    c.rect(0, 0, w - 1, 12, '#D4ECF6')                                  # sky
    c.rect(0, 33, w - 1, h - 1, '#B9B2A8')                              # pavement
    c.rect(0, 33, w - 1, 33, '#8F877D')
    for x in range(2, w, 9):
        c.rect(x, 38, x + 4, 38, '#8F877D')                             # the kerb's own darker tone
    wall, wall_dark, trim = '#EBDCC0', '#CDBB9C', '#F7EEDB'
    c.rect(4, 9, 53, 33, wall)                                          # the shop
    c.rect(4, 9, 53, 10, trim)                                          # cornice
    c.rect(4, 11, 53, 11, wall_dark)
    c.rect(4, 9, 4, 33, wall_dark)
    c.rect(53, 9, 53, 33, wall_dark)
    c.rect(14, 2, 43, 9, wall)                                          # the parapet's sign board, above the door
    c.rect(14, 2, 43, 2, trim)
    c.rect(14, 2, 14, 9, wall_dark)
    c.rect(43, 2, 43, 9, wall_dark)
    c.rect(19, 3, 38, 9, '#0B5E68')                                     # the sign: a teal rim, a navy board (the frame's ink), the white K and a cyan line of text
    c.rect(20, 4, 37, 8, '#0A0A3D')
    for j, row in enumerate(kmark.K_SIGN):                              # the logo's K, white, 5 x 5 (the board's height)
        for i, ch in enumerate(row):
            if ch == '#':
                c.dot(21 + i, 4 + j, kmark.WHITE)
    c.rect(28, 6, 35, 6, '#27C9CE')
    # awning: green and cream stripes with a scalloped edge; the cream is the cornice's trim, the green's shade is the line above it,
    # the cream's shade is the wall's (the picture holds 24 colours with its frame: tools/contract.py)
    green_shade = '#1E4A37'
    for i, x in enumerate(range(4, 54, 5)):
        col = '#2F6B4F' if i % 2 == 0 else trim
        c.rect(x, 13, min(x + 4, 53), 18, col)
        c.rect(x, 19, min(x + 4, 53), 19, green_shade if i % 2 == 0 else wall_dark)
        c.dot(x + 2, 20, green_shade if i % 2 == 0 else wall_dark)
    c.rect(4, 12, 53, 12, green_shade)
    # windows and door
    frame = '#3B4A3F'
    for x0 in (7, 38):
        c.rect(x0, 22, x0 + 12, 31, frame)
        c.rect(x0 + 1, 23, x0 + 11, 30, '#F4C56A')
        c.rect(x0 + 1, 23, x0 + 5, 30, '#F8D587')
        c.rect(x0 + 6, 22, x0 + 6, 31, frame)
        c.rect(x0 + 2, 27, x0 + 4, 29, '#D99A3E')                       # a table lamp's glow, a menu board
        c.rect(x0 + 8, 26, x0 + 10, 30, '#D99A3E')
    c.rect(23, 21, 34, 33, frame)                                       # door
    c.rect(24, 22, 33, 33, '#8A5A3A')
    c.rect(24, 22, 28, 33, '#9A6A46')
    c.rect(25, 23, 32, 28, '#F4C56A')
    c.rect(28, 23, 29, 28, frame)
    c.dot(32, 30, '#F4C56A')
    for x in (20, 35):                                                  # pots either side of the door
        c.rect(x, 30, x + 2, 33, '#B5683F')
        c.rect(x, 30, x + 2, 30, '#D99A3E')
        c.rect(x - 1, 27, x + 3, 29, '#3F9A5C')
        c.rect(x, 26, x + 2, 26, '#63B879')
    return c.image()
