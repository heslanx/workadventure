"""Behaviour tests of tools/gridguard.py: the three outcomes, every refusal reason, the proven range, the agreement, the
coarser-grid check, the screens of a PASS_THROUGH (blocky, resampled), the registration of an ACCEPT, determinism, and that
nothing is written to the arrays it is given.

No tool runs here and no file is read: the pictures are drawn in the tests (art on a grid, enlarged the way the lab enlarged
it: nearest neighbour, with a blur and noise, bilinear) and the snapper's answer is handed over as an array, so every case
is exact. What the real snapper answers for such pictures is tested in test_ingest.py.
Run (from assets/konclui/source): python3 -I tools/test_gridguard.py"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gridguard as GG  # noqa: E402

COLOURS = np.array([(200, 60, 40), (40, 120, 200), (240, 200, 60), (30, 30, 40), (90, 200, 120)], np.uint8)


def art(width=32, height=32, seed=3, alpha='binary'):
    """Art natively on its grid: an ellipse of random pixels from five colours. `alpha`: 'binary' (clear outside), 'opaque',
    or 'partial' (a soft rim of 128 around the ellipse)."""
    r = np.random.default_rng(seed)
    px = np.zeros((height, width, 4), np.uint8)
    px[..., :3] = COLOURS[r.integers(0, len(COLOURS), (height, width))]
    px[..., 3] = 255
    yy, xx = np.mgrid[0:height, 0:width]
    d = (xx - width / 2 + .5) ** 2 / (width * .5) ** 2 + (yy - height / 2 + .5) ** 2 / (height * .5) ** 2
    if alpha == 'opaque':
        return px
    px[d >= 1] = 0
    if alpha == 'partial':
        rim = (d >= 0.8) & (d < 1)
        px[rim, 3] = 128
    return px


def enlarge(px, k):
    """Nearest-neighbour enlargement by a whole factor."""
    return np.repeat(np.repeat(px, k, axis=0), k, axis=1)


def model_like(px, k=8, blur=0.8, noise=4, seed=0):
    """What an image model hands back: the art enlarged, blurred a little, with a little colour noise."""
    image = Image.fromarray(enlarge(px, k), 'RGBA').convert('RGBa').filter(ImageFilter.GaussianBlur(blur)).convert('RGBA')
    a = np.asarray(image).astype(np.int16)
    a[..., :3] += np.random.default_rng(seed).integers(-noise, noise + 1, a[..., :3].shape)
    return np.clip(a, 0, 255).astype(np.uint8)


def bilinear(px, width, height):
    """A non-integer enlargement, premultiplied bilinear (the lab's x7.3b)."""
    return np.asarray(Image.fromarray(px, 'RGBA').convert('RGBa').resize((width, height), Image.BILINEAR).convert('RGBA'))


def resampled(px, width, height, filt=Image.BILINEAR):
    """`px` resampled to width x height with premultiplied alpha, the way an image tool enlarges (bilinear unless told)."""
    return np.asarray(Image.fromarray(px, 'RGBA').convert('RGBa').resize((width, height), filt).convert('RGBA'))


def runs(width=96, height=128, seed=3, p=0.5):
    """Art that looks drawn rather than random: every pixel repeats its left or upper neighbour with probability `p`, else takes
    a new colour out of five, so it has flat runs and cuts between them; an ellipse, clear outside. (art() is noise: a
    per-pixel random picture has hardly any flat run for a resampler to blend, see the known-gap test.)"""
    r = np.random.default_rng(seed)
    index = np.zeros((height, width), int)
    for y in range(height):
        for x in range(width):
            if x and r.random() < p:
                index[y, x] = index[y, x - 1]
            elif y and r.random() < p:
                index[y, x] = index[y - 1, x]
            else:
                index[y, x] = r.integers(0, len(COLOURS))
    px = np.zeros((height, width, 4), np.uint8)
    px[..., :3] = COLOURS[index]
    px[..., 3] = 255
    yy, xx = np.mgrid[0:height, 0:width]
    px[(xx - width / 2 + .5) ** 2 / (width * .5) ** 2 + (yy - height / 2 + .5) ** 2 / (height * .5) ** 2 >= 1] = 0
    return px


def dots(width=64, height=64, density=0.045, seed=1):
    """One flat colour with single pixels of the other colours scattered over it: opaque art that is mostly flat, so that
    most of it reads the same one pixel over, but has detail at the finest grain (a 2x2 read of it loses about 5%)."""
    r = np.random.default_rng(seed)
    px = np.zeros((height, width, 4), np.uint8)
    px[..., :3] = COLOURS[1]
    px[..., 3] = 255
    scattered = r.random((height, width)) < density
    px[scattered, :3] = COLOURS[r.integers(0, len(COLOURS), int(scattered.sum()))]
    return px


def frozen(*arrays):
    """The arrays made read-only: a function that writes into one raises ValueError."""
    for a in arrays:
        a.flags.writeable = False
    return arrays


def decide(pixels, snapped, family=None, **kw):
    return GG.decide(pixels, snapped, 32, GG.family_contract(family), **kw)


class PassThrough(unittest.TestCase):
    def test_art_the_snapper_returned_unchanged_is_on_its_grid(self):
        native = art(96, 128)
        d = decide(native, native.copy(), 'avatars')
        self.assertEqual((d.outcome, d.reason), (GG.PASS_THROUGH, 'on-grid'))
        self.assertEqual(d.evidence['input'], [96, 128])
        self.assertEqual(d.evidence['alphaClass'], 'binary')
        self.assertIn('unchanged', d.message)

    def test_the_family_size_is_not_part_of_a_pass_through(self):
        """A 16x16 picture is on its grid; that it is not an office size is the contract check's rejection, with its own reason."""
        self.assertEqual(decide(art(16, 16), art(16, 16), 'office').outcome, GG.PASS_THROUGH)
        self.assertEqual(decide(art(32, 32), art(32, 32), 'avatars').outcome, GG.PASS_THROUGH)

    def test_the_colour_under_a_clear_pixel_is_not_art(self):
        native = art()
        hidden = native.copy()
        hidden[native[..., 3] == 0, :3] = (7, 8, 9)
        self.assertEqual(decide(native, hidden).outcome, GG.PASS_THROUGH)

    def test_a_different_alpha_or_colour_is_not_the_same_pixels(self):
        native = art()
        for label, mutate in {'a colour': lambda p: p.__setitem__((16, 16, 0), (int(p[16, 16, 0]) + 1) % 256),
                              'an alpha': lambda p: p.__setitem__((16, 16, 3), 254),
                              'a clear pixel made visible': lambda p: p.__setitem__((0, 0), (1, 2, 3, 255))}.items():
            changed = native.copy()
            mutate(changed)
            with self.subTest(label):
                d = decide(native, changed)
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'on-grid-altered'))
                self.assertIn('changed the art', d.message)

    def test_pixel_size_one_is_an_assertion_and_is_recorded_as_one(self):
        native = art()
        d = decide(native, native.copy(), pixel_size=1)
        self.assertEqual((d.outcome, d.reason), (GG.PASS_THROUGH, 'on-grid-asserted'))
        self.assertIn('asserted', d.message)
        self.assertEqual(d.evidence['pixelSize'], 1)
        blank = np.zeros((128, 96, 4), np.uint8)
        self.assertEqual(decide(blank, blank.copy(), pixel_size=1).reason, 'on-grid-asserted')     # a blank layer is a layer
        shrunk = decide(enlarge(native, 2), native, pixel_size=1)
        self.assertEqual((shrunk.outcome, shrunk.reason), (GG.REFUSE, 'on-grid-altered'))

    def test_nothing_visible_and_nothing_asserted_proves_nothing(self):
        blank = np.zeros((32, 32, 4), np.uint8)
        d = decide(blank, blank.copy())
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'blank-input'))


