/** Koi painter: canvas 2D at native resolution (1 canvas px = 1 map px). Bodies are smooth
 * anti-aliased paths along the simulated spine, with a travelling wave whose amplitude rises
 * with thrust; patterns are clipped to the body so they bend with it. Every frame starts
 * from a cleared canvas and ends clipped to the open-water mask, so fish under the deck
 * stay hidden. No allocation per frame: geometry lives in preallocated typed arrays and
 * every colour is a constant string. */

const TAU = Math.PI * 2;
const ST = 12;                                   // stations along the body, snout to tail root
const SUN_X = 0.55, SUN_Y = 0.83;                // light from the top-left: shadows fall down-right

// A touch muted so they sit in pixel art.
const IVORY = '#ded4bd', RED = '#b04a33', SUMI = '#2b3134', GOLD = '#c79a4e', GOLD_DEEP = '#9f7a3e';
const BLACK = '#262b2f', SHEEN = '#4a545c';
const BASE = { kohaku: IVORY, sanke: IVORY, gold: GOLD, shiro: IVORY, black: BLACK };
const FIN = { kohaku: '#e6ddc9', sanke: '#e6ddc9', gold: '#d6b46e', shiro: '#d8d1c1', black: '#3b4247' };
const HIGHLIGHT = { kohaku: 0.1, sanke: 0.1, gold: 0.24, shiro: 0.1, black: 0.08 };
const BLOB_COLORS = [RED, SUMI, GOLD_DEEP, SHEEN];
const OUTLINE = '#123e47', VEIL = '#1c5a63', SHADOW = '#03141a', EYE = '#15191b', RING = '#e2f4f1';
const PELLET = '#c48a4b', PELLET_EDGE = '#3a2615';

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

  function bodyPath(ox, oy) {
    ctx.beginPath();
    ctx.moveTo(rx[0] + ox, ry[0] + oy);
    ctx.quadraticCurveTo(tipX + ox, tipY + oy, lx[0] + ox, ly[0] + oy);
    for (let k = 1; k < ST - 1; k++) {
      ctx.quadraticCurveTo(lx[k] + ox, ly[k] + oy, (lx[k] + lx[k + 1]) / 2 + ox, (ly[k] + ly[k + 1]) / 2 + oy);
    }
    ctx.lineTo(lx[ST - 1] + ox, ly[ST - 1] + oy);
    ctx.lineTo(rx[ST - 1] + ox, ry[ST - 1] + oy);
    for (let k = ST - 2; k > 0; k--) {
      ctx.quadraticCurveTo(rx[k] + ox, ry[k] + oy, (rx[k] + rx[k - 1]) / 2 + ox, (ry[k] + ry[k - 1]) / 2 + oy);
    }
    ctx.lineTo(rx[0] + ox, ry[0] + oy);
    ctx.closePath();
  }

  // Interpolated station at body parameter u: writes into at[0..4] = x, y, tx, ty, half width.
  const at = new Float64Array(5);
  function station(u) {
    const p = Math.min(ST - 1.0001, Math.max(0, u * (ST - 1))), k = Math.floor(p), t = p - k;
    at[0] = cx[k] + (cx[k + 1] - cx[k]) * t; at[1] = cy[k] + (cy[k + 1] - cy[k]) * t;
    at[2] = tx[k] + (tx[k + 1] - tx[k]) * t; at[3] = ty[k] + (ty[k + 1] - ty[k]) * t;
    at[4] = hw[k] + (hw[k + 1] - hw[k]) * t;
  }

  function fin(u, side, angle, length, breadth) {
    station(u);
    const bx = -at[2], by = -at[3];                       // backward
    const nx = -at[3] * side, ny = at[2] * side;          // outward on this side
    const dx = bx * Math.cos(angle) + nx * Math.sin(angle), dy = by * Math.cos(angle) + ny * Math.sin(angle);
    const ox = at[0] + nx * at[4] * 0.8 + dx * length * 0.75, oy = at[1] + ny * at[4] * 0.8 + dy * length * 0.75;
    ctx.beginPath();
    ctx.ellipse(ox, oy, length, breadth, Math.atan2(dy, dx), 0, TAU);
    ctx.fill();
  }

  function drawFish(f, reduced) {
    const L = f.length;
    const finWave = Math.sin(f.finPhase);
    ctx.fillStyle = FIN[f.pattern];
    // Caudal fin: two lobes swinging with the last part of the wave.
    const e = ST - 1;
    const swing = 0.45 * Math.sin(f.phase - 6.1) * (0.25 + 0.75 * Math.min(1, f.effort)) * (reduced ? 0.5 : 1);
    const back = Math.atan2(-ty[e], -tx[e]) + swing;
    const fx = Math.cos(back), fy = Math.sin(back), sx = -fy, sy = fx;
    const fl = 0.24 * L, fs = 0.13 * L * (1 - 0.2 * Math.abs(Math.sin(f.phase))), bw = hw[e] * 1.1;
    ctx.globalAlpha = 0.62;
    ctx.beginPath();
    ctx.moveTo(cx[e] + sx * bw, cy[e] + sy * bw);
    ctx.quadraticCurveTo(cx[e] + fx * fl * 0.45 + sx * fs * 1.1, cy[e] + fy * fl * 0.45 + sy * fs * 1.1,
      cx[e] + fx * fl + sx * fs, cy[e] + fy * fl + sy * fs);
    ctx.lineTo(cx[e] + fx * fl * 0.55, cy[e] + fy * fl * 0.55);
    ctx.lineTo(cx[e] + fx * fl - sx * fs, cy[e] + fy * fl - sy * fs);
    ctx.quadraticCurveTo(cx[e] + fx * fl * 0.45 - sx * fs * 1.1, cy[e] + fy * fl * 0.45 - sy * fs * 1.1,
      cx[e] - sx * bw, cy[e] - sy * bw);
    ctx.closePath();
    ctx.fill();
    // Pectoral and pelvic fins fan out and flex.
    ctx.globalAlpha = 0.55;
    const flap = reduced ? 0.12 : 0.28;
    fin(0.26, 1, 0.95 + flap * finWave, 0.1 * L, 0.045 * L);
    fin(0.26, -1, 0.95 - flap * finWave, 0.1 * L, 0.045 * L);
    fin(0.6, 1, 0.75 + flap * 0.5 * finWave, 0.055 * L, 0.025 * L);
    fin(0.6, -1, 0.75 - flap * 0.5 * finWave, 0.055 * L, 0.025 * L);

    // Body, then patterns and a dorsal highlight clipped to it.
    ctx.globalAlpha = 1;
    ctx.fillStyle = BASE[f.pattern];
    bodyPath(0, 0);
    ctx.fill();
    let layout = layouts.get(f.id);
    if (!layout || layout.variant !== f.variant) {
      layout = { variant: f.variant, blobs: makeLayout(f.pattern, f.variant) };
      layouts.set(f.id, layout);
    }
    ctx.save();
    ctx.clip();
    const blobs = layout.blobs;
    for (let i = 0; i < blobs.length; i += 5) {
      station(blobs[i]);
      ctx.fillStyle = BLOB_COLORS[blobs[i + 4]];
      ctx.beginPath();
      ctx.ellipse(at[0] - at[3] * blobs[i + 1] * at[4], at[1] + at[2] * blobs[i + 1] * at[4],
        blobs[i + 2] * L, Math.max(0.6, blobs[i + 3] * at[4]), Math.atan2(at[3], at[2]), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = HIGHLIGHT[f.pattern];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.8, f.width * 0.32);
    ctx.lineCap = 'round';
    ctx.beginPath();
    station(0.1); ctx.moveTo(at[0], at[1]);
    for (let u = 0.2; u <= 0.71; u += 0.1) { station(u); ctx.lineTo(at[0], at[1]); }
    ctx.stroke();
    ctx.globalAlpha = 0.22;                              // dorsal fin seen from above: a dark ridge
    ctx.strokeStyle = SUMI;
    ctx.lineWidth = Math.max(0.7, f.width * 0.1);
    ctx.beginPath();
    station(0.32); ctx.moveTo(at[0], at[1]);
    for (let u = 0.42; u <= 0.73; u += 0.1) { station(u); ctx.lineTo(at[0], at[1]); }
    ctx.stroke();
    ctx.restore();

    // Thin dark outline (deep-water blue, the map's outline rule), eyes, then the water veil.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.8;
    bodyPath(0, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = EYE;
    station(0.11);
    const eyeR = 0.45 + L * 0.012;
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      ctx.arc(at[0] - at[3] * at[4] * 0.62 * side, at[1] + at[2] * at[4] * 0.62 * side, eyeR, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 0.06 + Math.min(1, Math.max(0, f.depth)) * 0.36;
    ctx.fillStyle = VEIL;
    bodyPath(0, 0);
    ctx.fill();
    if (f.gulp > 0) {                                    // the mouth opens as it takes the pellet
      ctx.globalAlpha = 0.75 * Math.sin(Math.PI * Math.min(1, f.gulp));
      ctx.fillStyle = EYE;
      ctx.beginPath();
      ctx.ellipse(cx[0] + tx[0] * hw[0] * 0.55, cy[0] + ty[0] * hw[0] * 0.55, hw[0] * 0.45, hw[0] * 0.3,
        Math.atan2(ty[0], tx[0]) + Math.PI / 2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShadow(f) {
    // Soft shadow on the pond floor: nearer the floor (deeper) means closer and darker.
    const depth = Math.min(1, Math.max(0, f.depth));
    const off = 1.2 + 3.6 * (1 - depth);
    const alpha = 0.14 + 0.12 * depth;
    ctx.fillStyle = SHADOW;
    ctx.globalAlpha = alpha * 0.55;
    bodyPath(SUN_X * (off + 0.9), SUN_Y * (off + 0.9));
    ctx.fill();
    ctx.globalAlpha = alpha;
    bodyPath(SUN_X * off, SUN_Y * off);
    ctx.fill();
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

  function drawFood(snapshot) {
    for (let i = 0; i < snapshot.foodCount; i++) {
      const p = snapshot.food[i];
      const bob = snapshot.reducedMotion ? 0 : Math.sin(p.age * 3 + i) * 0.3;
      ctx.globalAlpha = Math.min(1, p.age * 6);
      ctx.fillStyle = PELLET_EDGE;
      ctx.beginPath(); ctx.arc(p.x, p.y + bob, 1.9, 0, TAU); ctx.fill();
      ctx.fillStyle = PELLET;
      ctx.beginPath(); ctx.arc(p.x - 0.2, p.y + bob - 0.2, 1.25, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
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
      for (let i = 0; i < n; i++) { buildBody(fish[order[i]], reduced); drawShadow(fish[order[i]]); }
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
