/** Water geometry for the koi: a signed distance field with its gradient, and geodesic
 * flow fields on a coarse grid. Pure functions over a mask array; no DOM, no clock.
 *
 * Mask convention: an array-like of length width*height, nonzero = water. Everything
 * outside the image counts as land, so a canal cut by the overlay edge is closed there. */

const BIG = 1e20;
const SQRT2 = Math.SQRT2;

// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher) of f into d.
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -BIG; z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Squared distance from every cell of a padded grid to the nearest cell where seed is true.
function squaredDistance(seed, w, h) {
  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = seed[i] ? 0 : BIG;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x];
  }
  return out;
}

/**
 * Signed distance to the shore in pixels (positive in water, negative on land), measured
 * from pixel centres to the boundary between pixels, plus its central-difference gradient.
 * sample(x, y) and gradient(x, y, out) are bilinear in continuous pixel coordinates.
 */
export function createField(mask, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('field size must be positive integers');
  }
  if (!mask || mask.length !== width * height) throw new RangeError('mask length must be width*height');
  const pw = width + 2, ph = height + 2;
  const land = new Uint8Array(pw * ph).fill(1);
  const water = new Uint8Array(pw * ph);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) { land[(y + 1) * pw + x + 1] = 0; water[(y + 1) * pw + x + 1] = 1; }
    }
  }
  const toLand = squaredDistance(land, pw, ph);
  const toWater = squaredDistance(water, pw, ph);
  const sdf = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y + 1) * pw + x + 1;
      sdf[y * width + x] = water[p] ? Math.sqrt(toLand[p]) - 0.5 : 0.5 - Math.sqrt(toWater[p]);
    }
  }
  const gx = new Float32Array(width * height), gy = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1), down = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - 1), right = Math.min(width - 1, x + 1);
      const i = y * width + x;
      gx[i] = (sdf[y * width + right] - sdf[y * width + left]) / Math.max(1, right - left);
      gy[i] = (sdf[down * width + x] - sdf[up * width + x]) / Math.max(1, down - up);
    }
  }

  function bilinear(grid, x, y) {
    const fx = Math.min(width - 1, Math.max(0, x - 0.5));
    const fy = Math.min(height - 1, Math.max(0, y - 0.5));
    const ix = Math.min(width - 2, Math.floor(fx)), iy = Math.min(height - 2, Math.floor(fy));
    const tx = fx - ix, ty = fy - iy;
    const i = iy * width + ix;
    const top = grid[i] + (grid[i + 1] - grid[i]) * tx;
    const bottom = grid[i + width] + (grid[i + width + 1] - grid[i + width]) * tx;
    return top + (bottom - top) * ty;
  }

  return {
    width, height, sdf, gx, gy,
    /** Signed shore distance at a continuous point; beyond the image it keeps falling. */
    sample(x, y) {
      const value = bilinear(sdf, x, y);
      const ox = x < 0 ? -x : x > width ? x - width : 0;
      const oy = y < 0 ? -y : y > height ? y - height : 0;
      return ox || oy ? Math.min(value, -Math.hypot(ox, oy)) : value;
    },
    /** Gradient (points away from the shore) written into out[0], out[1]. */
    gradient(x, y, out) {
      out[0] = bilinear(gx, x, y);
      out[1] = bilinear(gy, x, y);
      return out;
    },
  };
}

/**
 * Geodesic distance and flow fields on a coarse grid of `cell` px. Cells whose centre is
 * at least `minClear` px from the shore are passable; cells closer than `comfort` px cost
 * more, so paths run down the middle of a canal and round a canal mouth with room to spare.
 * compute() fills caller-owned buffers, so fields can be rebuilt without allocation.
 */