class PassThroughScreens(unittest.TestCase):
    """The snapper returns an enlargement below 3.5x unchanged (it cannot tell it from art on its grid, MEASURED: 184 of 857 such
    pictures of the lab's art came back as they were). The guard looks for the trace the enlargement leaves in the INPUT."""

    avatars = GG.family_contract('avatars')

    def test_a_picture_made_of_blocks_is_refused_although_the_snapper_returned_it(self):
        for k, (width, height), family in ((2, (96, 128), 'avatars'), (3, (96, 96), 'office'), (4, (96, 128), 'avatars')):
            with self.subTest(factor=k):
                picture = enlarge(runs(width // k, height // k), k)
                d = decide(picture, picture.copy(), family)
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'input-blocky'), d.message)
                self.assertGreaterEqual(d.evidence['selfCoarseAgreement'][str(k)], GG.SELF_COARSE_MAX)
                self.assertEqual(d.evidence['selfCoarseMax'], GG.SELF_COARSE_MAX)
                self.assertIn('pixel size 1', d.message)

    def test_a_resampled_picture_is_refused_although_the_snapper_returned_it(self):
        for label, picture in {'bilinear 2x': resampled(runs(48, 64), 96, 128),
                               'bilinear 2.5x': resampled(runs(38, 51), 96, 128),
                               'bicubic 2x': resampled(runs(48, 64), 96, 128, Image.BICUBIC)}.items():
            with self.subTest(label):
                d = decide(picture, picture.copy(), 'avatars')
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'input-resampled'), d.message)
                self.assertGreaterEqual(d.evidence['blendShare'], GG.BLEND_MAX)
                self.assertEqual(d.evidence['blendMax'], GG.BLEND_MAX)
                self.assertIn('pixel size 1', d.message)

    def test_native_art_passes_with_the_numbers_that_show_it_is_clear_of_both_traces(self):
        natives = {'avatar': (runs(96, 128), 'avatars'), 'avatar, noise': (art(96, 128), 'avatars'),
                   'pet strip': (runs(512, 64, seed=5), 'pets'), 'office, opaque': (art(32, 32, alpha='opaque'), 'office'),
                   'office, soft rim': (art(64, 64, alpha='partial'), 'office')}
        for label, (native, family) in natives.items():
            with self.subTest(label):
                d = decide(native, native.copy(), family)
                self.assertEqual((d.outcome, d.reason), (GG.PASS_THROUGH, 'on-grid'), d.message)
                self.assertLess(d.evidence['blendShare'], GG.BLEND_MAX)
                self.assertLess(max(d.evidence['selfCoarseAgreement'].values()), GG.SELF_COARSE_MAX)
                self.assertIn('no trace', d.message)

    def test_pixel_size_one_is_the_callers_word_and_is_not_screened(self):
        for label, picture in {'blocky': enlarge(runs(48, 64), 2), 'resampled': resampled(runs(48, 64), 96, 128)}.items():
            with self.subTest(label):
                self.assertEqual(decide(picture, picture.copy(), 'avatars').outcome, GG.REFUSE)
                d = decide(picture, picture.copy(), 'avatars', pixel_size=1)
                self.assertEqual((d.outcome, d.reason), (GG.PASS_THROUGH, 'on-grid-asserted'))
                self.assertNotIn('blendShare', d.evidence)

    def test_a_refusal_by_the_blend_screen_does_not_run_the_coarse_one(self):
        picture = resampled(runs(38, 51), 96, 128)
        d = decide(picture, picture.copy(), 'avatars')
        self.assertIn('blendShare', d.evidence)
        self.assertNotIn('selfCoarseAgreement', d.evidence)

    def test_known_gap_a_lanczos_enlargement_and_an_enlarged_noise_picture_are_not_seen(self):
        """The screens are a screen, not a proof (tools/README.md, "Is it on its grid?"): Lanczos rings, so few pixels are exact
        blends (MEASURED on the lab's art: a quarter of them under BLEND_MAX), and a picture with no flat run at all, enlarged
        2x with bilinear, has few collinear triples and does not read back from every 2nd pixel. Both pass. If this test fails
        the guard got better: say so in the README and flip it."""
        lanczos = resampled(runs(48, 64), 96, 128, Image.LANCZOS)
        noise = resampled(art(48, 64), 96, 128)
        for label, picture in {'lanczos 2x': lanczos, 'noise, bilinear 2x': noise}.items():
            with self.subTest(label):
                self.assertEqual(decide(picture, picture.copy(), 'avatars').outcome, GG.PASS_THROUGH)


