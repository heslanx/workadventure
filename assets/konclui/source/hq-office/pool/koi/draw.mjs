/** Koi painter: canvas 2D at native resolution (1 canvas px = 1 map px), drawn in whole pixels like the rest of the
 * map. Each fish is rasterised from the simulated spine into a small grid (body, fins, pattern, one pixel of ink round
 * it, eyes) and written with fillRect: no anti-aliasing, no translucency and no shadow of its own (a painted shadow is
 * what the office art leaves to the runtime). A fish in deep water uses a second, cooler palette instead of a see-through
 * veil. Every frame starts from a cleared canvas and ends clipped to the open-water mask, so fish under the deck stay
 * hidden. No allocation per frame: the grid and the geometry are preallocated and every colour is a constant string. */

const TAU = Math.PI * 2;
const ST = 12;                                   // stations along the body, snout to tail root

// A touch muted so they sit in pixel art.
const IVORY = '#ded4bd', RED = '#b04a33', SUMI = '#2b3134', GOLD = '#c79a4e', GOLD_DEEP = '#9f7a3e';
const BLACK = '#262b2f', SHEEN = '#4a545c';
const BASE = { kohaku: IVORY, sanke: IVORY, gold: GOLD, shiro: IVORY, black: BLACK };
const FIN = { kohaku: '#eee6d4', sanke: '#eee6d4', gold: '#dfc080', shiro: '#e4ddcd', black: '#3b4247' };
const BLOB_COLORS = [RED, SUMI, GOLD_DEEP, SHEEN];
const OUTLINE = '#123e47', VEIL = '#1c5a63', EYE = '#15191b', RING = '#e2f4f1';
const PELLET = '#c48a4b', PELLET_EDGE = '#3a2615';

// Grid cell values: 1 body, 2 fin, 3..6 the four pattern colours, 7 ink, 8 eye. PALETTE[pattern][deep] maps them to colours.
const CELL_FIN = 2, CELL_BLOB = 3, CELL_INK = 7, CELL_EYE = 8;
const GW = 48;                                   // grid side: a fish is at most 20 px long, with its fins well inside
const DEEP_FROM = 0.6;                           // depth at which a fish takes the deep palette
const mixHex = (a, b, t) => {
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const v = Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
};
const PALETTE = {};
for (const pattern of Object.keys(BASE)) {
  const plain = ['', BASE[pattern], FIN[pattern], ...BLOB_COLORS, OUTLINE, EYE];
  PALETTE[pattern] = [plain, plain.map((c, i) => (i && i !== CELL_INK && i !== CELL_EYE ? mixHex(c, VEIL, 0.24) : c))];
}

function hashRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let v = Math.imul(state ^ (state >>> 15), state | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pattern blobs in body coordinates: [u along body 0..1, v across -1..1, ru (of length),
 * rv (of half width), colour index]. Built once per fish from its variant. */
function makeLayout(pattern, variant) {
  const r = hashRandom(variant);
  const blobs = [];
  const add = (u, v, ru, rv, color) => blobs.push(u, v, ru, rv, color);
  if (pattern === 'kohaku' || pattern === 'sanke') {
    if (r() < 0.6) add(0.07 + r() * 0.07, (r() - 0.5) * 0.3, 0.07 + r() * 0.03, 0.7 + r() * 0.3, 0);
    add(0.3 + r() * 0.15, (r() - 0.5) * 0.6, 0.1 + r() * 0.05, 0.6 + r() * 0.35, 0);
    if (r() < 0.75) add(0.55 + r() * 0.15, (r() - 0.5) * 0.6, 0.07 + r() * 0.04, 0.5 + r() * 0.3, 0);
    if (pattern === 'sanke') {
      const spots = 3 + Math.floor(r() * 2);
      for (let i = 0; i < spots; i++) add(0.25 + r() * 0.5, (r() - 0.5) * 1.2, 0.025 + r() * 0.02, 0.18 + r() * 0.16, 1);
    }
  } else if (pattern === 'shiro') {
    add(0.05 + r() * 0.1, (r() - 0.5) * 0.8, 0.06 + r() * 0.03, 0.5 + r() * 0.25, 1);
    const patches = 2 + Math.floor(r() * 2);
    for (let i = 0; i < patches; i++) add(0.25 + r() * 0.5, (r() - 0.5) * 1.1, 0.07 + r() * 0.05, 0.45 + r() * 0.4, 1);
  } else if (pattern === 'gold') {
    add(0.45, 0.95, 0.32, 0.32, 2);
    add(0.45, -0.95, 0.32, 0.32, 2);
  } else {
    add(0.38 + r() * 0.08, 0, 0.22, 0.28, 3);
  }
  return new Float32Array(blobs);
}

// Koi from above: blunt head, full shoulders and belly, then a taper to the tail root.
const profile = (u) => (u < 0.2 ? 0.62 + 0.38 * Math.sin((u / 0.2) * Math.PI / 2)
  : u < 0.5 ? 1 : 1 - 0.8 * Math.pow((u - 0.5) / 0.5, 1.5));

/**
 * createPainter({canvas, clip}) -> {paint(snapshot)}. clip is a canvas image source of the
 * canvas size whose alpha is the open-water mask (opaque = visible water).
 */
export function createPainter({ canvas, clip }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required');
  const cx = new Float64Array(ST), cy = new Float64Array(ST), tx = new Float64Array(ST), ty = new Float64Array(ST);
  const hw = new Float64Array(ST), lx = new Float64Array(ST), ly = new Float64Array(ST);
  const rx = new Float64Array(ST), ry = new Float64Array(ST);
  const vx = new Float64Array(16), vy = new Float64Array(16), arc = new Float64Array(16);
  const order = new Int32Array(64);
  const layouts = new Map();
  let tipX = 0, tipY = 0;

  // Stations along snout + spine, displaced by the travelling wave.
  function buildBody(f, reduced) {
    const spine = f.spine, joints = spine.length / 2, L = f.length;
    const hc = Math.cos(f.heading), hs = Math.sin(f.heading);
    vx[0] = spine[0] + hc * 0.3 * L; vy[0] = spine[1] + hs * 0.3 * L; arc[0] = 0;
    for (let i = 0; i < joints; i++) {
      vx[i + 1] = spine[2 * i]; vy[i + 1] = spine[2 * i + 1];
      arc[i + 1] = arc[i] + Math.hypot(vx[i + 1] - vx[i], vy[i + 1] - vy[i]);
    }
    const total = arc[joints] || 1;
    let seg = 0;
    for (let k = 0; k < ST; k++) {
      const s = (k / (ST - 1)) * total;
      while (seg < joints - 1 && arc[seg + 1] < s) seg++;
      const span = arc[seg + 1] - arc[seg] || 1, t = Math.min(1, Math.max(0, (s - arc[seg]) / span));
      cx[k] = vx[seg] + (vx[seg + 1] - vx[seg]) * t;
      cy[k] = vy[seg] + (vy[seg + 1] - vy[seg]) * t;
    }
    // Tangents of the undisplaced line, then the lateral wave (stronger toward the tail).
    const amp = L * (0.02 + 0.075 * Math.min(1, f.effort)) * (reduced ? 0.5 : 1);
    for (let k = 0; k < ST; k++) {
      const a = Math.max(0, k - 1), b = Math.min(ST - 1, k + 1);
      let dx = cx[a] - cx[b], dy = cy[a] - cy[b];
      const d = Math.hypot(dx, dy) || 1;
      tx[k] = dx / d; ty[k] = dy / d;
    }
    for (let k = 1; k < ST; k++) {
      const u = k / (ST - 1), o = amp * u * u * Math.sin(f.phase - 5.2 * u);
      cx[k] += -ty[k] * o; cy[k] += tx[k] * o;
    }
    for (let k = 0; k < ST; k++) {
      const a = Math.max(0, k - 1), b = Math.min(ST - 1, k + 1);
      let dx = cx[a] - cx[b], dy = cy[a] - cy[b];
      const d = Math.hypot(dx, dy) || 1;
      tx[k] = dx / d; ty[k] = dy / d;                    // points toward the head
      hw[k] = 0.5 * f.width * profile(k / (ST - 1));
      lx[k] = cx[k] - ty[k] * hw[k]; ly[k] = cy[k] + tx[k] * hw[k];
      rx[k] = cx[k] + ty[k] * hw[k]; ry[k] = cy[k] - tx[k] * hw[k];
    }
    tipX = cx[0] + tx[0] * hw[0] * 1.45; tipY = cy[0] + ty[0] * hw[0] * 1.45;
  }

  const grid = new Uint8Array(GW * GW);
  let gx = 0, gy = 0;                                    // map position of grid cell (0, 0)

  /** Marks the cells whose centre is within r of (x, y) map px with value v; `only` limits it to cells holding that value
   * (0 = any empty or any). */
  function disc(x, y, r, v, only) {
    const x0 = Math.max(0, Math.floor(x - r - gx)), x1 = Math.min(GW - 1, Math.floor(x + r - gx));
    const y0 = Math.max(0, Math.floor(y - r - gy)), y1 = Math.min(GW - 1, Math.floor(y + r - gy));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const dx = gx + i + 0.5 - x, dy = gy + j + 0.5 - y;
        if (dx * dx + dy * dy <= r * r && (only === undefined || grid[j * GW + i] === only)) grid[j * GW + i] = v;
      }
    }
  }

  // Interpolated station at body parameter u: writes into at[0..4] = x, y, tx, ty, half width.
  const at = new Float64Array(5);
  function station(u) {
    const p = Math.min(ST - 1.0001, Math.max(0, u * (ST - 1))), k = Math.floor(p), t = p - k;
    at[0] = cx[k] + (cx[k + 1] - cx[k]) * t; at[1] = cy[k] + (cy[k + 1] - cy[k]) * t;
    at[2] = tx[k] + (tx[k + 1] - tx[k]) * t; at[3] = ty[k] + (ty[k + 1] - ty[k]) * t;
    at[4] = hw[k] + (hw[k + 1] - hw[k]) * t;
  }

  // A pectoral or pelvic fin: a nub just outside the body, swinging with the stroke.
  function fin(u, side, angle, length) {
    station(u);
    const bx = -at[2], by = -at[3], nx = -at[3] * side, ny = at[2] * side;
    const dx = bx * Math.cos(angle) + nx * Math.sin(angle), dy = by * Math.cos(angle) + ny * Math.sin(angle);
    disc(at[0] + nx * at[4] * 0.8 + dx * length * 0.75, at[1] + ny * at[4] * 0.8 + dy * length * 0.75, 0.6, CELL_FIN);
  }

  function rasterise(f, reduced) {
    const L = f.length;
    // The grid sits on the whole-pixel corner just before the fish's extent.
    let minX = Infinity, minY = Infinity;
    for (let k = 0; k < ST; k++) { minX = Math.min(minX, cx[k]); minY = Math.min(minY, cy[k]); }
    gx = Math.floor(minX - 0.35 * L) - 2; gy = Math.floor(minY - 0.35 * L) - 2;
    grid.fill(0);

    // Caudal fin first (the body is drawn over its root): a centre line and two lobes swinging with the wave.
    const e = ST - 1;
    const swing = 0.45 * Math.sin(f.phase - 6.1) * (0.25 + 0.75 * Math.min(1, f.effort)) * (reduced ? 0.5 : 1);
    const back = Math.atan2(-ty[e], -tx[e]) + swing;
    const fx = Math.cos(back), fy = Math.sin(back), sx = -fy, sy = fx;
    const fl = 0.24 * L, fs = 0.13 * L * (1 - 0.2 * Math.abs(Math.sin(f.phase)));
    for (let s = 0.3; s <= 0.8; s += 0.25) disc(cx[e] + fx * fl * s, cy[e] + fy * fl * s, 0.6, CELL_FIN);
    for (const side of [-1, 1]) {
      disc(cx[e] + fx * fl * 0.6 + sx * fs * 0.45 * side, cy[e] + fy * fl * 0.6 + sy * fs * 0.45 * side, 0.55, CELL_FIN);
      disc(cx[e] + fx * fl + sx * fs * 0.8 * side, cy[e] + fy * fl + sy * fs * 0.8 * side, 0.55, CELL_FIN);
    }
    const finWave = Math.sin(f.finPhase), flap = reduced ? 0.12 : 0.28;
    fin(0.26, 1, 0.95 + flap * finWave, 0.1 * L * 1.6);
    fin(0.26, -1, 0.95 - flap * finWave, 0.1 * L * 1.6);

    // Body: discs along the spine, as wide as the half width at each station, plus the snout.
    for (let k = 0; k < ST - 1; k++) {
      const span = Math.hypot(cx[k + 1] - cx[k], cy[k + 1] - cy[k]), n = Math.max(1, Math.ceil(span / 0.5));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        disc(cx[k] + (cx[k + 1] - cx[k]) * t, cy[k] + (cy[k + 1] - cy[k]) * t, Math.max(0.6, hw[k] + (hw[k + 1] - hw[k]) * t), 1);
      }
    }
    disc(tipX, tipY, Math.max(0.6, hw[0] * 0.85), 1);

    // Pattern: each blob is an ellipse that follows the body; only body cells take it.
    let layout = layouts.get(f.id);
    if (!layout || layout.variant !== f.variant) {
      layout = { variant: f.variant, blobs: makeLayout(f.pattern, f.variant) };
      layouts.set(f.id, layout);
    }
    const blobs = layout.blobs;
    for (let b = 0; b < blobs.length; b += 5) {
      station(blobs[b]);
      const ox = at[0] - at[3] * blobs[b + 1] * at[4], oy = at[1] + at[2] * blobs[b + 1] * at[4];
      const ra = Math.max(0.75, blobs[b + 2] * L), rb = Math.max(0.75, blobs[b + 3] * at[4]);
      const colour = CELL_BLOB + blobs[b + 4], reach = Math.max(ra, rb);
      const x0 = Math.max(0, Math.floor(ox - reach - gx)), x1 = Math.min(GW - 1, Math.floor(ox + reach - gx));
      const y0 = Math.max(0, Math.floor(oy - reach - gy)), y1 = Math.min(GW - 1, Math.floor(oy + reach - gy));
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          if (grid[j * GW + i] !== 1) continue;
          const dx = gx + i + 0.5 - ox, dy = gy + j + 0.5 - oy;
          const u = dx * at[2] + dy * at[3], v = -dx * at[3] + dy * at[2];
          if ((u * u) / (ra * ra) + (v * v) / (rb * rb) <= 1) grid[j * GW + i] = colour;
        }
      }
    }

    // Eyes (only where the head is wide enough to hold two) and the mouth while it opens.
    station(0.11);
    if (f.width >= 3.6) {
      for (let side = -1; side <= 1; side += 2) {
        const ex = Math.floor(at[0] - at[3] * at[4] * 0.62 * side - gx), ey = Math.floor(at[1] + at[2] * at[4] * 0.62 * side - gy);
        if (ex >= 0 && ey >= 0 && ex < GW && ey < GW && grid[ey * GW + ex] >= 1 && grid[ey * GW + ex] !== CELL_FIN) grid[ey * GW + ex] = CELL_EYE;
      }
    }
    if (f.gulp > 0.25 && f.gulp < 0.75) {
      const mx = Math.floor(cx[0] + tx[0] * hw[0] * 0.9 - gx), my = Math.floor(cy[0] + ty[0] * hw[0] * 0.9 - gy);
      if (mx >= 0 && my >= 0 && mx < GW && my < GW && grid[my * GW + mx]) grid[my * GW + mx] = CELL_EYE;
    }

    // One pixel of ink round the whole fish (fins included).
    for (let j = 0; j < GW; j++) {
      for (let i = 0; i < GW; i++) {
        if (grid[j * GW + i]) continue;
        const up = j > 0 ? grid[(j - 1) * GW + i] : 0, down = j < GW - 1 ? grid[(j + 1) * GW + i] : 0;
        const left = i > 0 ? grid[j * GW + i - 1] : 0, right = i < GW - 1 ? grid[j * GW + i + 1] : 0;
        if ((up && up !== CELL_INK) || (down && down !== CELL_INK) || (left && left !== CELL_INK) || (right && right !== CELL_INK)) {
          grid[j * GW + i] = CELL_INK;
        }
      }
    }
  }

  function drawFish(f, reduced) {
    rasterise(f, reduced);
    const colours = PALETTE[f.pattern][f.depth > DEEP_FROM ? 1 : 0];
    let current = 0;
    for (let j = 0; j < GW; j++) {
      for (let i = 0; i < GW; i++) {
        const v = grid[j * GW + i];
        if (!v) continue;
        if (v !== current) { ctx.fillStyle = colours[v]; current = v; }
        ctx.fillRect(gx + i, gy + j, 1, 1);
      }
    }
  }

  function drawRipples(snapshot) {
    ctx.strokeStyle = RING;
    ctx.lineWidth = 1;
    for (let i = 0; i < snapshot.rippleCount; i++) {
      const r = snapshot.ripples[i];
      const p = r.age / r.duration;
      for (let ring = 0; ring < 2; ring++) {
        const q = p - ring * 0.2;
        if (q <= 0 || q >= 1) continue;
        const grow = 1 - (1 - q) * (1 - q);
        const radius = 1.5 + grow * 15 * r.size;
        ctx.globalAlpha = 0.34 * Math.min(1, q * 8) * Math.pow(1 - q, 1.5);
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, radius, radius * 0.62, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // A pellet is a 3x3 square with a lighter pixel; it bobs by whole pixels.
  function drawFood(snapshot) {
    for (let i = 0; i < snapshot.foodCount; i++) {
      const p = snapshot.food[i];
      if (p.age < 0.1) continue;
      const bob = snapshot.reducedMotion ? 0 : Math.round(Math.sin(p.age * 3 + i) * 0.5 + 0.1);
      const x = Math.round(p.x) - 1, y = Math.round(p.y) + bob - 1;
      ctx.fillStyle = PELLET_EDGE;
      ctx.fillRect(x, y, 3, 3);
      ctx.fillStyle = PELLET;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  return {
    paint(snapshot) {
      const reduced = snapshot.reducedMotion;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Deeper fish first (insertion sort; no allocation).
      const fish = snapshot.fish, n = Math.min(fish.length, order.length);
      for (let i = 0; i < n; i++) {
        let j = i;
        while (j > 0 && fish[order[j - 1]].depth < fish[i].depth) { order[j] = order[j - 1]; j--; }
        order[j] = i;
      }
      for (let i = 0; i < n; i++) { buildBody(fish[order[i]], reduced); drawFish(fish[order[i]], reduced); }
      drawFood(snapshot);
      drawRipples(snapshot);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in';   // only open water shows anything
      ctx.drawImage(clip, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
