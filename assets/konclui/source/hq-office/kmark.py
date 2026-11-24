"""The Koncluí K, as pixel art, drawn from the official vector (brand/logo-konclui-icon.svg) for the sizes this office needs.

The logo's K is white and has three parts: the stem fused with the upper arm, the lower leg, set off from it by a thin
diagonal gap, and a small foot under the stem, set off by a curved gap. A bitmap here keeps that silhouette. Every size below
was rendered from the three paths of the vector separately at 16x, averaged down to the grid and cut at 50 % coverage, then
repaired by hand: the diagonal gap between the arm and the leg is one pixel on every row where the two run side by side, the
foot's gap is one pixel all along its curve (the stem's last rows and the foot's first ones were nudged by a pixel to get it),
and no stroke is thinner than the logo's at that size. tools/test_kmark.py renders the vector again and measures each bitmap
against it (overlap, the three parts, the gaps), so a bitmap cannot drift from the logo unnoticed.

  K_WALL     30 x 31   the wordmark on the LED screen (the wordmark's own K, at the wordmark's scale)
  K_PLAQUE   15 x 15   the counter's navy panel
  K_BELL      7 x 7    the sales bell's plate: too small for the foot's gap (see below)
  K_SIGN      5 x 5    the shop sign in the restaurant picture: too small for either gap

Below 15 px the logo's own gaps (a twentieth of the height) cannot be drawn as whole pixels without being a fifth of the
letter: K_BELL keeps the one-pixel diagonal gap between the arm and the leg and the logo's proportions (a stem two pixels
wide, the arm and the leg two to three pixels thick), and its foot is the stem's own last row; K_SIGN keeps only the
silhouette: a stem, an arm rising to the right and a leg falling to the right, the leg set off by a gap on its last row.

A pixel is '#', empty is '.'. The colour is the brand white (WHITE), the palette's own step nearest to the logo's #FBFBFB.
"""
import numpy as np

WHITE = '#F8FBFC'

K_WALL = [
    '......................########',
    '.....................#########',
    '....................##########',
    '...................##########.',
    '..................##########..',
    '.................##########...',
    '................##########....',
    '########.......##########.....',
    '########......##########......',
    '########.....##########.......',
    '########....##########........',
    '########...##########.........',
    '########..##########..........',
    '###################...........',
    '##################............',
    '#################.............',
    '################..............',
    '###############.###...........',
    '##############.#####..........',
    '#############.#######.........',
    '############.#########........',
    '###########..##########.......',
    '##########....##########......',
    '#########......##########.....',
    '.#######........##########....',
    '#..###...........##########...',
    '###...##..........##########..',
    '########...........##########.',
    '########............##########',
    '########.............#########',
    '########..............########',
]

K_PLAQUE = [
    '..........#####',
    '.........#####.',
    '........#####..',
    '####...#####...',
    '####..#####....',
    '####.#####.....',
    '#########......',
    '########.......',
    '#######.#......',
    '######.###.....',
    '#####.#####....',
    '####...#####...',
    '........#####..',
    '####.....#####.',
    '####......#####',
]

K_BELL = [
    '....###',
    '...###.',
    '##.##..',
    '####...',
    '###.##.',
    '##..###',
    '##...##',
]

K_SIGN = [
    '...##',
    '#.##.',
    '###..',
    '##.##',
    '#...#',
]


def mask(rows):
    """A bitmap as a boolean array."""
    return np.array([[c == '#' for c in r] for r in rows])
