"""The guard behind the pixel snapper: pure functions that decide what a picture and the snapper's answer for it are worth.

Nothing here runs a tool or touches a file: `decide` takes the picture as read (RGBA, uint8), the snapper's answer (a picture,
or a ToolRefusal when it refused) and the contract of the family, and returns one Decision with a machine-readable reason and
the numbers behind it. numpy only.

  PASS_THROUGH  the picture is already on the pixel grid (one image pixel per art pixel): the snapper gave the same size and
                exactly the same pixels back (same alpha everywhere, same colour wherever alpha > 0) AND the picture shows no
                trace of an enlargement (below), or the caller asserted pixel size 1 and the snapper kept it. So the caller
                must run the snapper without a palette and with no colour reduction that could change the picture (a count of
                at least its colours, or none). The caller stages the INPUT. A refusal of the snapper is NOT turned into a
                pass-through because the picture meets the family's hard contract: a picture can meet the family's size,
                alpha and colour rules and still be an enlargement (an 8x of 32x32 art is 256x256, a multiple of the cell; an
                avatar drawn 24x32 and shown at 4x is exactly 96x128), so the contract proves nothing about the grid ("Why
                not the contract" in tools/README.md).
  ACCEPT        the snapper resampled an enlargement and the result is proven: both sides are whole multiples of the cell and
                fit the family; the enlargement factor input/output is in [MIN_FACTOR, MAX_FACTOR + FACTOR_SLACK] on each axis
                and the two are within MAX_FACTOR_SKEW unless the family allows otherwise; the result enlarged back with
                nearest neighbour agrees with the input (below); no coarser grid (the result read every 2nd, 3rd or 4th
                pixel) explains the input as well, because then the snapper may have stopped at a fraction of the true cell;
                and the result is the best registration of itself: moved by one art pixel in any direction it agrees with the
                input worse by at least REGISTRATION_MARGIN.
  REFUSE        anything else, with one REASON from REASONS and the evidence. No result is ever "probably fine": a result
                that cannot be proven is refused, and the caller keeps the reason.

The agreement of the re-enlargement (`agreement`, MEASURED on the lab sets, numbers in tools/README.md): the snapped picture
is enlarged back to the input's size with nearest neighbour (cell (i, j) covers the input pixels whose centre falls in it), and
only the CORE of every cell, its central CORE x CORE share, is compared. Blur, bilinear resampling and JPEG ringing live on the
cell borders, so the core is what a correct grid reproduces and a wrong one does not. In the cores, over the pixels that are
visible in either picture:
  alpha    must agree within ALPHA_TOLERANCE of the input's alpha class: opaque and binary pictures exactly (0 or 255 is a class,
           not a level), partial ones (soft edges) within 64 levels;
  colour   where both are visible (alpha > 127), the largest channel difference must be at most COLOUR_TOLERANCE.
`agreement` is the share of those pixels that meet both. A picture is accepted at AGREEMENT_MIN or more. The same measure,
taken on the result read at every m-th pixel (m = 2, 3, 4, at every phase), is `coarse_agreement`: at COARSE_MAX or more the
result is refused as ambiguous ("coarser-grid-explains"). That is the case of a result that is itself an enlargement: a 16x
picture returned at 4x, or a pixel size given at half the true one. It also refuses art whose own grid is blocky (a tile drawn
in 4 px cells), which cannot be told from it: a refusal, not a guess.

What PASS_THROUGH is, and is not (MEASURED, numbers in tools/README.md). The fixed snapper cannot tell an enlargement below
MIN_FACTOR from art on its grid: it returns such a picture unchanged, and a picture that is itself an enlargement can be
pixel-identical to a half-size native, so "on its grid" cannot be PROVEN from one picture. What can be done is to look for the
two traces an enlargement leaves in the INPUT, and refuse the picture when either is there:
  blocky     the input read at every 2nd, 3rd or 4th pixel explains itself (`coarse_agreement(pixels, pixels)` at
             SELF_COARSE_MAX or more): the picture is made of 2x2, 3x3 or 4x4 blocks. Nearest-neighbour enlargements, and
             art that is drawn in blocks, which cannot be told from them.
  resampled  `blend_share` at BLEND_MAX or more: a quarter of the clear edges of the picture are crossed by a pixel that is
             an interpolation of its two neighbours, which is what bilinear, bicubic and Lanczos enlargement leave and what
             art drawn pixel by pixel almost never has.
A picture that passes both is "no trace found", not a proof: the residual (a resampler whose blends fall under BLEND_MAX) is
measured and stated in tools/README.md. The caller who knows better asserts pixel size 1.

Determinism: no randomness, no clock, no environment; the same arrays give the same Decision. The inputs are never written to.
"""
from dataclasses import dataclass, field

