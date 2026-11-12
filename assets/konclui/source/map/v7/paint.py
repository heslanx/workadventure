"""Painting core of the campus v7: full-map pixel canvases, sliced into deduplicated 32 px tiles.

Each map layer is painted as one RGBA image (W*32 x H*32), then cut into cells; identical cells share one tile in a
TileBank (one bank = one tileset image). Textures are aligned to the global grid, so only edges and unique details
create new tiles.
"""
import hashlib
import math

import numpy as np
from PIL import Image

T = 32


class TileBank:
    """Deduplicated tiles of one tileset. Tile id 0-based; -1 = empty (fully transparent).
    Animations: animate(frames) returns a "head" tile that carries the animation (Tiled tile property); the head is a
    copy of the first frame kept apart from deduplication, so a static use of the same picture never animates."""

    def __init__(self, name, cols=32):
        self.name, self.cols = name, cols
        self.tiles, self.index = [], {}
        self.animations, self.anim_heads = {}, {}
        self.empty = None

    def add(self, tile):
        if not tile.getbbox():
            return -1
        key = hashlib.sha1(tile.tobytes()).hexdigest()
        if key not in self.index:
            self.index[key] = len(self.tiles)
            self.tiles.append(tile)
        return self.index[key]

    def _frame_id(self, tile):
        tid = self.add(tile)
        if tid == -1:
            if self.empty is None:
                self.empty = len(self.tiles)
                self.tiles.append(Image.new("RGBA", (T, T)))
            tid = self.empty
        return tid

    def animate(self, frames, unit_ms):
        """frames: tile images, one per time unit. Consecutive equal frames merge into one longer frame."""
        seq = []
        for img in frames:
            tid = self._frame_id(img)
            if seq and seq[-1][0] == tid:
                seq[-1][1] += unit_ms
            else:
                seq.append([tid, unit_ms])
        if len(seq) == 1:
            return -1 if seq[0][0] == self.empty else seq[0][0]
        key = tuple((a, b) for a, b in seq)
        if key not in self.anim_heads:
            head = len(self.tiles)
            self.tiles.append(self.tiles[seq[0][0]].copy())
            self.anim_heads[key] = head
            self.animations[head] = [{"tileid": a, "duration": b} for a, b in seq]
        return self.anim_heads[key]

    def tiled_tiles(self):
        """The "tiles" entry of a Tiled tileset: the animations."""
        return [{"id": head, "animation": frames} for head, frames in sorted(self.animations.items())]

    def image(self):
        rows = max(1, math.ceil(len(self.tiles) / self.cols))
        sheet = Image.new("RGBA", (self.cols * T, rows * T), (0, 0, 0, 0))
        for i, t in enumerate(self.tiles):
            sheet.alpha_composite(t, ((i % self.cols) * T, (i // self.cols) * T))
        return sheet

    def __len__(self):
        return len(self.tiles)


def slice_into(canvas, bank, W, H):
    """Cut a full-map canvas into cells; returns a W*H list of tile ids (-1 for empty cells)."""
    out = [-1] * (W * H)
    for y in range(H):
        for x in range(W):
            out[y * W + x] = bank.add(canvas.crop((x * T, y * T, x * T + T, y * T + T)))
    return out


# ---------------------------------------------------------------- pixel masks (numpy bool, H*T x W*T)
def shift(mask, dx, dy):
    """mask moved by (dx, dy) pixels, padding with False."""
    out = np.zeros_like(mask)
    h, w = mask.shape
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    out[yd, xd] = mask[ys, xs]
    return out


def dilate(mask, r=1):
    out = mask.copy()
    for _ in range(r):
        out = out | shift(out, 1, 0) | shift(out, -1, 0) | shift(out, 0, 1) | shift(out, 0, -1)
    return out


def erode(mask, r=1):
    return ~dilate(~mask, r)


def border(mask):
    """Pixels of the mask that touch the outside (its 1 px inner outline)."""
    return mask & ~erode(mask, 1)


def blit(dst, src, x, y):
    """alpha_composite that accepts sprites partly outside dst (negative or overflowing offsets)."""
    x, y = int(x), int(y)
    sx0, sy0 = max(0, -x), max(0, -y)
    sx1, sy1 = min(src.width, dst.width - x), min(src.height, dst.height - y)
    if sx1 > sx0 and sy1 > sy0:
        dst.alpha_composite(src.crop((sx0, sy0, sx1, sy1)), (x + sx0, y + sy0))


def paint(canvas_arr, mask, color):
    """Set pixels of an RGBA numpy canvas where mask is True (color: 3 or 4 values)."""
    c = np.array(color if len(color) == 4 else (*color, 255), dtype=np.uint8)
    canvas_arr[mask] = c


def paint_texture(canvas_arr, mask, tex_canvas_arr):
    """Copy a full-size textured canvas into the RGBA canvas where mask is True."""
    canvas_arr[mask] = tex_canvas_arr[mask]


def rect_mask(shape, x0, y0, x1, y1):
    m = np.zeros(shape, dtype=bool)
    m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = True
    return m


def ellipse_mask(shape, cx, cy, rx, ry):
    h, w = shape
    yy, xx = np.ogrid[:h, :w]
    return ((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2 <= 1
