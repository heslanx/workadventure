"""Behaviour tests of the glass walls and doors hq-office/glass.py draws (audit round 2: I09, I36, N08, I18, I39, N12, N11).
Run (from assets/konclui/source, isolated mode as the repository asks): python3 -I tools/test_glass.py
No external tool and no build: the pieces are drawn in a fraction of a second. `BuiltTilesets` runs only with KONCLUI_DIST set (a
built map: hq-office/build.py --out DIR) and measures the placed tiles of Konclui_Walls and Konclui_Doors."""
import json
import os
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(SOURCE / 'hq-office'))
import glass as GL  # noqa: E402
import plan as P  # noqa: E402
import translucent as TL  # noqa: E402

T = 32
SIDES = (False, True)                    # south: the facade seen from outside has its cap on tile row 0, the others on row 4


def alpha(img):
    return np.asarray(img)[..., 3]


def span_of(img):
    """(first row with any pixel, last row with an opaque pixel) of a picture."""
    a = alpha(img)
    seen = np.flatnonzero((a > 0).any(1))
    opaque = np.flatnonzero((a == 255).any(1))
    return int(seen[0]), int(opaque[-1])


class Span(unittest.TestCase):
    """I09, I36: every east-west wall is SPAN = 60 rows from its first ink row to its last opaque row, with nothing below."""

    def test_every_face_is_sixty_rows_and_nothing_hangs_below_the_base(self):
        for facade in SIDES:
            for south in SIDES:
                for width in (96, 708, 2372):
                    img = GL.face(width, facade=facade, south=south)
                    top = 0 if south else 4
                    first, last = span_of(img)
                    with self.subTest(facade=facade, south=south, width=width):
                        self.assertEqual((first, last), (top, top + 59))
                        self.assertEqual(last - first + 1, GL.SPAN)
                        self.assertFalse(alpha(img)[last + 1:].any(), 'a row below the base is not transparent')

    def test_the_span_is_the_solid_wall_pieces(self):
        """The count the glass takes is the catalogue's own 'n' wall piece, measured here, not a number copied."""
        import palette as PL
        solid = PL.wall_piece('n')
        first, last = span_of(solid)
        self.assertEqual(last - first + 1, GL.SPAN)
        self.assertEqual((first, last), span_of(GL.face(96, facade=True, south=False)))

    def test_the_base_is_opaque_and_the_cap_is_opaque(self):
        for south in SIDES:
            img = np.asarray(GL.face(256, facade=True, south=south))
            top = 0 if south else 4
            self.assertTrue((img[top:top + GL.CAP, :, 3] == 255).all(), 'cap')
            self.assertTrue((img[top + GL.SPAN - GL.BASE:top + GL.SPAN, :, 3] == 255).all(), 'base')

    def test_foot_is_where_the_base_starts(self):
        for south in SIDES:
            img = np.asarray(GL.face(64, south=south))
            self.assertEqual(GL.foot(south), (0 if south else 4) + GL.SPAN - GL.BASE)
            self.assertTrue((img[GL.foot(south), :, :3] == GL.rgb(GL.INK)).all())

    def test_the_post_is_as_tall_as_the_wall_and_reads_the_same_from_both_sides(self):
        for south in SIDES:
            top = 0 if south else 4
            post = GL.post(top=top)
            self.assertEqual(span_of(post), (top, top + GL.SPAN - 1))
            px = np.asarray(post)
            self.assertTrue((px == px[:, ::-1]).all(), 'the post is not mirror symmetric')