import numpy as np

CELL = 32
PASS_THROUGH, ACCEPT, REFUSE = 'PASS_THROUGH', 'ACCEPT', 'REFUSE'

# --- the proven range, MEASURED (tools/README.md, "ingest"): the fixed snapper, on enlargements between these factors
MIN_FACTOR = 3.5                  # below it the snapper cannot tell an enlargement from art on its grid
MAX_FACTOR = 10.0                 # above it it can return a wrong multiple (384x512 for 96x128)
FACTOR_SLACK = 0.1                # a crop or pad of up to 3 px on a 32 px axis (3 / 32) moves a nominal 10x to 10.09x
MAX_FACTOR_SKEW = 0.08            # |fx / fy - 1| at most: the lab's 7.8x8.2 pictures are 5.1% apart, the model look-alikes 4%

# --- the agreement of the re-enlargement (calibrated in tools/README.md)
CORE = 0.5
COLOUR_TOLERANCE = 48
ALPHA_TOLERANCE = {'opaque': 0, 'binary': 0, 'partial': 64}
AGREEMENT_MIN = 0.90
COARSE_STEPS = (2, 3, 4)
COARSE_MAX = 0.97

# --- the screens of a PASS_THROUGH (the input itself; calibrated in tools/README.md, "Is it on its grid?")
SELF_COARSE_MAX = COARSE_MAX      # the input read at every m-th pixel agrees with itself this much or more: blocky
BLEND_MAX = 0.25                  # lab and held-out natives: at most 0.202 of 112; bilinear enlargements: at least 0.309; bicubic 0.280
BLEND_EDGE = 12.0                 # a triple is an edge when its outer pixels are further apart than this (premultiplied RGBA levels)
BLEND_TOLERANCE = 3.0             # its middle pixel is a blend when it lies within this distance of the segment between them
BLEND_ENDS = (0.12, 0.88)         # ... and strictly inside it: not (almost) one of the two ends
BLEND_BAND = 512                  # rows read at a time, so that a 25 Mpx picture does not become a 400 MB float array

# --- the registration of an ACCEPT (calibrated in tools/README.md)
REGISTRATION_MARGIN = 0.02        # the lowest margin over the 8 one-art-pixel moves, of 397 accepted lab and held-out pictures: 0.0299
REGISTRATION_MOVES = tuple((dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx, dy) != (0, 0))

REASONS = {
    PASS_THROUGH: ('on-grid', 'on-grid-asserted'),
    ACCEPT: ('enlargement-proven',),
    REFUSE: ('tool-unresolved', 'tool-failed', 'tool-unreadable', 'blank-input', 'on-grid-altered', 'off-grid-size',
             'family-size', 'factor-out-of-range', 'factor-unequal', 'pixel-size-mismatch', 'reenlargement-disagrees',
             'reenlargement-unmeasurable', 'coarser-grid-explains', 'registration-ambiguous', 'input-blocky', 'input-resampled'),
}
FAMILIES = ('office', 'avatars', 'pets')


@dataclass(frozen=True)
class ToolRefusal:
    """What the snapper said instead of a picture. `code`: 'unresolved' (it found no grid: exit 3), 'failed' (any other
    failure) or 'unreadable' (it exited 0 and wrote no picture that could be read)."""
    code: str
    message: str = ''


@dataclass(frozen=True)
class FamilyContract:
    """The sheet size a family accepts, and whether it allows different enlargement factors on the two axes. `family` None is
    no size rule at all (the guard's own tests and the measurement use it); the cell multiple stays a rule of ACCEPT."""
    family: str = None
    cell: int = CELL
    allow_unequal_factors: bool = False

    def size_problems(self, width, height):
        cell = self.cell
        if self.family == 'avatars':
            want = (3 * cell, 4 * cell)
            return [] if (width, height) == want else [f'size {width}x{height} is not {want[0]}x{want[1]} (3 x 4 cells of {cell})']
        if self.family == 'pets':
            if width != 16 * cell:
                return [f'width {width} is not {16 * cell} (16 cells of {cell})']
            return [] if height and height % cell == 0 else [f'height {height} is not a whole number of {cell} px rows']
        if self.family == 'office':
            return [] if width % cell == 0 and height % cell == 0 else [f'size {width}x{height} is not a multiple of {cell}']
        if self.family is None:
            return []
        raise ValueError(f'unknown family {self.family!r}: expected one of {", ".join(FAMILIES)}')


