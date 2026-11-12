"""Koncluí design-system colours for the HQ office, and the recolouring of catalogue pictures into them.

Sources: konclui-platform tokens (mirrored in konclui-website .../operator-app/tokens.ts: background #F5FAFC,
surfaces #FFFFFF/#E8F1F5/#DDE9EE, petrol #1E454D, mint #53FFC8/#00D7A1, navy #0D184F->#080924) and the main office's
approved finishes (office/README.md: ink #0A0A3D on wall tops and profiles, turquoise #02D1CE film on glass).

  wall_piece(piece)        a catalogue thin-wall piece (Plain_White) with its four colours swapped to WALL
  floor_tile(name, ramp)   a catalogue floor tile mapped by luminance onto a ramp of FLOOR_RAMPS
  recolour(f, ramp)        a catalogue furniture variant whose colourable part (where its colour variants differ) is
                           mapped onto a ramp; the rest (frame, wheels, wood) stays
"""
from functools import lru_cache

import numpy as np
from PIL import Image

import catalogue as CAT


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


INK = '#0A0A3D'
NAVY = '#0D184F'
PETROL = '#1E454D'
TURQUOISE = '#02D1CE'
MINT = '#53FFC8'
MINT_STRONG = '#00D7A1'
PAPER = '#F5FAFC'
SURFACE2 = '#E8F1F5'
SURFACE3 = '#DDE9EE'
BORDER = '#DFE4E6'
TEXT = '#1A1F1E'

# Catalogue Plain_White wall colours -> design system: the face is a cool white, the top of the wall an ink line (as in
# an architect's plan and the main office's profiles), the base line a soft shadow.
WALL_SOURCE = 'Plain_White'
WALL = {(248, 246, 252): INK,          # top band (the "cap" a thin wall shows from above)
        (217, 226, 233): '#EEF3F6',    # face
        (191, 204, 215): '#2B3A78',    # the cap's bevel edge
        (149, 165, 178): '#C2CFD7'}    # base line where the face meets the floor

FLOOR_RAMPS = {   # dark -> light; a floor's luminance range is stretched over the ramp (low contrast on purpose)
    'porcelain': ['#D9E3E8', '#E8EFF2', '#F1F6F8', '#F8FBFC'],
    'oak': ['#C6AB8B', '#D5BE9F', '#E1CDB2', '#EBDDC8'],
    'oak-warm': ['#D9BA95', '#E0C29F', '#E8CCA8', '#F0D6B2'],   # the café lounge, one step warmer, soft seams (20/10)
    'ink': ['#0A0F33', '#0D184F', '#111D58', '#162461'],
    'petrol': ['#183B43', '#1E454D', '#234F58', '#295964'],
    'mist': ['#D3DFE4', '#E1EAEE', '#EAF1F4', '#F1F6F8'],
}
FURNITURE_RAMPS = {
    'ds-petrol': ['#0F262C', '#1E454D', '#2C626C', '#3F7C86'],
    'ds-ink': ['#05061A', '#0B1441', '#142160', '#1F2E78'],
    'ds-mint': ['#0E7F66', '#00D7A1', '#53FFC8', '#B6FFE7'],
    'ds-turquoise': ['#04706F', '#02A8A6', '#02D1CE', '#7FF0EE'],
    'ds-slate': ['#46566E', '#6F83A0', '#8A9FBA', '#A8BBD2'],     # the lounge couches, a bluer slate than grey
}


def ramp_map(lum, ramp):
    """Luminance 0..1 -> RGB on a ramp (piecewise linear between its stops)."""
    stops = np.array([rgb(c) for c in ramp], float)
    pos = np.clip(lum, 0, 1) * (len(stops) - 1)
    i = np.minimum(pos.astype(int), len(stops) - 2)
    t = (pos - i)[..., None]
    return stops[i] * (1 - t) + stops[i + 1] * t


def luminance(a):
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255


@lru_cache(maxsize=None)
def wall_piece(piece):
    sha = next(w['sha'] for w in CAT.catalog()['walls'] if w['style'] == WALL_SOURCE and w['piece'] == piece)
    a = np.asarray(CAT.image(sha)).copy()
    out = a.copy()
    for src, dst in WALL.items():
        hit = (a[..., 0] == src[0]) & (a[..., 1] == src[1]) & (a[..., 2] == src[2]) & (a[..., 3] > 0)
        out[hit, :3] = rgb(dst)
    return Image.fromarray(out, 'RGBA')


@lru_cache(maxsize=None)
def floor_tile(name, ramp=None):
    sha = next(f['sha'] for f in CAT.catalog()['floors'] if f['name'] == name + '.png')
    img = CAT.image(sha)
    if not ramp:
        return img
    a = np.asarray(img).astype(float)
    lum = luminance(a)
    lo, hi = lum.min(), lum.max()
    norm = (lum - lo) / (hi - lo) if hi > lo else np.full_like(lum, 0.6)
    out = a.copy()
    out[..., :3] = ramp_map(norm, FLOOR_RAMPS[ramp])
    return Image.fromarray(out.round().astype(np.uint8), 'RGBA')


def _variant(type_, colour, direction):
    for f in CAT.catalog()['furniture']:
        if (f['type'], f['color'], f['orientation']) == (type_, colour, direction) and f['published']:
            return f
    return None


@lru_cache(maxsize=None)
def recolour(type_, direction, ramp):
    """(image, collisionGrid, depthOffset, seat) of a catalogue variant recoloured onto FURNITURE_RAMPS[ramp].
    The colourable pixels are those that differ between the type's colour variants; the picture underneath is the
    lightest neutral variant, so its shading survives."""
    colours = sorted({f['color'] for f in CAT.catalog()['furniture']
                      if f['type'] == type_ and f['orientation'] == direction and f['published']})
    base_colour = next(c for c in ('grey', 'white', 'black', *colours) if c in colours)
    base = CAT.furniture_piece(_variant(type_, base_colour, direction))
    img = np.asarray(base[0]).astype(float)
    others = [np.asarray(CAT.furniture_piece(_variant(type_, c, direction))[0]).astype(float)
              for c in colours if c != base_colour][:6]
    differs = np.zeros(img.shape[:2], bool)
    for o in others:
        if o.shape == img.shape:
            differs |= np.abs(o[..., :3] - img[..., :3]).sum(-1) > 24
    differs &= img[..., 3] > 0
    if not differs.any():
        raise ValueError(f'{type_} {direction}: no colourable pixels')
    lum = luminance(img)
    lo, hi = np.percentile(lum[differs], 2), np.percentile(lum[differs], 98)
    norm = np.clip((lum - lo) / (hi - lo if hi > lo else 1), 0, 1)
    out = img.copy()
    out[differs, :3] = ramp_map(norm[differs], FURNITURE_RAMPS[ramp])
    return (Image.fromarray(out.round().astype(np.uint8), 'RGBA'), *base[1:])