class Accept(unittest.TestCase):
    def test_a_clean_8x_enlargement_is_accepted(self):
        native = art()
        d = decide(enlarge(native, 8), native, 'office')
        self.assertEqual((d.outcome, d.reason), (GG.ACCEPT, 'enlargement-proven'))
        self.assertEqual(d.evidence['factor'], [8.0, 8.0])
        self.assertEqual(d.evidence['agreement'], 1.0)
        self.assertEqual(d.evidence['snapped'], [32, 32])
        self.assertLess(max(d.evidence['coarseAgreement'].values()), GG.COARSE_MAX)

    def test_a_blurred_and_noisy_enlargement_is_accepted_at_the_native_size(self):
        native = art()
        d = decide(model_like(native), native, 'office')
        self.assertEqual((d.outcome, d.reason), (GG.ACCEPT, 'enlargement-proven'), d.message)
        self.assertGreaterEqual(d.evidence['agreement'], GG.AGREEMENT_MIN)

    def test_every_alpha_class_is_accepted(self):
        for kind in ('opaque', 'binary', 'partial'):
            native = art(alpha=kind)
            for label, picture in {'clean': enlarge(native, 8), 'model': model_like(native)}.items():
                with self.subTest(kind=kind, picture=label):
                    d = decide(picture, native, 'office')
                    self.assertEqual(d.outcome, GG.ACCEPT, d.message)
                    self.assertEqual(d.evidence['alphaClass'], GG.alpha_class(picture))
        self.assertEqual(GG.alpha_class(art(alpha='opaque')), 'opaque')
        self.assertEqual(GG.alpha_class(art(alpha='binary')), 'binary')
        self.assertEqual(GG.alpha_class(art(alpha='partial')), 'partial')

    def test_a_non_integer_and_an_unequal_enlargement_are_accepted(self):
        native = art()
        for label, (width, height) in {'7.3x': (234, 234), '9.6x': (307, 307), '7.8x by 8.2x': (250, 262)}.items():
            with self.subTest(label):
                d = decide(bilinear(native, width, height), native, 'office')
                self.assertEqual(d.outcome, GG.ACCEPT, d.message)

    def test_the_family_sizes_decide(self):
        sheet = art(96, 128)
        self.assertEqual(decide(enlarge(sheet, 8), sheet, 'avatars').outcome, GG.ACCEPT)
        pet = art(512, 64)
        self.assertEqual(decide(enlarge(pet, 4), pet, 'pets').outcome, GG.ACCEPT)
        self.assertEqual(decide(enlarge(art(), 8), art(), 'office').outcome, GG.ACCEPT)

    def test_a_given_pixel_size_that_matches_the_result_is_accepted(self):
        native = art()
        self.assertEqual(decide(enlarge(native, 8), native, 'office', pixel_size=8).outcome, GG.ACCEPT)