def family_contract(family, cell=CELL):
    """The FamilyContract of `family` ('office', 'avatars' or 'pets'; None for no size rule)."""
    if family is not None and family not in FAMILIES:
        raise ValueError(f'unknown family {family!r}: expected one of {", ".join(FAMILIES)}')
    return FamilyContract(family, cell)


@dataclass(frozen=True)
class Decision:
    """`outcome` is PASS_THROUGH, ACCEPT or REFUSE; `reason` one of REASONS[outcome]; `message` says it in words; `evidence`
    holds the numbers (JSON-ready)."""
    outcome: str
    reason: str
    message: str
    evidence: dict = field(default_factory=dict)

    def as_json(self):
        return {'decision': self.outcome, 'reason': self.reason, 'message': self.message, 'evidence': dict(self.evidence)}


def alpha_class(pixels):
    """'opaque' (no pixel below 255), 'binary' (only 0 and 255, at least one 0) or 'partial' (some alpha strictly between)."""
    alpha = pixels[..., 3]
    if (alpha == 255).all():
        return 'opaque'
    return 'binary' if ((alpha == 0) | (alpha == 255)).all() else 'partial'


def visible_colours(pixels):
    """Distinct RGB colours among the pixels with alpha > 0."""
    rgb = pixels[pixels[..., 3] > 0][:, :3].astype(np.uint32)
    return int(np.unique((rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]).size)


def same_pixels(a, b):
    """True when `a` and `b` have one shape, the same alpha everywhere and the same colour wherever alpha > 0."""
    if a.shape != b.shape or not np.array_equal(a[..., 3], b[..., 3]):
        return False
    visible = a[..., 3] > 0
    return bool(np.array_equal(a[..., :3][visible], b[..., :3][visible]))


def _axis_cells(length, cells, core):
    """For an axis of `length` input pixels over `cells` cells: the cell of every input pixel, and the input pixels that lie in
    the core of their cell (the central `core` share). A cell (i) holds the input pixels whose centre falls in [i, i + 1)."""
    at = (np.arange(length) + 0.5) * cells / length
    index = np.minimum(at.astype(int), cells - 1)
    inside = np.flatnonzero(np.abs(at - np.floor(at) - 0.5) <= core / 2)
    return index, inside


def agreement(pixels, snapped, core=CORE, colour_tolerance=COLOUR_TOLERANCE, alpha_tolerance=None):
    """How well `snapped`, enlarged back with nearest neighbour, reproduces `pixels` (see the module docstring).
    Returns {agreement, pixels (compared), alphaClass, ...} with agreement None when nothing is visible in the cores."""
    kind = alpha_class(pixels)
    tolerance = ALPHA_TOLERANCE[kind] if alpha_tolerance is None else alpha_tolerance
    rows, rows_in = _axis_cells(pixels.shape[0], snapped.shape[0], core)
    cols, cols_in = _axis_cells(pixels.shape[1], snapped.shape[1], core)
    seen = pixels[np.ix_(rows_in, cols_in)]
    back = snapped[rows[rows_in]][:, cols[cols_in]]
    a_in, a_back = seen[..., 3].astype(np.int16), back[..., 3].astype(np.int16)
    compared = (a_in > 0) | (a_back > 0)
    count = int(compared.sum())
    if not count:
        return {'agreement': None, 'pixels': 0, 'alphaClass': kind}
    alpha_ok = np.abs(a_in - a_back) <= tolerance
    both = (a_in > 127) & (a_back > 127)
    colour_gap = np.abs(seen[..., :3].astype(np.int16) - back[..., :3].astype(np.int16)).max(axis=2)
    colour_ok = ~both | (colour_gap <= colour_tolerance)
    good = compared & alpha_ok & colour_ok
    return {'agreement': float(good.sum()) / count, 'pixels': count, 'alphaClass': kind,
            'alphaDisagree': float((compared & ~alpha_ok).sum()) / count,
            'colourDisagree': float((compared & alpha_ok & ~colour_ok).sum()) / count}


