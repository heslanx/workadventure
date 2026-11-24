"""Behaviour tests of hq-office/lawn.py: the ground (no period, no seam, few tiles, only the lawn's colours, the same
picture on every run) and the decor (tufts, flower clumps, pebbles, placement, the gust's redraw budget, the path fringe).
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_lawn.py
LAWN_FILE=/path/to/lawn.py python3 -I tools/test_lawn.py   tests another copy of the module instead (how each test was
checked to fail on HEAD's lawn.py, which repeats a 12 x 12 tile stamp). No build and no external tool: the module draws
its pictures in a couple of seconds."""
import hashlib
import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(SOURCE / 'hq-office'))
import plan as P  # noqa: E402


def load_module():
    target = os.environ.get('LAWN_FILE')
    if not target:
        import lawn
        return lawn
    spec = importlib.util.spec_from_file_location('lawn_under_test', target)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


L = load_module()
T = 32
# The most distinct 32 px tiles the lawn may add to the floor sheet (MEASURED: ground_tiles() is 102 on the whole map, of
# which about 85 reach the sheet; HEAD's stamp is 72). The sheet's size is derived, not capped; this keeps it honest.
TILE_BUDGET = 110


def ground_map():
    """What build.paint puts on the map: the texture, repeated from the origin if it is smaller than the map (HEAD's is
    384 px square), cut to W x H tiles."""
    tex = np.asarray(L.texture().convert('RGBA'))
    reps = (-(-P.H * T // tex.shape[0]), -(-P.W * T // tex.shape[1]), 1)
    return np.tile(tex, reps)[:P.H * T, :P.W * T]


def tile_grid(img):
    """(H, W) array of ints, one per 32 px tile: equal ints are the same picture."""
    ids, out = {}, np.zeros((img.shape[0] // T, img.shape[1] // T), int)
    for ty in range(out.shape[0]):
        for tx in range(out.shape[1]):
            key = hashlib.sha1(img[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T].tobytes()).digest()
            out[ty, tx] = ids.setdefault(key, len(ids))
    return out


class Ground(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.img = ground_map()
        cls.grid = tile_grid(cls.img)

    def test_texture_covers_the_map_so_the_mask_in_build_py_sees_every_cell_at_its_own_place(self):
        # build.py picks a cell's grass from texture.crop(tx % n, ty % n) with n = width // 32: the same cell only when the
        # texture covers the map (HEAD's 12-tile stamp wraps)
        tex = L.texture()
        self.assertGreaterEqual(tex.width // T, P.W)
        self.assertGreaterEqual(tex.height // T, P.H)
        self.assertGreaterEqual(tex.width // T, P.H)          # tx % n and ty % n use the same n

    def test_no_tile_picture_returns_at_a_fixed_offset(self):
        """For every offset of up to 40 tiles, the share of 2 x 2 tile blocks that equal the block at that offset. A repeated
        stamp makes it 1.0 at its period; a random pick among a few dozen tiles leaves it near 0."""
        g = self.grid
        h, w = g.shape
        block = g[:-1, :-1] * 100003 + g[:-1, 1:] * 1009 + g[1:, :-1] * 31 + g[1:, 1:]          # one id per 2 x 2 block
        bh, bw = block.shape
        worst = (0, None)
        for dy in range(0, 41):
            for dx in range(-40, 41):
                if (dy, dx) <= (0, 0) or dy >= bh or abs(dx) >= bw:
                    continue
                a = block[dy:, max(0, dx):bw + min(0, dx)]
                b = block[:bh - dy, max(0, -dx):bw - max(0, dx)]
                share = float((a == b).mean())
                if share > worst[0]:
                    worst = (share, (dx, dy))
        self.assertLess(worst[0], 0.05, f'2 x 2 tile blocks repeat at offset {worst[1]} tiles: {worst[0]:.0%} of them')

    def test_no_peak_in_the_autocorrelation_of_the_ground(self):
        """The ground's luminance correlated with itself shifted by more than 256 px (a patch of tone is up to 8 tiles
        wide, so it correlates with itself over shorter shifts) while at least half the map still overlaps, at full size
        and at half size (the overview). MEASURED: 0.04 and 0.06 now, 0.86 at a shift of 384 px (HEAD's stamp)."""
        for scale in (1, 2):
            lum = self.img[..., :3].astype(float) @ [0.299, 0.587, 0.114]
            lum = lum.reshape(lum.shape[0] // scale, scale, lum.shape[1] // scale, scale).mean((1, 3))
            lum -= lum.mean()
            f = np.fft.rfft2(lum, s=(lum.shape[0] * 2, lum.shape[1] * 2))
            ac = np.fft.irfft2(f * np.conj(f))
            ac = ac / ac[0, 0]
            h, w = lum.shape
            dy = np.minimum(np.arange(ac.shape[0]), ac.shape[0] - np.arange(ac.shape[0]))[:, None] * scale
            dx = np.minimum(np.arange(ac.shape[1]), ac.shape[1] - np.arange(ac.shape[1]))[None, :] * scale
            far = (np.hypot(dy, dx) > 256) & (dy <= h * scale // 2) & (dx <= w * scale // 2)
            peak = ac[far].max()
            self.assertLess(peak, 0.2, f'the ground correlates with itself at {peak:.2f} at a shift beyond 256 px (1:{scale})')

    def test_a_tile_border_is_no_seam(self):
        """Neighbouring pixels across a tile border differ as often as neighbouring pixels inside a tile do (a seam is a
        border that differs more), along both axes."""
        img = self.img[..., :3].astype(int)
        for axis in (1, 0):
            d = np.abs(np.diff(img, axis=axis)).sum(-1) > 0                  # pixel pair differs
            across = np.arange(d.shape[axis]) % T == T - 1
            rate_border = d.take(np.where(across)[0], axis=axis).mean()
            rate_inside = d.take(np.where(~across)[0], axis=axis).mean()
            self.assertLessEqual(rate_border, rate_inside * 1.25,
                                 f'axis {axis}: {rate_border:.3f} of the pixel pairs across a border differ, {rate_inside:.3f} inside')

    def test_the_lawn_adds_a_bounded_number_of_tiles_to_the_floor_sheet(self):
        n = int(self.grid.max()) + 1
        self.assertLessEqual(n, TILE_BUDGET, f'{n} different 32 px tiles')

    def test_only_the_lawns_greens_are_used(self):
        colours = {tuple(int(v) for v in c) for c in np.unique(self.img[..., :3].reshape(-1, 3), axis=0)}
        allowed = {tuple(L.GRASS[k]) for k in ('deep', 'dark', 'shade', 'base', 'sun', 'light', 'tip')}
        self.assertLessEqual(colours, allowed)
        self.assertTrue((self.img[..., 3] == 255).all())

    def test_the_patches_stay_a_minority_so_no_tone_reads_as_a_shadow(self):
        flat = self.img[..., :3].reshape(-1, 3)
        share = lambda c: float((flat == np.array(c)).all(-1).mean())      # noqa: E731
        self.assertLess(share(L.GRASS['shade']), 0.12)
        self.assertLess(share(L.GRASS['sun']), 0.25)
        self.assertGreater(share(L.GRASS['base']), 0.5)

    def test_the_same_picture_on_every_run_and_every_hash_seed(self):
        here = hashlib.sha256(L.texture().tobytes()).hexdigest()
        code = ('import hashlib, importlib.util, os, sys\n'
                f'sys.path.insert(0, {str(SOURCE / "hq-office")!r})\n'
                f'target = os.environ.get("LAWN_FILE") or {str(SOURCE / "hq-office" / "lawn.py")!r}\n'
                'spec = importlib.util.spec_from_file_location("lawn_sub", target)\n'
                'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n'
                'print(hashlib.sha256(m.texture().tobytes()).hexdigest())\n')
        for seed in ('1', '2'):
            out = subprocess.run([sys.executable, '-I', '-c', code], capture_output=True, text=True, check=True,
                                 env={**os.environ, 'PYTHONHASHSEED': seed}).stdout.strip()
            self.assertEqual(out, here)

    def test_a_cell_is_decorated_whatever_is_around_it(self):
        """decor() of a cell does not depend on the other cells given (build.py passes the cells nothing is painted over)."""
        cells = [(5, 60 - 20), (6, 40), (7, 40), (30, 3), (31, 3)]
        both = L.decor(cells)
        for c in cells:
            alone = L.decor([c])
            self.assertEqual(set(alone), set(both) & {c})
            for k, v in alone.items():
                self.assertEqual([f.tobytes() for f in v], [f.tobytes() for f in both[k]])


def tuft_cells(count=400):
    """Cells whose decor is a swaying tuft (several frames)."""
    cells = [(x, y) for y in range(0, 6) for x in range(0, 86)]
    return {c: v for c, v in L.decor(cells).items() if len(v) > 1}


class Gust(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tufts = tuft_cells()

    @staticmethod
    def change_frames(frames):
        """The frames (of the loop) on which a tile's picture differs from the frame before; the loop wraps."""
        keys = [f.tobytes() for f in frames]
        return tuple(k for k in range(len(keys)) if keys[k] != keys[k - 1])

    def test_there_are_swaying_tufts(self):
        self.assertGreater(len(self.tufts), 20)

    def test_the_first_frames_are_the_rest_pose_so_animations_off_shows_a_still_lawn(self):
        for frames in self.tufts.values():
            self.assertEqual(frames[0].tobytes(), frames[L.GUST_AT - 1].tobytes())

    def test_every_tuft_changes_picture_on_the_same_few_frames_only(self):
        """The owner's idle budget (19/10/2026, perf.py): the engine redraws when a visible animated tile changes picture, so
        the union of the frames on which any tuft changes stays 5 per cycle."""
        union = set()
        for frames in self.tufts.values():
            union |= set(self.change_frames(frames))
        self.assertLessEqual(len(union), 5, sorted(union))

    def test_the_tufts_do_not_all_gust_the_same_way(self):
        """HEAD: two shapes (one per reach), all starting on the first frame. Now several start later, skip a step or lean
        less, inside the same frames."""
        patterns = {self.change_frames(frames) for frames in self.tufts.values()}
        self.assertGreaterEqual(len(patterns), 5, sorted(patterns))
        starts = {p[0] for p in patterns}
        self.assertGreaterEqual(len(starts), 2, f'every tuft starts on the same frame: {starts}')


def opaque(img):
    a = np.asarray(img)
    return a[..., 3] == 255, a[..., :3]


def pixels_of(img, colour):
    ok, rgb = opaque(img)
    return ok & (rgb == np.array(colour)).all(-1)


def decor_cells():
    """Every kind of decor picture the lawn makes: {'tuft': [...], 'flowers': [...], 'clover': [...], 'pebbles': [...]},
    told apart by the colours they hold (flowers: a petal colour; pebbles: stone grey)."""
    cells = [(x, y) for y in range(0, 56) for x in range(0, 86)]
    out = {}
    for c, frames in L.decor(cells).items():
        img = frames[0]
        key = 'tuft' if len(frames) > 1 else None
        if key is None:
            petal = any(pixels_of(img, p).any() for p, _ in L.FLOWERS)
            stone = any(pixels_of(img, L.STONE[k]).any() for k in ('base', 'light'))
            key = 'flowers' if petal else 'pebbles' if stone else 'clover'
        out.setdefault(key, {})[img.tobytes()] = img
    return {k: list(v.values()) for k, v in out.items()}


class Decor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pictures = decor_cells()

    def test_all_four_kinds_are_made(self):
        self.assertEqual(set(self.pictures), {'tuft', 'flowers', 'clover', 'pebbles'})

    def test_a_tuft_has_no_dark_contact_line(self):
        """HEAD: a row of 3e8a52 under every tuft and at the root of its back blades, which reads as a line on the ground."""
        for img in self.pictures['tuft']:
            self.assertFalse(pixels_of(img, L.GRASS['deep']).any())

    def test_a_pebble_is_two_flat_tones_the_same_on_every_side(self):
        for img in self.pictures['pebbles']:
            ok, rgb = opaque(img)
            stone = np.zeros(ok.shape, bool)
            tones = set()
            for k in ('shadow', 'base', 'light'):
                mask = pixels_of(img, L.STONE[k])
                stone |= mask
                if mask.any():
                    tones.add(k)
            self.assertEqual(tones, {'base', 'light'}, f'stone tones in a pebble picture: {tones}')
            for y in range(ok.shape[0]):                        # a row of stone has one colour: nothing is lit on one end
                row = {tuple(rgb[y, x]) for x in range(ok.shape[1]) if stone[y, x]}
                self.assertLessEqual(len(row), 1, f'row {y} of a pebble has {len(row)} stone colours')

    def test_a_flower_clump_has_5_to_7_heads_each_on_a_visible_stem(self):
        for img in self.pictures['flowers']:
            pair = [(p, c) for p, c in L.FLOWERS if pixels_of(img, p).any() and pixels_of(img, c).any()]
            self.assertEqual(len(pair), 1)             # one flower colour per clump (a petal colour is another's centre)
            centre = pair[0][1]
            centres = np.argwhere(pixels_of(img, centre))
            self.assertTrue(5 <= len(centres) <= 7, f'{len(centres)} heads')
            deep = pixels_of(img, L.GRASS['deep'])
            for y, x in centres:
                stem = int(deep[y + 1:y + 6, x].sum())
                self.assertGreaterEqual(stem, 3, f'the head at ({x}, {y}) has a stem {stem} px tall')

    def test_a_flower_head_is_never_a_lone_pixel(self):
        for img in self.pictures['flowers']:
            for p, c in L.FLOWERS:
                if not (pixels_of(img, p).any() and pixels_of(img, c).any()):
                    continue
                head = pixels_of(img, p) | pixels_of(img, c)
                padded = np.pad(head, 1)
                for y, x in np.argwhere(head):
                    near = padded[y:y + 3, x:x + 3].sum() - 1
                    self.assertGreaterEqual(int(near), 1, f'a lone head pixel at ({x}, {y})')

    def test_no_decor_stands_behind_the_south_facades_glass(self):
        cells = [(x, y) for y in (P.BY1 - 1, P.BY1, P.BY1 + 1, P.BY1 + 2) for x in range(P.vb(P.BX0) - 1, P.vb(P.BX1) + 1)]
        placed = L.decor(cells)
        inside = [c for c in placed if P.BY1 <= c[1] < P.BY1 + 2 and P.vb(P.BX0) <= c[0] < P.vb(P.BX1)]
        self.assertEqual(inside, [])
        self.assertTrue(any(c[1] in (P.BY1 - 1, P.BY1 + 2) for c in placed), 'the rows beside the facade are decorated')


class Fringe(unittest.TestCase):
    def test_the_blades_over_a_path_edge_take_the_tone_of_the_lawn_beside_them(self):
        """On a patch of the shadier tone the fringe's body is that tone, not the base green."""
        canvas = Image.new('RGBA', (64, 64), (*L.GRASS['shade'], 255))
        canvas.paste(Image.new('RGBA', (32, 64), (200, 200, 200, 255)), (32, 0))          # the path, east of x = 32
        L.fringe(canvas, 32, 4, 60, +1)
        a = np.asarray(canvas)
        self.assertFalse((a[..., :3] == np.array(L.GRASS['base'])).all(-1).any(), 'a base-green pixel on a shady lawn')
        grew = (a[4:60, 32:36, :3] == np.array(L.GRASS['shade'])).all(-1).any()
        self.assertTrue(grew, 'the fringe painted nothing in the lawn tone')


if __name__ == '__main__':
    unittest.main()