class Refuse(unittest.TestCase):
    """One case per reason: `CASES` names them all, and a test checks that no reason of gridguard.REASONS is left out."""

    native = art()

    def cases(self):
        native = self.native
        big = enlarge(native, 8)
        return {
            'tool-unresolved': lambda: decide(big, GG.ToolRefusal('unresolved', 'Error: Could not resolve a pixel grid')),
            'tool-failed': lambda: decide(big, GG.ToolRefusal('failed', 'boom')),
            'tool-unreadable': lambda: decide(big, GG.ToolRefusal('unreadable', 'not a png')),
            'blank-input': lambda: decide(np.zeros((256, 256, 4), np.uint8), native),
            'on-grid-altered': lambda: decide(native, np.roll(native, 1, axis=1)),
            'off-grid-size': lambda: decide(big, np.insert(native, 16, native[:, 16], axis=1)),               # 33x32: one cell too many
            'family-size': lambda: decide(big, native, 'avatars'),
            'factor-out-of-range': lambda: decide(enlarge(native, 16), native),
            'factor-unequal': lambda: decide(np.repeat(np.repeat(native, 8, axis=1), 10, axis=0), native),    # 8x by 10x
            'pixel-size-mismatch': lambda: decide(big, native, pixel_size=5),
            'reenlargement-disagrees': lambda: decide(big, art(seed=9)),
            'reenlargement-unmeasurable': lambda: decide(self.rim_only(big), np.zeros_like(native)),
            'coarser-grid-explains': lambda: decide(big, enlarge(native, 2)),
            'registration-ambiguous': lambda: decide(enlarge(self.stripes(), 8), self.stripes(), 'office'),
            'input-blocky': lambda: decide(enlarge(runs(48, 64), 2), enlarge(runs(48, 64), 2), 'avatars'),
            'input-resampled': lambda: decide(resampled(runs(48, 64), 96, 128), resampled(runs(48, 64), 96, 128), 'avatars'),
        }

    @staticmethod
    def stripes():
        """32x32 art whose rows are random colours and whose columns are all alike: nothing in it tells a move along a row."""
        px = np.zeros((32, 32, 4), np.uint8)
        px[..., :3] = COLOURS[np.random.default_rng(5).integers(0, len(COLOURS), 32)][:, None, :]
        px[..., 3] = 255
        return px

    @staticmethod
    def rim_only(big):
        """`big` (8 px cells) with every pixel in the core of its cell made clear: what is visible lies between the cores."""
        out = big.copy()
        core = np.zeros(8, bool)
        core[2:6] = True                                             # in-cell positions 2..5 are the central half of 8
        mask = np.tile(core, big.shape[0] // 8)
        out[mask[:, None] & mask[None, :], 3] = 0
        return out

    def test_every_reason_is_exercised_and_comes_out_as_named(self):
        cases = self.cases()
        self.assertEqual(sorted(cases), sorted(GG.REASONS[GG.REFUSE]))
        for reason, make in cases.items():
            with self.subTest(reason):
                d = make()
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, reason), d.message)
                self.assertTrue(d.message)
                json.dumps(d.as_json())

    def test_a_16x_enlargement_is_refused_out_of_range_even_when_the_tool_gives_the_native_size(self):
        native = art()
        d = decide(enlarge(native, 16), native, 'office')
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'factor-out-of-range'))
        self.assertEqual(d.evidence['factor'], [16.0, 16.0])
        self.assertIn('proven range', d.message)

    def test_an_off_by_one_result_is_refused(self):
        native = art()
        for label, snapped in {'33x32': np.insert(native, 16, native[:, 16], axis=1),
                               '32x33': np.insert(native, 16, native[16], axis=0),
                               '31x32': np.delete(native, 16, axis=1),
                               '32x31': np.delete(native, 16, axis=0)}.items():
            with self.subTest(label):
                d = decide(model_like(native), snapped, 'office')
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'off-grid-size'), d.message)
                self.assertIn('32 px cells', d.message)

    def test_the_proven_range_has_the_edges_that_were_measured(self):
        native = art()
        at = lambda size: decide(np.asarray(Image.fromarray(native, 'RGBA').resize((size, size), Image.NEAREST)), native, 'office')
        self.assertEqual(at(112).outcome, GG.ACCEPT)               # 3.5x, the lowest
        self.assertEqual((at(108).outcome, at(108).reason), (GG.REFUSE, 'factor-out-of-range'))    # 3.375x
        self.assertEqual(at(320).outcome, GG.ACCEPT)               # 10x, the highest
        self.assertEqual(at(323).outcome, GG.ACCEPT)               # 10.09x: a 3 px pad on a 32 px axis, MEASURED in the lab
        self.assertEqual((at(330).outcome, at(330).reason), (GG.REFUSE, 'factor-out-of-range'))    # 10.3x

    def test_unequal_factors_are_refused_unless_the_family_allows_them(self):
        native = art()
        picture = np.repeat(np.repeat(native, 8, axis=1), 9, axis=0)         # 8x by 9x: 11.1% apart
        d = decide(picture, native)
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'factor-unequal'))
        self.assertAlmostEqual(d.evidence['factorSkew'], 1 / 9, places=3)
        allowed = GG.decide(picture, native, 32, GG.FamilyContract(None, 32, allow_unequal_factors=True))
        self.assertEqual(allowed.outcome, GG.ACCEPT, allowed.message)
        near = decide(bilinear(native, 250, 262), native)                    # 7.8x by 8.2x: 5.1%, within the limit
        self.assertEqual(near.outcome, GG.ACCEPT, near.message)

    def test_a_result_that_disagrees_with_the_picture_is_refused_with_the_number(self):
        d = decide(enlarge(self.native, 8), art(seed=9))
        self.assertEqual(d.reason, 'reenlargement-disagrees')
        self.assertLess(d.evidence['agreement'], GG.AGREEMENT_MIN)
        self.assertEqual(d.evidence['agreementMin'], GG.AGREEMENT_MIN)
        shifted = decide(enlarge(self.native, 8), np.roll(self.native, 1, axis=1))
        self.assertEqual(shifted.reason, 'reenlargement-disagrees')

    def test_a_result_that_is_itself_an_enlargement_is_refused_as_ambiguous(self):
        native = art()
        for factor, snapped in {'2x': enlarge(native, 2), '4x': enlarge(native, 4)}.items():
            with self.subTest(factor):
                picture = enlarge(native, 16)                        # a 16x picture the snapper returned at 8x or 4x of the art
                d = decide(picture, snapped, 'office')
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'coarser-grid-explains'), d.message)
                self.assertGreaterEqual(max(d.evidence['coarseAgreement'].values()), GG.COARSE_MAX)
        noisy = decide(model_like(native, k=16), enlarge(native, 4))        # also when the picture is blurred and noisy
        self.assertEqual(noisy.reason, 'coarser-grid-explains', noisy.message)
        three = decide(enlarge(native, 12), enlarge(native, 3))              # a factor of 3
        self.assertEqual(three.reason, 'coarser-grid-explains', three.message)

    def test_a_pixel_size_given_at_half_the_true_one_is_refused(self):
        native = art()
        d = decide(model_like(native), enlarge(native, 2), 'office', pixel_size=4)       # the snapper cut at 4 on an 8x picture
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'coarser-grid-explains'), d.message)

    def test_a_given_pixel_size_that_does_not_match_the_result_is_refused(self):
        native = art()
        d = decide(enlarge(native, 8), native, 'office', pixel_size=5)
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'pixel-size-mismatch'))
        self.assertEqual(d.evidence['pixelSize'], 5)

    def test_a_tool_refusal_keeps_its_own_words(self):
        d = decide(enlarge(self.native, 8), GG.ToolRefusal('unresolved', 'Error: Could not resolve a pixel grid: no edges'))
        self.assertIn('no edges', d.message)
        self.assertIn('no edges', d.evidence['tool'])
        self.assertIn('nothing proves', d.message)

    def test_a_refusal_never_becomes_a_pass_through_because_the_picture_meets_the_contract(self):
        """The contract proves nothing about the grid: an 8x enlargement of 32x32 art is 256x256, a multiple of the cell, and an
        avatar drawn 24x32 and shown at 4x is exactly 96x128."""
        for family, picture in {'office': enlarge(art(), 8), 'avatars': enlarge(art(24, 32), 4)}.items():
            with self.subTest(family):
                self.assertEqual(GG.family_contract(family).size_problems(picture.shape[1], picture.shape[0]), [])
                d = decide(picture, GG.ToolRefusal('unresolved', 'no grid'), family)
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'tool-unresolved'))