def coarse_agreement(pixels, snapped, steps=COARSE_STEPS):
    """{m: the best agreement of `pixels` with `snapped` read at every m-th pixel, over every phase (x, y)}, for each m of
    `steps` that divides both sides of `snapped` and leaves at least 2 cells. A result that is itself an m-fold enlargement
    reads back as well at m as at 1; art whose pixels are 1:1 with the picture does not."""
    height, width = snapped.shape[:2]
    best = {}
    for m in steps:
        if width % m or height % m or width // m < 2 or height // m < 2:
            continue
        found = [agreement(pixels, np.ascontiguousarray(snapped[qy::m, qx::m]))['agreement']
                 for qy in range(m) for qx in range(m)]
        found = [value for value in found if value is not None]
        if found:
            best[m] = max(found)
    return best


def _blends(first, middle, last, tolerance, edge, ends):
    """(edge triples, blended triples) of three equally shaped float arrays of premultiplied RGBA: the pixels before, at and
    after. An edge triple has its outer pixels further apart than `edge`; it is blended when the middle one lies within
    `tolerance` of the segment between them and strictly inside it (`ends`)."""
    span = last - first
    length2 = (span * span).sum(-1)
    clear = length2 > edge * edge
    along = ((middle - first) * span).sum(-1) / np.maximum(length2, 1e-6)
    off = middle - (first + along[..., None] * span)
    blended = clear & (along > ends[0]) & (along < ends[1]) & ((off * off).sum(-1) <= tolerance * tolerance)
    return int(clear.sum()), int(blended.sum())


def blend_share(pixels, tolerance=BLEND_TOLERANCE, edge=BLEND_EDGE, ends=BLEND_ENDS, band=BLEND_BAND):
    """The share of the picture's clear edges that are crossed by a blend: over every three neighbours in a row and in a
    column (colour premultiplied by alpha, so a clear pixel has no colour), the outer two differ by more than `edge` and the
    middle one lies on the line between them. Resampling an enlargement leaves exactly such pixels, a few per edge; art drawn
    pixel by pixel has a cut instead. 0.0 when the picture has no clear edge. The picture is read in bands of `band` rows (the
    result does not depend on it)."""
    height = pixels.shape[0]
    clear = blended = 0
    for top in range(0, height, band):
        bottom = min(height, top + band)
        lo, hi = max(0, top - 1), min(height, bottom + 1)
        block = pixels[lo:hi].astype(np.float32)
        block[..., :3] *= block[..., 3:4] / 255.0
        rows = block[top - lo:bottom - lo]
        found = _blends(rows[:, :-2], rows[:, 1:-1], rows[:, 2:], tolerance, edge, ends)       # along the rows of the band
        clear, blended = clear + found[0], blended + found[1]
        first, last = max(top, 1), min(bottom, height - 1)                                       # centres that have both neighbours
        if first < last:
            c0 = first - lo
            found = _blends(block[c0 - 1:c0 - 1 + last - first], block[c0:c0 + last - first], block[c0 + 1:c0 + 1 + last - first],
                            tolerance, edge, ends)                                                # down the columns
            clear, blended = clear + found[0], blended + found[1]
    return blended / clear if clear else 0.0


def moved(picture, dx, dy):
    """`picture` moved by (dx, dy) pixels, the side it uncovers filled with the nearest row or column (so a picture that does not
    change along the move is the same picture, and the move costs nothing at the border). A new array."""
    height, width = picture.shape[:2]
    rows = np.clip(np.arange(height) - dy, 0, height - 1)
    cols = np.clip(np.arange(width) - dx, 0, width - 1)
    return picture[rows][:, cols]


def registration(pixels, snapped, unmoved):
    """How much better `snapped` fits `pixels` where it is than moved by one art pixel in any of the 8 directions:
    {margin, move (the best other registration), movedAgreement}. `unmoved` is `agreement(pixels, snapped)['agreement']`.
    A result that was cut one art pixel early (or late) agrees almost as well, because most of a picture is flat; the margin
    is what tells it from the right one. margin <= 0 means another registration fits as well or better (a picture that does not
    change along a move, stripes along it or a flat field, has margin 0: its registration cannot be told)."""
    best, move = None, None
    for dx, dy in REGISTRATION_MOVES:
        value = agreement(pixels, moved(snapped, dx, dy))['agreement']
        if value is not None and (best is None or value > best):
            best, move = value, (dx, dy)
    if best is None:
        return {'margin': None, 'move': None, 'movedAgreement': None}
    return {'margin': unmoved - best, 'move': list(move), 'movedAgreement': best}