export function createGeodesic(field, { cell = 8, comfort = 24, minClear = 3 } = {}) {
  const cols = Math.ceil(field.width / cell), rows = Math.ceil(field.height / cell);
  const count = cols * rows;
  const clear = new Float32Array(count), passable = new Uint8Array(count), cost = new Float32Array(count);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = Math.min(field.width - 0.5, (c + 0.5) * cell), y = Math.min(field.height - 0.5, (r + 0.5) * cell);
      clear[i] = field.sample(x, y);
      passable[i] = clear[i] >= minClear ? 1 : 0;
      cost[i] = 1 + 3 * Math.max(0, (comfort - clear[i]) / comfort);
    }
  }
  const heapCell = new Int32Array(count * 8 + 8), heapKey = new Float64Array(count * 8 + 8);
  const work = new Float64Array(count);       // full precision while relaxing; copied out at the end
  let heapSize = 0;
  const NX = [1, -1, 0, 0, 1, 1, -1, -1], NY = [0, 0, 1, -1, 1, -1, 1, -1];
  const NL = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

  function push(c, key) {
    let i = heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapKey[parent] <= key) break;
      heapCell[i] = heapCell[parent]; heapKey[i] = heapKey[parent]; i = parent;
    }
    heapCell[i] = c; heapKey[i] = key;
  }
  function pop() {
    const top = heapCell[0];
    const lastCell = heapCell[--heapSize], lastKey = heapKey[heapSize];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= heapSize) break;
      if (child + 1 < heapSize && heapKey[child + 1] < heapKey[child]) child++;
      if (heapKey[child] >= lastKey) break;
      heapCell[i] = heapCell[child]; heapKey[i] = heapKey[child]; i = child;
    }
    heapCell[i] = lastCell; heapKey[i] = lastKey;
    return top;
  }

  function cellAt(x, y) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
    return r * cols + c;
  }

  /** Nearest passable cell to a point (ring search), or -1 when there is none. */
  function nearestPassable(x, y) {
    const start = cellAt(x, y);
    if (passable[start]) return start;
    const c0 = start % cols, r0 = (start / cols) | 0;
    for (let ring = 1; ring < Math.max(cols, rows); ring++) {
      let best = -1, bestD = Infinity;
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        if (r < 0 || r >= rows) continue;
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (c < 0 || c >= cols || (Math.abs(r - r0) !== ring && Math.abs(c - c0) !== ring)) continue;
          const i = r * cols + c;
          if (!passable[i]) continue;
          const d = (c - c0) ** 2 + (r - r0) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Dijkstra from the cell nearest (x, y); fills dist (count) and unit flow (2*count). */
  function compute(x, y, dist, flow) {
    work.fill(Infinity);
    flow.fill(0);
    const source = nearestPassable(x, y);
    if (source < 0) { dist.fill(Infinity); return -1; }
    work[source] = 0;
    heapSize = 0;
    push(source, 0);
    while (heapSize > 0) {
      const key = heapKey[0];
      const c = pop();
      if (key > work[c]) continue;
      const cc = c % cols, cr = (c / cols) | 0;
      for (let k = 0; k < 8; k++) {
        const nc = cc + NX[k], nr = cr + NY[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (!passable[n]) continue;
        // No diagonal shortcut past a land corner.
        if (k >= 4 && (!passable[cr * cols + nc] || !passable[nr * cols + cc])) continue;
        const next = key + NL[k] * cell * 0.5 * (cost[c] + cost[n]);
        if (next < work[n]) { work[n] = next; push(n, next); }
      }
    }
    dist.set(work);
    for (let c = 0; c < count; c++) {
      if (!passable[c] || !Number.isFinite(dist[c])) continue;
      const cc = c % cols, cr = (c / cols) | 0;
      let vx = 0, vy = 0;
      for (let k = 0; k < 8; k++) {
        const nc = cc + NX[k], nr = cr + NY[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (!passable[n] || !(dist[n] < dist[c])) continue;
        if (k >= 4 && (!passable[cr * cols + nc] || !passable[nr * cols + cc])) continue;
        const slope = (dist[c] - dist[n]) / (NL[k] * NL[k]);
        vx += NX[k] * slope; vy += NY[k] * slope;
      }
      const length = Math.hypot(vx, vy);
      if (length > 0) { flow[2 * c] = vx / length; flow[2 * c + 1] = vy / length; }
    }
    return source;
  }

  /**
   * Bilinear blend of the flow over the passable cells around (x, y), written into out as
   * a unit vector (zero at the source or off the grid). Returns the remaining geodesic
   * distance estimate, Infinity when the point is not connected to the source.
   */
  function flowAt(dist, flow, x, y, out) {
    const fx = x / cell - 0.5, fy = y / cell - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    let wsum = 0, vx = 0, vy = 0, dsum = 0;
    for (let k = 0; k < 4; k++) {
      const c = ix + (k & 1), r = iy + (k >> 1);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (!passable[i] || !Number.isFinite(dist[i])) continue;
      const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty) + 1e-4;
      wsum += w; vx += flow[2 * i] * w; vy += flow[2 * i + 1] * w; dsum += dist[i] * w;
    }
    if (wsum === 0) {
      const i = nearestPassable(x, y);
      if (i < 0 || !Number.isFinite(dist[i])) { out[0] = 0; out[1] = 0; return Infinity; }
      const cx = ((i % cols) + 0.5) * cell, cy = (((i / cols) | 0) + 0.5) * cell;
      const d = Math.hypot(cx - x, cy - y) || 1;
      out[0] = (cx - x) / d; out[1] = (cy - y) / d;
      return dist[i] + d;
    }
    const length = Math.hypot(vx, vy);
    out[0] = length > 1e-6 ? vx / length : 0;
    out[1] = length > 1e-6 ? vy / length : 0;
    return dsum / wsum;
  }

  return { cell, cols, rows, count, clear, passable, cellAt, nearestPassable, compute, flowAt };
}