class Registration(unittest.TestCase):
    """An ACCEPT needs the result to fit where it is better than moved by one art pixel: MEASURED, the lowest margin of 397
    accepted lab pictures is 0.030, and the one-pixel moves of those results that still read back at 0.90 (131 of 3,176) all
    lose to the margin."""

    def test_an_accepted_result_carries_its_margin_over_every_other_registration(self):
        native = runs(64, 64)
        d = decide(model_like(native), native, 'office')
        self.assertEqual(d.outcome, GG.ACCEPT, d.message)
        fit = d.evidence['registration']
        self.assertGreaterEqual(fit['margin'], GG.REGISTRATION_MARGIN)
        self.assertEqual(fit['marginMin'], GG.REGISTRATION_MARGIN)
        self.assertEqual(len(fit['move']), 2)
        self.assertLess(fit['movedAgreement'], d.evidence['agreement'])

    def test_a_result_cut_one_art_pixel_off_is_refused_in_every_direction(self):
        """Made so that the wrong registration still passes the agreement test (0.92 of the compared pixels, 0.90 is the bar):
        art that is mostly flat, so that most of it reads the same one pixel over. Without the margin these are accepted."""
        native = dots()
        picture = enlarge(native, 8)
        self.assertEqual(decide(picture, native, 'office').outcome, GG.ACCEPT)                  # the right registration is proven
        for dx, dy in GG.REGISTRATION_MOVES:
            with self.subTest(move=(dx, dy)):
                wrong = GG.moved(native, dx, dy)
                self.assertGreaterEqual(GG.agreement(picture, wrong)['agreement'], GG.AGREEMENT_MIN)      # it reads back well
                d = decide(picture, wrong, 'office')
                self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'registration-ambiguous'), d.message)
                self.assertLess(d.evidence['registration']['margin'], GG.REGISTRATION_MARGIN)
                self.assertEqual(d.evidence['registration']['move'], [-dx, -dy])                 # the move that puts it right

    def test_art_that_does_not_change_along_a_move_cannot_be_registered_along_it(self):
        stripes = Refuse.stripes()
        d = decide(enlarge(stripes, 8), stripes, 'office')
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'registration-ambiguous'))
        self.assertEqual(d.evidence['registration']['margin'], 0.0)
        self.assertIn(tuple(d.evidence['registration']['move']), {(-1, 0), (1, 0), (-1, -1), (1, -1), (-1, 1), (1, 1)})

    def test_art_that_does_not_change_along_a_diagonal_cannot_be_registered_along_it(self):
        """Diagonal bands of random colours: moved by (1, -1) it is the same picture, moved along either axis it is not. Only
        the diagonal moves see that, so the 8 moves are not 4 too many."""
        rng = np.random.default_rng(7)
        bands = np.zeros((160, 160, 4), np.uint8)               # large: the border, where a move cannot be exact, is 1% of it
        bands[..., :3] = COLOURS[rng.integers(0, len(COLOURS), 320)][np.add.outer(np.arange(160), np.arange(160))]
        bands[..., 3] = 255
        d = decide(enlarge(bands, 4), bands, 'office')
        self.assertEqual((d.outcome, d.reason), (GG.REFUSE, 'registration-ambiguous'), d.message)
        self.assertLess(d.evidence['registration']['margin'], 0.015)
        self.assertIn(tuple(d.evidence['registration']['move']), {(1, -1), (-1, 1)})

    def test_moved_fills_the_side_it_uncovers_with_the_nearest_line_and_is_a_new_array(self):
        native = art(8, 6, alpha='opaque')
        right = GG.moved(native, 1, 0)
        self.assertTrue(np.array_equal(right[:, 1:], native[:, :-1]) and np.array_equal(right[:, 0], native[:, 0]))
        up = GG.moved(native, 0, -1)
        self.assertTrue(np.array_equal(up[:-1], native[1:]) and np.array_equal(up[-1], native[-1]))
        same = GG.moved(native, 0, 0)
        self.assertTrue(np.array_equal(same, native))
        self.assertFalse(np.shares_memory(same, native))
        far = GG.moved(native, 100, -100)                                    # further than the picture: no error, the edge repeated
        self.assertEqual(far.shape, native.shape)
        self.assertTrue(np.array_equal(far, np.broadcast_to(native[-1:, :1], native.shape)))

    def test_the_margin_is_compared_on_the_result_and_never_writes_to_it(self):
        native = runs(64, 64)
        picture = model_like(native)
        frozen(picture, native)
        before = native.copy()
        fit = GG.registration(picture, native, GG.agreement(picture, native)['agreement'])
        self.assertGreater(fit['margin'], 0)
        self.assertTrue(np.array_equal(native, before))