def parameters():
    """The numbers a Decision depends on, for a report: a run records the thresholds it was judged by."""
    return {'minFactor': MIN_FACTOR, 'maxFactor': MAX_FACTOR, 'factorSlack': FACTOR_SLACK, 'maxFactorSkew': MAX_FACTOR_SKEW,
            'core': CORE, 'colourTolerance': COLOUR_TOLERANCE, 'alphaTolerance': dict(ALPHA_TOLERANCE),
            'agreementMin': AGREEMENT_MIN, 'coarseSteps': list(COARSE_STEPS), 'coarseMax': COARSE_MAX,
            'selfCoarseMax': SELF_COARSE_MAX, 'blendMax': BLEND_MAX, 'blendEdge': BLEND_EDGE, 'blendTolerance': BLEND_TOLERANCE,
            'blendEnds': list(BLEND_ENDS), 'registrationMargin': REGISTRATION_MARGIN}


def _num(value, places=4):
    return None if value is None else round(float(value), places)


def _refuse(reason, message, evidence):
    return Decision(REFUSE, reason, message, evidence)


def decide(pixels, snapped, cell=CELL, contract=None, pixel_size=None):
    """The Decision for `pixels` (RGBA uint8, the picture as read) and `snapped` (RGBA uint8: what the snapper wrote, or a
    ToolRefusal). `contract` is a FamilyContract (default: no size rule beyond the cell multiple). `pixel_size` is what the caller
    told the snapper (None: it found the grid itself); 1 asserts that the picture is already on its grid."""
    contract = contract or FamilyContract(None, cell)
    if pixels.ndim != 3 or pixels.shape[2] != 4 or pixels.dtype != np.uint8:
        raise ValueError('pixels must be an RGBA uint8 array of shape (height, width, 4)')
    height, width = pixels.shape[:2]
    evidence = {'input': [width, height], 'alphaClass': alpha_class(pixels), 'cell': cell,
                'pixelSize': pixel_size, 'family': contract.family}
    if isinstance(snapped, ToolRefusal):
        reason = {'unresolved': 'tool-unresolved', 'unreadable': 'tool-unreadable'}.get(snapped.code, 'tool-failed')
        what = {'tool-unresolved': 'the snapper found no grid in it', 'tool-unreadable': 'the snapper wrote no readable picture',
                'tool-failed': 'the snapper failed'}[reason]
        evidence['tool'] = snapped.message[-300:]
        return _refuse(reason, f'{what}; nothing proves the picture is on a grid'
                       + (f' ({snapped.message.strip()[-200:]})' if snapped.message.strip() else ''), evidence)
    if snapped.ndim != 3 or snapped.shape[2] != 4 or snapped.dtype != np.uint8:
        raise ValueError('snapped must be an RGBA uint8 array of shape (height, width, 4) or a ToolRefusal')
    out_h, out_w = snapped.shape[:2]
    evidence['snapped'] = [out_w, out_h]
    if not (pixels[..., 3] > 0).any() and pixel_size != 1:
        return _refuse('blank-input', 'the picture has no visible pixel: there is no grid to prove (pixel size 1 keeps it, '
                       'on the caller\'s word)', evidence)

    if (out_w, out_h) == (width, height):
        if same_pixels(pixels, snapped):
            if pixel_size == 1:
                return Decision(PASS_THROUGH, 'on-grid-asserted',
                                'kept as it is on the caller\'s word (pixel size 1): the grid was asserted, not found', evidence)
            share = blend_share(pixels)
            evidence.update(blendShare=_num(share), blendMax=BLEND_MAX)
            if share >= BLEND_MAX:
                return _refuse('input-resampled', f'the snapper returned the picture unchanged, but {share:.1%} of its clear edges are '
                               f'crossed by a blend of the two neighbours (from {BLEND_MAX:.0%}), which is what resampling an '
                               f'enlargement leaves; the snapper cannot tell an enlargement below {MIN_FACTOR:g}x from art on its '
                               f'grid (say it is on its grid with pixel size 1)', evidence)
            own = coarse_agreement(pixels, pixels)
            evidence.update(selfCoarseAgreement={str(m): _num(value) for m, value in own.items()}, selfCoarseMax=SELF_COARSE_MAX)
            blocky = {m: value for m, value in own.items() if value >= SELF_COARSE_MAX}
            if blocky:
                m = min(blocky)
                return _refuse('input-blocky', f'the snapper returned the picture unchanged, but read at every {m}th pixel it explains '
                               f'itself on {blocky[m]:.1%} of the compared pixels (from {SELF_COARSE_MAX:.0%}): it is made of {m}x{m} '
                               f'blocks, an enlargement below {MIN_FACTOR:g}x or art drawn in blocks, which the snapper cannot tell '
                               f'from art on its grid (say it is on its grid with pixel size 1)', evidence)
            return Decision(PASS_THROUGH, 'on-grid', 'the snapper found the picture on its grid and returned it unchanged, and the '
                            'picture shows no trace of an enlargement (it is not blocky and not resampled)', evidence)
        evidence['colours'] = visible_colours(pixels)
        return _refuse('on-grid-altered', 'the snapper returned the size it was given but changed the art: the grid it '
                       'claims is not the art\'s', evidence)

    if pixel_size == 1:
        return _refuse('on-grid-altered', f'pixel size 1 keeps a picture, and the snapper returned {out_w}x{out_h} for '
                       f'{width}x{height}', evidence)
    factor = (width / out_w, height / out_h)
    evidence['factor'] = [_num(factor[0]), _num(factor[1])]
    if out_w % cell or out_h % cell:
        return _refuse('off-grid-size', f'{out_w}x{out_h} is not a whole number of {cell} px cells', evidence)
    problems = contract.size_problems(out_w, out_h)
    if problems:
        return _refuse('family-size', '; '.join(problems), evidence)
    low, high = MIN_FACTOR, MAX_FACTOR + FACTOR_SLACK
    if not all(low <= f <= high for f in factor):
        return _refuse('factor-out-of-range', f'the enlargement {factor[0]:.2f}x by {factor[1]:.2f}x is outside the proven range '
                       f'{MIN_FACTOR:g}x to {MAX_FACTOR:g}x', evidence)
    skew = abs(factor[0] / factor[1] - 1)
    evidence['factorSkew'] = _num(skew)
    if skew > MAX_FACTOR_SKEW and not contract.allow_unequal_factors:
        return _refuse('factor-unequal', f'the factors {factor[0]:.2f}x and {factor[1]:.2f}x differ by {skew:.1%}, more than '
                       f'{MAX_FACTOR_SKEW:.0%}', evidence)
    if pixel_size and not all(abs(f - pixel_size) <= pixel_size * 0.1 + FACTOR_SLACK for f in factor):
        return _refuse('pixel-size-mismatch', f'the caller gave pixel size {pixel_size} and the picture shrank by '
                       f'{factor[0]:.2f}x by {factor[1]:.2f}x', evidence)
    measured = agreement(pixels, snapped)
    evidence.update({'agreement': _num(measured['agreement']), 'comparedPixels': measured['pixels'],
                     'agreementMin': AGREEMENT_MIN})
    if measured['agreement'] is None:
        return _refuse('reenlargement-unmeasurable', 'nothing is visible in the cores of the cells: the re-enlargement cannot '
                       'be compared', evidence)
    if measured['agreement'] < AGREEMENT_MIN:
        return _refuse('reenlargement-disagrees', f'the result enlarged back agrees with the picture on '
                       f'{measured["agreement"]:.1%} of the compared pixels, below {AGREEMENT_MIN:.0%}', evidence)
    coarse = coarse_agreement(pixels, snapped)
    evidence['coarseAgreement'] = {str(m): _num(value) for m, value in coarse.items()}
    ambiguous = {m: value for m, value in coarse.items() if value >= COARSE_MAX}
    if ambiguous:
        m = min(ambiguous)
        return _refuse('coarser-grid-explains', f'the result read at every {m}th pixel explains the picture as well '
                       f'({ambiguous[m]:.1%} of the compared pixels, from {COARSE_MAX:.0%}): the snapper may have stopped at '
                       f'a fraction of the true grid', evidence)
    fit = registration(pixels, snapped, measured['agreement'])
    evidence['registration'] = {'margin': _num(fit['margin']), 'move': fit['move'], 'movedAgreement': _num(fit['movedAgreement']),
                                'marginMin': REGISTRATION_MARGIN}
    if fit['margin'] is None or fit['margin'] < REGISTRATION_MARGIN:
        return _refuse('registration-ambiguous', f'the result moved by one art pixel {tuple(fit["move"])} agrees with the picture on '
                       f'{fit["movedAgreement"]:.1%} of the compared pixels, against {measured["agreement"]:.1%} where it is: '
                       f'less than {REGISTRATION_MARGIN:.0%} apart, so the result may have been cut one art pixel off', evidence)
    return Decision(ACCEPT, 'enlargement-proven', f'an enlargement by {factor[0]:.2f}x by {factor[1]:.2f}x; the result enlarged '
                    f'back agrees on {measured["agreement"]:.1%} of the compared pixels, {fit["margin"]:.1%} better than moved by '
                    f'one art pixel', evidence)