class Translucency(unittest.TestCase):
    """The critic's point 3: partly transparent pixels are glass by design (pane, reflection, film, mullion, joint) and nothing
    else; the levels stay inside what translucent.py declares for the tileset."""

    GLASS_PIXELS = {                      # (rgb, alpha) a face may carry below 255
        (GL.GLASS, GL.PANE_ALPHA), ((255, 255, 255), 70), ((255, 255, 255), 52), (GL.rgb(GL.INK), 230),
        (GL.JOINT, 170), (GL.rgb(GL.TURQUOISE), GL.FILM_ALPHA)}

    def test_a_face_has_no_partly_transparent_pixel_that_is_not_glass(self):
        for facade in SIDES:
            for south in SIDES:
                px = np.asarray(GL.face(708, facade=facade, south=south)).reshape(-1, 4)
                part = px[(px[:, 3] > 0) & (px[:, 3] < 255)]
                seen = {(tuple(int(v) for v in p[:3]), int(p[3])) for p in part}
                self.assertLessEqual(seen, self.GLASS_PIXELS, f'facade={facade} south={south}')

    def test_no_pixel_lands_below_the_base_as_a_shadow(self):
        for south in SIDES:
            img = GL.face(256, south=south)
            self.assertFalse(alpha(img)[(0 if south else 4) + GL.SPAN:].any())
            for frame in range(GL.DOOR_FRAMES):
                door = GL.door_h(2, frame, south)
                self.assertFalse(alpha(door)[(0 if south else 4) + GL.SPAN:].any())

    def test_the_levels_are_declared(self):
        walls = TL.TILESET_LAYERS['Konclui_Walls.png'][1]
        doors = TL.TILESET_LAYERS['Konclui_Doors.png'][1]

        def levels(img):
            a = alpha(img)
            return {int(v) for v in np.unique(a[(a > 0) & (a < 255)])}
        for facade in SIDES:
            for south in SIDES:
                self.assertLessEqual(levels(GL.face(708, facade=facade, south=south)), walls)
        self.assertLessEqual(levels(GL.strip()), walls)
        for frame in range(GL.DOOR_FRAMES):
            for south in SIDES:
                self.assertLessEqual(levels(GL.door_h(3, frame, south)), doors)
            self.assertLessEqual(levels(GL.door_v(frame)), doors)


class Doors(unittest.TestCase):
    """N08, I18: a head beam, a threshold, jambs, symmetric leaves, and a movement without a pop."""

    def test_the_door_leaf_is_the_same_span_as_the_wall_in_every_frame(self):
        for south in SIDES:
            top = 0 if south else 4
            for tiles in (2, 3):
                for frame in range(GL.DOOR_FRAMES):
                    with self.subTest(south=south, tiles=tiles, frame=frame):
                        self.assertEqual(span_of(GL.door_h(tiles, frame, south)), (top, top + GL.SPAN - 1))

    def test_the_head_beam_crosses_the_opening_in_every_frame_and_matches_the_face_cap(self):
        for south in SIDES:
            top = 0 if south else 4
            face = np.asarray(GL.face(256, facade=True, south=south))
            for tiles in (2, 3):
                for frame in range(GL.DOOR_FRAMES):
                    door = np.asarray(GL.door_h(tiles, frame, south))
                    cap = door[top:top + GL.CAP]
                    self.assertTrue((cap[..., 3] == 255).all(), f'head beam has a hole (frame {frame})')
                    self.assertTrue((cap == face[top:top + GL.CAP, :1][:, :1]).all(), 'cap differs from the face cap')

    def test_the_threshold_crosses_the_opening_in_every_frame(self):
        for south in SIDES:
            row = (0 if south else 4) + GL.SPAN - 1
            for frame in range(GL.DOOR_FRAMES):
                door = np.asarray(GL.door_h(3, frame, south))
                self.assertTrue((door[row, :, 3] == 255).all(), f'frame {frame}: floor line has a hole')
                if frame == GL.DOOR_FRAMES - 1:
                    mid = door[row, 8:-8, :3]
                    self.assertTrue((mid == GL.SILL).all(), 'the open threshold is not the neutral sill colour')

    def test_the_leaves_and_their_handles_are_mirror_images(self):
        for south in SIDES:
            for frame in range(GL.DOOR_FRAMES):
                px = np.asarray(GL.door_h(3, frame, south))
                self.assertTrue((px == px[:, ::-1]).all(), f'frame {frame} is not symmetric')
        for frame in range(GL.DOOR_FRAMES):
            px = np.asarray(GL.door_v(frame))
            self.assertTrue((px == px[::-1]).all(), f'door_v frame {frame} is not symmetric top to bottom')

    def test_the_leaves_move_by_steps_of_a_similar_size_and_a_stile_is_left_when_open(self):
        for tiles in (2, 3):
            half = tiles * T // 2
            reach = []
            for frame in range(GL.DOOR_FRAMES):
                a = alpha(GL.door_h(tiles, frame))
                row = a[(4 + GL.CAP + 2)]                    # a glass row of a leaf
                reach.append(int((row[:half] > 0).sum()))
            self.assertEqual(reach[0], half, 'closed: the leaf does not reach the middle')
            self.assertEqual(reach[-1], GL.REMNANT, 'open: not one stile')
            steps = [a - b for a, b in zip(reach, reach[1:])]
            self.assertGreater(min(steps), 0)
            self.assertLessEqual(max(steps) - min(steps), 2, f'uneven steps {steps}')

    def test_the_vertical_door_has_jamb_caps_and_a_threshold_when_open(self):
        img = np.asarray(GL.door_v(GL.DOOR_FRAMES - 1))
        ink = GL.rgb(GL.INK)
        for y in (0, 1, 2 * T - 2, 2 * T - 1):
            self.assertTrue((img[y, 30:34, :3] == ink).all() and (img[y, 30:34, 3] == 255).all(), f'cap row {y}')
        mid = img[10:54, 31:33]
        self.assertTrue((mid[..., 3] == 255).all() and (mid[..., :3] == GL.SILL).all(), 'no threshold between the stiles')
        closed = np.asarray(GL.door_v(0))
        self.assertTrue((closed[8:56, 32, 3] > 0).all(), 'closed: the leaf has a hole')

    def test_the_film_rule_is_one_rule(self):
        """The safety film is on interior glass and the doors in it, and on no facade glass, its door included."""
        film = GL.rgb(GL.TURQUOISE)

        def has_film(img):
            px = np.asarray(img)
            return bool(((px[..., :3] == film).all(-1) & (px[..., 3] > 0)).any())
        self.assertTrue(has_film(GL.face(256, facade=False)))
        self.assertFalse(has_film(GL.face(256, facade=True)))
        self.assertTrue(has_film(GL.door_h(2, 0, False)))
        self.assertFalse(has_film(GL.door_h(3, 0, True)))