class BlendShare(unittest.TestCase):
    def ramp(self, step=20):
        """A picture whose columns climb by `step` levels: every pixel is the mean of its two neighbours along a row."""
        px = np.zeros((6, 10, 4), np.uint8)
        px[..., :3] = (np.arange(10) * step)[None, :, None]
        px[..., 3] = 255
        return px

    def test_a_ramp_is_all_blend_and_a_cut_is_none(self):
        self.assertEqual(GG.blend_share(self.ramp()), 1.0)                   # the row triples climb evenly; the column triples are flat
        cut = np.zeros((8, 8, 4), np.uint8)
        cut[..., 3] = 255
        cut[:, 4:, :3] = 200
        self.assertEqual(GG.blend_share(cut), 0.0)
        self.assertEqual(GG.blend_share(np.zeros((8, 8, 4), np.uint8)), 0.0)    # no edge at all: nothing to measure

    def test_a_blend_must_lie_between_its_neighbours_and_on_their_line(self):
        px = np.zeros((1, 3, 4), np.uint8)
        px[..., 3] = 255
        rows = {'the mean': (0, 100, 200), 'close to the mean': (0, 102, 200), 'one of the ends': (0, 5, 200),
                'off the line': (0, 100, 0), 'overshooting': (0, 230, 200), 'neighbours alike': (50, 90, 52)}
        for label, row in rows.items():
            px[0, :, :3] = np.array(row)[:, None]
            with self.subTest(label):
                self.assertEqual(GG.blend_share(px), 1.0 if label in ('the mean', 'close to the mean') else 0.0)

    def test_colour_under_a_clear_pixel_is_not_part_of_the_picture(self):
        native = runs(32, 32)
        other = native.copy()
        other[native[..., 3] == 0, :3] = (255, 0, 255)
        self.assertEqual(GG.blend_share(native), GG.blend_share(other))
        self.assertGreater(GG.blend_share(resampled(native, 64, 64)), 0)

    def test_the_bands_it_is_read_in_do_not_change_the_answer(self):
        picture = resampled(runs(40, 50), 100, 125)
        whole = GG.blend_share(picture)
        self.assertGreater(whole, 0.2)
        for band in (1, 2, 7, 50, 124, 125, 126, 4096):
            with self.subTest(band=band):
                self.assertEqual(GG.blend_share(picture, band=band), whole)

    def test_pictures_too_small_for_a_triple_are_not_an_error(self):
        for shape in ((1, 1, 4), (2, 2, 4), (1, 5, 4), (5, 1, 4)):
            with self.subTest(shape=shape):
                self.assertEqual(GG.blend_share(np.full(shape, 200, np.uint8)), 0.0)

    def test_it_never_writes_to_the_picture(self):
        picture = resampled(runs(40, 50), 100, 125)
        before = picture.copy()
        frozen(picture)
        GG.blend_share(picture)
        self.assertTrue(np.array_equal(picture, before))


