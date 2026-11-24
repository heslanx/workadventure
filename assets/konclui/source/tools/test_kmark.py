"""The Koncluí K bitmaps of hq-office/kmark.py, measured against the official vector (brand/logo-konclui-icon.svg).

The logo's K is white and has three parts: the stem fused with the upper arm, the leg set off by a thin diagonal gap, and a small
foot under the stem set off by a curved gap. The owner (2026-11-24) asked for the K of the LED wall, the counter's plaque, the bell's
plate and the shop sign to be "the same as the logo". The earlier K (a thresholded render, then patched) had its foot joined to the
stem and a wobbling stroke; the counter's before it was a different letter. What is pinned here: the colour is one flat palette step,
each size has the parts the size allows (three at 31 and 15 px, two at 7 and 5), the gaps are whole pixels where the size allows
(the diagonal gap one pixel on every row where the arm and the leg run side by side, the foot's gap one pixel in every column), the
strokes are even, and each bitmap overlaps the vector rendered at its size (the overlap is the area-weighted intersection over union,
pinned with a margin below what was measured: 0.936, 0.886, 0.702, 0.639).

Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_kmark.py"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(SOURCE / 'hq-office'))
import kmark  # noqa: E402

ICON = SOURCE / 'brand' / 'logo-konclui-icon.svg'
OFFICE_HEX = SOURCE / 'tools' / 'palettes' / 'office.hex'


def components(mask):
    """4-connected components of a boolean array: (label array, count)."""
    lab = np.zeros(mask.shape, int)
    n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1
        todo = [(y0, x0)]
        while todo:
            y, x = todo.pop()
            if 0 <= y < mask.shape[0] and 0 <= x < mask.shape[1] and mask[y, x] and not lab[y, x]:
                lab[y, x] = n
                todo += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return lab, n


def parts(mask):
    """(main, leg, foot or None) as boolean arrays: the component that touches the top row is the stem and arm, the one at the
    bottom-right the leg, the one at the bottom-left the foot."""
    lab, n = components(mask)
    out = {}
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if ys.min() == 0:
            out['main'] = lab == i
        elif xs.min() == 0:
            out['foot'] = lab == i
        else:
            out['leg'] = lab == i
    return out


def vector_coverage(w, h):
    """The three paths of the official K, antialiased, on a w x h grid (the whole 163 x 162 box mapped onto it): 0 to 1."""
    svg = ICON.read_text()
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'k.svg', Path(tmp) / 'k.png'
        ss = 16
        src.write_text(svg.replace('<svg width="163" height="162"', f'<svg width="{w * ss}" height="{h * ss}" preserveAspectRatio="none"', 1))
        subprocess.run(['rsvg-convert', str(src), '-o', str(dst)], check=True)
        from PIL import Image
        a = np.asarray(Image.open(dst).convert('RGBA'))[..., 3].astype(float) / 255
    return a.reshape(h, ss, w, ss).mean((1, 3))


class Colour(unittest.TestCase):
    def test_the_white_is_one_flat_palette_step_nearest_the_logos(self):
        steps = [l.strip().upper() for l in OFFICE_HEX.read_text().split() if l.strip()]
        steps = ['#' + s.lstrip('#') for s in steps]
        self.assertIn(kmark.WHITE.upper(), steps)
        logo = np.array([0xFB, 0xFB, 0xFB])
        near = min(steps, key=lambda s: int(((np.array([int(s[i:i + 2], 16) for i in (1, 3, 5)]) - logo) ** 2).sum()))
        self.assertEqual(near, kmark.WHITE.upper())


class Shapes(unittest.TestCase):
    def test_sizes(self):
        self.assertEqual(kmark.mask(kmark.K_WALL).shape, (31, 30))
        self.assertEqual(kmark.mask(kmark.K_PLAQUE).shape, (15, 15))
        self.assertEqual(kmark.mask(kmark.K_BELL).shape, (7, 7))
        self.assertEqual(kmark.mask(kmark.K_SIGN).shape, (5, 5))
        for name in ('K_WALL', 'K_PLAQUE', 'K_BELL', 'K_SIGN'):
            rows = getattr(kmark, name)
            self.assertEqual({len(r) for r in rows}, {len(rows[0])}, name)
            self.assertEqual(set(''.join(rows)), {'#', '.'}, name)

    def test_the_three_parts_where_the_size_allows(self):
        for name in ('K_WALL', 'K_PLAQUE'):
            p = parts(kmark.mask(getattr(kmark, name)))
            self.assertEqual(sorted(p), ['foot', 'leg', 'main'], name)
        for name in ('K_BELL', 'K_SIGN'):                          # too small for the foot's gap: the stem and the foot are one
            p = parts(kmark.mask(getattr(kmark, name)))
            self.assertEqual(sorted(p), ['leg', 'main'], name)

    def test_the_diagonal_gap_is_one_pixel_where_the_arm_and_the_leg_run_side_by_side(self):
        for name, rows in (('K_WALL', range(17, 21)), ('K_PLAQUE', range(8, 11)), ('K_BELL', range(4, 5))):
            p = parts(kmark.mask(getattr(kmark, name)))
            for r in rows:
                last_main = np.nonzero(p['main'][r])[0].max()
                first_leg = np.nonzero(p['leg'][r])[0].min()
                self.assertEqual(first_leg - last_main - 1, 1, f'{name} row {r}')

    def test_the_foots_gap_is_one_pixel_in_every_column(self):
        for name, cols in (('K_WALL', range(0, 8)), ('K_PLAQUE', range(0, 4))):
            p = parts(kmark.mask(getattr(kmark, name)))
            for c in cols:
                low_main = np.nonzero(p['main'][:, c])[0].max()
                top_foot = np.nonzero(p['foot'][:, c])[0].min()
                self.assertEqual(top_foot - low_main - 1, 1, f'{name} column {c}')

    def test_the_strokes_are_even(self):
        w = kmark.mask(kmark.K_WALL)
        p = parts(w)
        stem = {int(w[r, :12].argmin()) for r in range(7, 13)}                 # the stem alone, left of the notch
        self.assertEqual(stem, {8})
        arm = {int(p['main'][r].sum() - (8 if r >= 7 else 0)) for r in range(2, 7)}
        self.assertEqual(arm, {10})
        self.assertEqual({int(p['leg'][r].sum()) for r in range(21, 28)}, {10})
        q = kmark.mask(kmark.K_PLAQUE)
        pq = parts(q)
        self.assertEqual({int(pq['main'][r].sum()) for r in range(0, 3)}, {5})   # the arm
        self.assertEqual({int(q[r, :6].argmin()) for r in range(3, 6)}, {4})      # the stem
        self.assertEqual({int(pq['leg'][r].sum()) for r in range(10, 15)}, {5})

    def test_the_foot_is_under_the_stem_and_not_wider(self):
        for name in ('K_WALL', 'K_PLAQUE'):
            m = kmark.mask(getattr(kmark, name))
            p = parts(m)
            stem_w = int(p['main'][m.shape[0] // 2 - 4].argmin())               # the stem's width, read above the arm's join
            xs = np.nonzero(p['foot'].any(0))[0]
            self.assertEqual((int(xs.min()), int(xs.max())), (0, stem_w - 1), name)


@unittest.skipUnless(shutil.which('rsvg-convert'), 'rsvg-convert is not installed')
class AgainstTheVector(unittest.TestCase):
    def soft_iou(self, name, w, h):
        cov = np.clip(vector_coverage(w, h), 0, 1)
        m = kmark.mask(getattr(kmark, name)).astype(float)
        m = np.pad(m, ((0, h - m.shape[0]), (0, w - m.shape[1])))
        return np.minimum(m, cov).sum() / np.maximum(m, cov).sum()

    def test_each_bitmap_overlaps_the_logo_rendered_at_its_size(self):
        for name, (w, h), floor in (('K_WALL', (31, 31), 0.92), ('K_PLAQUE', (15, 15), 0.87),
                                    ('K_BELL', (7, 7), 0.68), ('K_SIGN', (5, 5), 0.62)):
            self.assertGreaterEqual(self.soft_iou(name, w, h), floor, name)


if __name__ == '__main__':
    unittest.main()
