"""Optical check of the flora sprites (flora.py): stroke weight, optical size and anchors, measured, not eyeballed.

python3 hq-office/flora_optics.py          prints the table; exit 1 when a rule fails (build.py runs check())

  osize      the area the eye groups: the silhouette closed by 2 px (gaps between blades and fronds filled)
  mass       painted area times tone distance from the ground
  contrast   the shadow-side edge against the ground the sprite stands on (WCAG ratio, flora.GROUND or flora.WATER)
  below      px of the sprite below its anchor (0 or 1 for what stands on its base; a fern's front fronds lie ahead)
Rules (owner, 18/10/2026: "match optical size and stroke weight, not just pixel size, and align them consistently"):
  - fern, leafy and grass, the bank's interchangeable plants, within 10% of their mean optical size
  - every sprite's edge contrast within CONTRAST_BAND, except the white water lily, the scene's brightest accent
  - stones and plants on land end at most 1 px below their anchor (the contact shadow); the fern's front fronds are
    the one allowed overhang
"""
import sys

import numpy as np

import flora as F

CONTRAST_BAND = (1.35, 1.7)
SAMPLES = 12
KINDS = {
    'rock r5': (lambda r: F.rock(r, 5, True), F.GROUND), 'rock r12': (lambda r: F.rock(r, 12, True), F.GROUND),
    'fern': (lambda r: F.fern(r), F.GROUND), 'leafy': (lambda r: F.leafy(r), F.GROUND),
    'grass': (lambda r: F.grass(r), F.GROUND), 'grass+flowers': (lambda r: F.grass(r, 'buttercup'), F.GROUND),
    'reeds': (lambda r: F.reeds(r, 0.85), F.WATER), 'pad r4': (lambda r: F.lily_pad(r, 4), F.WATER),
    'pad r7': (lambda r: F.lily_pad(r, 7), F.WATER), 'lily white': (lambda r: F.water_lily(r, 'white'), F.WATER),
    'lily pink': (lambda r: F.water_lily(r, 'pink'), F.WATER),
}


def _lum(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c @ [0.2126, 0.7152, 0.0722]


def _grow(m, k):
    for _ in range(k):
        q = np.pad(m, 1)
        m = m | q[:-2, 1:-1] | q[2:, 1:-1] | q[1:-1, :-2] | q[1:-1, 2:]
    return m


def measure(sprite, ground):
    img, (_, ay) = sprite
    on = img[..., 3] > 0
    ys = np.nonzero(on)[0]
    L, Lg = _lum(img[..., :3].astype(float)), F.luminance(ground)
    q = np.pad(on, 1)
    perimeter = on & ~(q[:-2, 1:-1] & q[2:, 1:-1] & q[1:-1, :-2] & q[1:-1, 2:])
    yy, xx = np.mgrid[0:on.shape[0], 0:on.shape[1]]
    cy, cx = ys.mean(), np.nonzero(on)[1].mean()
    shade = perimeter & ((yy - cy) + (xx - cx) > 0)
    big = np.pad(on, 4)
    closed = ~_grow(~_grow(big, 2), 2)
    contrast = (np.maximum(L[shade], Lg) + 0.05) / (np.minimum(L[shade], Lg) + 0.05)
    return dict(osize=int(closed.sum()), mass=float(np.abs(L[on] - Lg).sum()), contrast=float(contrast.mean()),
                below=int(ys.max() - ay))


def table():
    rows = {}
    for name, (make, ground) in KINDS.items():
        ms = [measure(make(np.random.default_rng(1000 + i)), ground) for i in range(SAMPLES)]
        rows[name] = {k: float(np.median([m[k] for m in ms])) for k in ms[0]}
    return rows


def check(rows=None):
    """[problem] for every rule a sprite breaks; empty when the flora keeps one optical system."""
    rows = rows or table()
    problems = []
    trio = {k: rows[k]['osize'] for k in ('fern', 'leafy', 'grass')}
    mean = sum(trio.values()) / 3
    problems += [f'{k}: optical size {v:.0f} is {(v / mean - 1) * 100:+.0f}% off the bank plants\' mean {mean:.0f}'
                 for k, v in trio.items() if abs(v / mean - 1) > 0.10]
    lo, hi = CONTRAST_BAND
    problems += [f'{k}: edge contrast {r["contrast"]:.2f} outside {lo}-{hi}' for k, r in rows.items()
                 if k != 'lily white' and not lo <= r['contrast'] <= hi]
    problems += [f'{k}: {r["below"]:.0f} px below its anchor (stands on its base: at most 1)' for k, r in rows.items()
                 if k.split()[0] in ('rock', 'leafy', 'grass', 'grass+flowers') and r['below'] > 1]
    return problems


if __name__ == '__main__':
    rows = table()
    print(f"{'sprite':14}{'osize':>8}{'mass':>8}{'contrast':>10}{'below':>7}")
    for name, r in rows.items():
        print(f"{name:14}{r['osize']:>8.0f}{r['mass']:>8.1f}{r['contrast']:>10.2f}{r['below']:>7.0f}")
    problems = check(rows)
    print('\n'.join(problems) or 'ok: one stroke weight, one optical size for the bank plants, anchors on the ground')
    sys.exit(1 if problems else 0)