class Contracts(unittest.TestCase):
    def test_family_sizes(self):
        ok = {'office': [(32, 32), (64, 96)], 'avatars': [(96, 128)], 'pets': [(512, 32), (512, 128)]}
        bad = {'office': [(33, 32), (32, 31)], 'avatars': [(96, 129), (128, 96), (32, 32)],
               'pets': [(256, 32), (512, 33), (511, 32)]}
        for family in ok:
            contract = GG.family_contract(family)
            for w, h in ok[family]:
                self.assertEqual(contract.size_problems(w, h), [], (family, w, h))
            for w, h in bad[family]:
                self.assertTrue(contract.size_problems(w, h), (family, w, h))
        self.assertEqual(GG.family_contract('avatars', 16).size_problems(48, 64), [])
        self.assertEqual(GG.family_contract(None).size_problems(7, 9), [])
        with self.assertRaises(ValueError):
            GG.family_contract('hats')
        self.assertFalse(GG.family_contract('office').allow_unequal_factors)

    def test_the_parameters_are_the_constants_and_json(self):
        p = GG.parameters()
        json.dumps(p)
        self.assertEqual((p['minFactor'], p['maxFactor']), (3.5, 10.0))
        self.assertEqual(p['agreementMin'], GG.AGREEMENT_MIN)
        self.assertEqual(p['coarseSteps'], [2, 3, 4])
        self.assertEqual((p['selfCoarseMax'], p['blendMax'], p['registrationMargin']),
                         (GG.SELF_COARSE_MAX, GG.BLEND_MAX, GG.REGISTRATION_MARGIN))
        self.assertEqual((p['blendEdge'], p['blendTolerance'], p['blendEnds']), (GG.BLEND_EDGE, GG.BLEND_TOLERANCE, [0.12, 0.88]))

    def test_pictures_that_are_not_rgba_uint8_are_a_value_error(self):
        native = art()
        for bad in (native[..., :3], native.astype(np.int16), native[0]):
            with self.subTest(shape=bad.shape, dtype=bad.dtype):
                with self.assertRaises(ValueError):
                    GG.decide(bad, native)
                with self.assertRaises(ValueError):
                    GG.decide(native, bad)