class Mullions(unittest.TestCase):
    """N12: one mullion cycle per run between anchors, whole bays about 96 px, no stub pane."""

    def test_bays_have_no_stub_and_land_on_anchors(self):
        for width in (200, 354, 708, 1154, 2372):
            for anchors in ((), (width // 3,), (width // 3, width // 2)):
                cuts = sorted({0, width, *GL.bays(width, anchors), *(a for a in anchors if 0 < a < width)})
                gaps = [b - a for a, b in zip(cuts, cuts[1:])]
                runs = sorted({0, width, *(a for a in anchors if 0 < a < width)})
                with self.subTest(width=width, anchors=anchors):
                    for a in anchors:
                        if 0 < a < width:
                            self.assertIn(a, cuts)
                    for lo, hi in zip(runs, runs[1:]):
                        inside = [g for a, b, g in zip(cuts, cuts[1:], gaps) if lo <= a and b <= hi]
                        if hi - lo >= GL.BAY_MIN:
                            self.assertGreaterEqual(min(inside), GL.BAY_MIN)
                        if hi - lo >= GL.BAY:
                            self.assertLessEqual(max(inside), GL.BAY * 1.5)
                        self.assertLessEqual(max(inside) - min(inside), 1, 'bays of a run are not equal')

    def test_the_real_plan_has_every_glass_face_partition_on_a_bay_boundary(self):
        for row, a, b, kind, material in P.H_WALLS:
            if material != 'glass':
                continue
            width = (P.vb(b) - P.vb(a)) * T + 4
            anchors = GL.anchors(P, row, a, b)
            cuts = {0, width, *anchors, *GL.bays(width, anchors, GL.BAY if row in (P.BY0, P.BY1) else 2 * T)}
            with self.subTest(row=row, a=a, b=b):
                gaps = sorted(y - x for x, y in zip(sorted(cuts), sorted(cuts)[1:]))
                self.assertGreaterEqual(gaps[0], min(GL.BAY_MIN, width))

    def test_the_entrance_jambs_and_the_inner_partition_are_anchors(self):
        south = next(w for w in P.H_WALLS if w[0] == P.BY1)
        left = P.vb(south[1]) * T - 2
        door = next(d for d in P.DOORS_H if d[0] == P.BY1)
        got = GL.anchors(P, *south[:3])
        self.assertIn(door[1] * T - left, got)
        self.assertIn((door[1] + door[2]) * T - left, got)
        inner = next(w for w in P.H_WALLS if w[0] == 17 and w[1] == 19)
        self.assertIn(P.vb(30) * T - (P.vb(19) * T - 2), GL.anchors(P, *inner[:3]), 'the Sala 01 | 02 partition at x960')

    def test_the_facade_mullions_are_where_bays_says(self):
        img = np.asarray(GL.face(708, facade=True, south=False, anchors=(354,)))
        row = img[30]
        ink = [x for x in range(708) if tuple(row[x]) == (*GL.rgb(GL.INK), 230)]
        cuts = sorted({354, *GL.bays(708, (354,))})                  # the anchor itself carries a mullion too
        self.assertEqual(sorted({x + 1 for x in ink if x + 1 in ink}), sorted(cuts))

    def test_a_partition_that_meets_the_glass_gets_a_joint_there(self):
        """Before, the partition at x960 ended in the middle of a pane: the joint was 30 px off (N12)."""
        img = np.asarray(GL.face(256, facade=False, south=False, anchors=(100,)))
        self.assertEqual(int(img[30, 100, 3]), 170, 'no joint under the partition')
        self.assertEqual(int(np.asarray(GL.face(256, facade=False, south=False))[30, 100, 3]), 64, 'a joint without an anchor')


@unittest.skipUnless(os.environ.get('KONCLUI_DIST'), 'KONCLUI_DIST is unset')
class BuiltTilesets(unittest.TestCase):
    """The real build: what is placed in the walls and doors layers."""

    @classmethod
    def setUpClass(cls):
        cls.dist = Path(os.environ['KONCLUI_DIST'])
        cls.map = json.loads((cls.dist / 'office.tmj').read_text())

    def _placed(self, layer, tileset):
        ts = next(t for t in self.map['tilesets'] if t['name'] == tileset)
        sheet = np.asarray(Image.open(self.dist / ts['image']).convert('RGBA'))
        cols = ts['columns']
        data = next(l for l in self.map['layers'] if l['name'] == layer)['data']
        out = []
        for gid in data:
            if gid >= ts['firstgid'] and gid < ts['firstgid'] + ts['tilecount']:
                i = gid - ts['firstgid']
                out.append((gid, sheet[i // cols * T:(i // cols + 1) * T, i % cols * T:(i % cols + 1) * T]))
        return out

    def test_no_placed_wall_tile_carries_the_alpha_34_ground_shadow(self):
        bad = [gid for gid, tile in self._placed('walls', 'Konclui_Walls') if (tile[..., 3] == 34).any()]
        self.assertEqual(bad, [], f'{len(bad)} placed wall tiles carry alpha 34 rows')

    def test_the_south_facade_is_sixty_rows(self):
        a = np.asarray(Image.open(self.dist / 'tilesets' / 'Konclui_Walls.png').convert('RGBA'))[..., 3]
        self.assertTrue(a.shape[0] % T == 0)
        # the placed south-facade column x = 266: first ink row to last opaque row
        tmj = self.map
        w = next(l for l in tmj['layers'] if l['name'] == 'walls')
        ts = next(t for t in tmj['tilesets'] if t['name'] == 'Konclui_Walls')
        sheet = np.asarray(Image.open(self.dist / ts['image']).convert('RGBA'))
        x = 266
        rows = []
        for ty in (P.BY1, P.BY1 + 1):
            gid = w['data'][ty * tmj['width'] + x // T]
            i = gid - ts['firstgid']
            tile = sheet[i // ts['columns'] * T:(i // ts['columns'] + 1) * T, i % ts['columns'] * T:(i % ts['columns'] + 1) * T]
            rows.append(tile[:, x % T, 3])
        col = np.concatenate(rows)
        self.assertEqual(int(np.flatnonzero(col == 255)[-1]) - int(np.flatnonzero(col > 0)[0]) + 1, GL.SPAN)


if __name__ == '__main__':
    if not os.environ.get('KONCLUI_DIST'):
        print('note: KONCLUI_DIST is unset, so BuiltTilesets is SKIPPED; build with `python3 hq-office/build.py --out DIR '
              '--renders DIR2` and rerun with KONCLUI_DIST=DIR')
    unittest.main()