class Agreement(unittest.TestCase):
    def test_a_correct_grid_agrees_on_the_cores_whatever_the_blur(self):
        native = art()
        for blur in (0.0, 0.8, 1.6):
            with self.subTest(blur=blur):
                self.assertGreaterEqual(GG.agreement(model_like(native, blur=blur), native)['agreement'], GG.AGREEMENT_MIN)

    def test_a_shifted_or_other_grid_does_not(self):
        native = art()
        picture = enlarge(native, 8)
        self.assertEqual(GG.agreement(picture, native)['agreement'], 1.0)
        self.assertLess(GG.agreement(picture, np.roll(native, 1, axis=0))['agreement'], 0.9)
        self.assertLess(GG.agreement(picture, art(seed=4))['agreement'], 0.9)

    def test_alpha_is_compared_per_class(self):
        native = art(alpha='binary')
        picture = enlarge(native, 8)
        flipped = native.copy()
        flipped[16, 16, 3] = 0                                       # one visible art pixel cleared: 64 px of a binary picture
        m = GG.agreement(picture, flipped)
        self.assertEqual(m['alphaClass'], 'binary')
        self.assertGreater(m['alphaDisagree'], 0)
        soft = art(alpha='partial')
        softer = soft.copy()
        softer[soft[..., 3] == 128, 3] = 170                           # 42 levels off: inside the 64 a partial picture allows
        self.assertEqual(GG.agreement(enlarge(soft, 8), softer)['alphaDisagree'], 0)
        exact = native.copy()
        exact[exact[..., 3] == 255, 3] = 250                         # 5 levels off: a binary picture allows none
        self.assertGreater(GG.agreement(picture, exact)['alphaDisagree'], 0.9)

    def test_colour_is_compared_only_where_both_are_visible(self):
        native = art()
        other = native.copy()
        other[native[..., 3] == 0, :3] = (255, 0, 255)                # hidden colour under clear pixels: not compared
        self.assertEqual(GG.agreement(enlarge(native, 8), other)['agreement'], 1.0)
        off = native.copy()
        off[..., :3] = np.where(native[..., 3:4] > 0, 255 - native[..., :3], native[..., :3])
        self.assertLess(GG.agreement(enlarge(native, 8), off)['colourDisagree'], 1.01)
        self.assertLess(GG.agreement(enlarge(native, 8), off)['agreement'], 0.5)

    def test_coarse_agreement_reads_only_the_steps_that_divide_the_result(self):
        native = art()
        self.assertEqual(sorted(GG.coarse_agreement(enlarge(native, 8), native)), [2, 4])        # 32 is divisible by 2 and 4, not by 3
        self.assertEqual(sorted(GG.coarse_agreement(enlarge(native, 9), art(33, 33))), [3])
        self.assertEqual(GG.coarse_agreement(enlarge(native, 8), art(3, 3)), {})                 # too few cells to read coarser


class Determinism(unittest.TestCase):
    def test_the_same_pictures_give_the_same_decision_and_the_same_json(self):
        native = art()
        picture = model_like(native)
        results = [decide(picture, native, 'office') for _ in range(3)]
        self.assertEqual(results[0], results[1])
        self.assertEqual(json.dumps(results[0].as_json(), sort_keys=True), json.dumps(results[2].as_json(), sort_keys=True))
        refusals = [decide(picture, np.insert(native, 16, native[:, 16], axis=1)) for _ in range(2)]
        self.assertEqual(refusals[0], refusals[1])

    def test_the_arrays_it_is_given_are_never_written_to(self):
        native = art()
        picture = model_like(native)
        snapped = native.copy()
        before = (picture.copy(), snapped.copy())
        frozen(picture, snapped)                                      # read-only: a write would raise ValueError
        for kind in (snapped, enlarge(native, 2), np.roll(native, 1, axis=1)):
            frozen(kind)
            decide(picture, kind, 'office')
            decide(picture, kind, 'office', pixel_size=8)
        GG.agreement(picture, snapped)
        GG.coarse_agreement(picture, snapped)
        self.assertTrue(np.array_equal(picture, before[0]) and np.array_equal(snapped, before[1]))
        for same in (runs(96, 128), enlarge(runs(48, 64), 2), resampled(runs(48, 64), 96, 128)):      # a pass-through and its screens
            kept = same.copy()
            frozen(same)
            decide(same, same, 'avatars')
            self.assertTrue(np.array_equal(same, kept))

    def test_the_decision_object_is_immutable(self):
        d = decide(art(), art())
        with self.assertRaises(Exception):
            d.outcome = GG.ACCEPT


if __name__ == '__main__':
    unittest.main()
