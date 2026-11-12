/** Deterministic koi school for the HQ office pool. Pure module: no DOM, no clock and
 * no randomness beyond the seeded generator. Units are map pixels and seconds.
 *
 * Model (a simplified fish-behaviour algorithm, not an ethological simulation):
 *  - geometry: a signed shore-distance field steers fish off the bank with look-ahead, and
 *    geodesic flow fields toward a few anchor points carry them through the canal mouth;
 *  - each fish cruises toward a personal goal anchor with smooth wander, boids-lite
 *    separation/alignment/cohesion with its nearest neighbours, and stroke-and-glide thrust;
 *  - modes: cruise, rest (hover low in deep water), food (notice, compete, gulp),
 *    curious (approach a visitor standing at the edge), disperse (after losing a pellet). */
import { createField, createGeodesic } from './field.mjs';

export const FIXED_DT = 1 / 60;
export const MAX_DT = 0.05;
export const MAX_FISH = 16;
export const TOP_SPEED = 28;
export const SEGMENTS = 7;
export const MAX_FOOD = 12;
export const PATTERNS = Object.freeze(['kohaku', 'sanke', 'gold', 'shiro', 'black']);
export const MODES = Object.freeze(['cruise', 'rest', 'food', 'curious', 'disperse']);
const CRUISE = 0, REST = 1, FOOD = 2, CURIOUS = 3, DISPERSE = 4;
const MAX_RIPPLES = 16;
const FOOD_LIFE = 30;            // s before an uneaten pellet sinks
const SATIETY_LIMIT = 3;         // pellets a fish eats before it loses interest for a while
const REDUCED = 0.35;            // speed factor under prefers-reduced-motion
const THRUST = 15, DRAG = 0.3, BRAKE = 14, WALL_BRAKE = 10, TURN_ACCEL = 3;
const SLIP = 3;                  // px/s sideways give when two bodies touch
const NEAR_VISITOR = 90;         // px from the viewing point at which a visitor counts as at the edge
const NOTICE_VISITOR = 3;        // s a visitor must stay before the koi notice
const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let v = Math.imul(state ^ (state >>> 15), state | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function validate(options) {
  if (!options || typeof options !== 'object') throw new TypeError('createSchool options are required');
  const { swim, open = swim, width, height, count = 10, seed = 1, spawnPoints = [] } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new RangeError('width and height must be integers >= 2');
  }
  if (!swim || swim.length !== width * height) throw new RangeError('swim must have width*height entries');
  if (!open || open.length !== width * height) throw new RangeError('open must have width*height entries');
  if (!Number.isInteger(count) || count < 0 || count > MAX_FISH) {
    throw new RangeError(`count must be an integer from 0 to ${MAX_FISH}`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be a uint32');
  if (!Array.isArray(spawnPoints) || spawnPoints.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    throw new TypeError('spawnPoints must be an array of [x, y] pairs');
  }
  return { swim, open, width, height, count, seed, spawnPoints };
}

/**
 * createSchool({swim, open?, width, height, count, seed, spawnPoints}) -> school.
 * swim/open: array-likes of width*height, nonzero where fish may swim / water is visible.
 * step(dt, inputs) advances in fixed 1/60 s ticks; dt is capped at MAX_DT so a resumed tab
 * never catches up. inputs: {drops?: [[x,y],...], visitor?: {x,y}|null, reducedMotion?}.
 * snapshot() returns one reused, read-only view (valid until the next step).
 */
export function createSchool(options) {
  const { swim, open, width, height, count, seed, spawnPoints } = validate(options);
  const field = createField(swim, width, height);
  const geo = createGeodesic(field, { cell: 8, comfort: 26, minClear: 4 });
  const openAt = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    return ix >= 0 && iy >= 0 && ix < width && iy < height && open[iy * width + ix] > 0;
  };

  // ---- Anchors: farthest-point samples over roomy water, each with a geodesic flow field.
  let waterArea = 0, maxClear = 0, deepest = -1;
  for (let i = 0; i < swim.length; i++) if (swim[i]) waterArea++;
  for (let c = 0; c < geo.count; c++) {
    if (geo.passable[c] && geo.clear[c] > maxClear) { maxClear = geo.clear[c]; deepest = c; }
  }
  const anchorDist = [], anchorFlow = [], anchorX = [], anchorY = [], anchorOpen = [];
  if (deepest >= 0) {
    const wanted = clamp(Math.round(waterArea / 9000), 4, 12);
    const roomy = Math.min(24, maxClear * 0.5);
    const minGeo = new Float32Array(geo.count).fill(Infinity);
    let next = deepest;
    while (next >= 0 && anchorDist.length < wanted) {
      const x = ((next % geo.cols) + 0.5) * geo.cell, y = (Math.floor(next / geo.cols) + 0.5) * geo.cell;
      const dist = new Float32Array(geo.count), flow = new Float32Array(geo.count * 2);
      geo.compute(x, y, dist, flow);
      anchorDist.push(dist); anchorFlow.push(flow); anchorX.push(x); anchorY.push(y);
      anchorOpen.push(openAt(x, y) ? 1 : 0.45);
      let best = -1, bestD = 40;
      for (let c = 0; c < geo.count; c++) {
        if (dist[c] < minGeo[c]) minGeo[c] = dist[c];
        if (geo.clear[c] >= roomy && Number.isFinite(minGeo[c]) && minGeo[c] > bestD) { bestD = minGeo[c]; best = c; }
      }
      next = best;
    }
  }
  const anchors = anchorDist.length;
  const deepWater = Math.max(20, maxClear * 0.45);
  const visitorDist = new Float32Array(geo.count), visitorFlow = new Float32Array(geo.count * 2);

  // ---- State (allocated once; reset() rewinds it).
  const fish = [];
  const food = Array.from({ length: MAX_FOOD }, () => ({ uid: 0, x: 0, y: 0, born: 0, angle: 0, drift: 0 }));
  const ripples = Array.from({ length: MAX_RIPPLES }, () => ({ x: 0, y: 0, born: 0, duration: 0, size: 1 }));
  const visitor = { present: false, x: 0, y: 0, scanX: NaN, scanY: NaN, viewX: 0, viewY: 0, viewDist: Infinity,
    viewCell: -1, fieldCell: -1, nearSince: -1, leftAt: -1, noticed: false, epoch: 0, nextScan: 0, slots: 0 };
  const tmp = new Float64Array(2), tmp2 = new Float64Array(2);
  const counters = { arrivals: 0, timeouts: 0, eaten: 0, expired: 0 };
  const nearIndex = new Int32Array(4), nearDist = new Float64Array(4);
  let rng, time, accumulator, ticks, foodCount, rippleCount, foodUid, nextSip, reduced;

  const view = {
    time: 0, ticks: 0, reducedMotion: false, foodCount: 0, rippleCount: 0,
    fish: [], food: Array.from({ length: MAX_FOOD }, () => ({ x: 0, y: 0, age: 0 })),
    ripples: Array.from({ length: MAX_RIPPLES }, () => ({ x: 0, y: 0, age: 0, duration: 1, size: 1 })),
  };

  function makeFish(id, patternOffset) {
    const pattern = PATTERNS[(id + patternOffset) % PATTERNS.length];
    const roll = rng();
    let length = roll < 0.22 ? 18 + rng() * 5 : roll < 0.75 ? 24 + rng() * 10 : 35 + rng() * 9;
    if (pattern === 'black') length = Math.max(length, 31 + rng() * 11);
    length = Math.min(44, length);
    const boldness = rng();
    const f = {
      id, pattern, variant: Math.floor(rng() * 0xffffffff) >>> 0, length,
      width: length * (0.25 + rng() * 0.05),
      hardClear: 0.3 * length + 2, comfort: 0.4 * length + 8,
      boldness,
      cruise: 6.5 + rng() * 4 + (length - 18) * 0.04,
      top: Math.min(TOP_SPEED, 20 + boldness * 5 + (length - 18) * 0.12),
      sociability: 0.2 + rng() * 0.7,
      curiosity: clamp(0.25 + boldness * 0.6 + (rng() - 0.5) * 0.3, 0.1, 1),
      restiness: 0.12 + rng() * 0.38,
      prefDepth: 0.25 + rng() * 0.45,
      noticeDelay: 0.25 + (1 - boldness) * 1.4 + rng() * 0.4,
      perception: 110 + boldness * 90,
      handed: rng() < 0.5 ? -1 : 1,
      wanderAmp: 0.7 + rng() * 0.45,
      w1: 0.12 + rng() * 0.08, w2: 0.3 + rng() * 0.15, w3: 0.8 + rng() * 0.4,
      p1: rng() * TAU, p2: rng() * TAU, p3: rng() * TAU,
      home: anchors ? Math.floor(rng() * anchors) : -1,
      // dynamic state
      x: 0, y: 0, heading: 0, speed: 0, turn: 0, effort: 0, phase: rng() * TAU, finPhase: rng() * TAU,
      depth: 0.5, chain: new Float64Array(SEGMENTS * 2), segLen: (0.5 * length) / (SEGMENTS - 1),
      mode: CRUISE, modeUntil: 0, goal: -1, bestGoal: Infinity, progressAt: 0, targetHeading: 0,
      floorV: 6, ceilV: 10, yieldV: TOP_SPEED, slipX: 0, slipY: 0, burstEffort: 0.5, glideEffort: 0.05, maxTurn: 1.1, depthTarget: 0.5, approachV: TOP_SPEED,
      stroke: 0, strokeUntil: 0, senseIn: (id % 6) / 60,
      foodUid: -1, foodX: 0, foodY: 0, ateAt: -Infinity, satiety: 0, gulp: 0,
      visitorEpoch: -1, curiousCooldown: 0, leaveAt: -1, slot: 0,
    };
    f.depth = f.prefDepth;
    return f;
  }

  const noise = (f, t) => Math.sin(t * f.w1 + f.p1) * 0.5 + Math.sin(t * f.w2 + f.p2) * 0.3 + Math.sin(t * f.w3 + f.p3) * 0.2;
  const goalDistance = (g, x, y) => geo.flowAt(anchorDist[g], anchorFlow[g], x, y, tmp2);

  function placeFish(f, index, offset) {
    const n = spawnPoints.length;
    const stride = Math.max(1, Math.round(n * 0.618));     // golden-ratio walk spreads fish over the points
    for (let attempt = 0; attempt < 600; attempt++) {
      let x, y;
      if (n && attempt < 300) {
        const p = spawnPoints[(offset + index * stride + attempt) % n];
        x = p[0] + (rng() - 0.5) * 16; y = p[1] + (rng() - 0.5) * 16;
      } else { x = rng() * width; y = rng() * height; }
      if (field.sample(x, y) < Math.min(f.comfort * 0.8 + 2, maxClear * 0.8)) continue;
      if (anchors && !Number.isFinite(goalDistance(0, x, y))) continue;
      let crowded = false;
      for (const g of fish) if (Math.hypot(g.x - x, g.y - y) < 0.4 * (f.length + g.length) + 8) { crowded = true; break; }
      if (crowded && attempt < 500) continue;
      f.x = x; f.y = y;
      return;
    }
    throw new RangeError(`no water with room for fish ${f.id}`);
  }

  function resetChain(f) {
    for (let i = 0; i < SEGMENTS; i++) {
      f.chain[2 * i] = f.x - Math.cos(f.heading) * f.segLen * i;
      f.chain[2 * i + 1] = f.y - Math.sin(f.heading) * f.segLen * i;
    }
  }

  function setMode(f, mode, duration = 0) {
    f.mode = mode;
    f.modeUntil = time + duration;
    f.leaveAt = -1;
  }

  /** Next goal: far anchors are likelier (so fish roam lake and canal), home-region anchors
   * a little likelier, anchors under the deck less; sometimes a neighbour's goal (loose groups). */
  function chooseGoal(f, far = false) {
    if (!anchors) { f.goal = -1; return; }
    if (!far && rng() < f.sociability * 0.5) {
      let best = null, bestD = 100;
      for (const g of fish) {
        if (g === f || g.mode !== CRUISE || g.goal < 0 || g.goal === f.goal) continue;
        const d = Math.hypot(g.x - f.x, g.y - f.y);
        if (d < bestD && goalDistance(g.goal, f.x, f.y) > 80) { bestD = d; best = g; }
      }
      if (best) { f.goal = best.goal; f.bestGoal = Infinity; f.progressAt = time; return; }
    }
    let total = 0;
    for (let j = 0; j < anchors; j++) {
      const d = j === f.goal ? 0 : goalDistance(j, f.x, f.y);
      tmpWeights[j] = Number.isFinite(d) && d > 60
        ? (d / 100) ** (far ? 2 : 1.3) * anchorOpen[j] * (1 + 1.5 * Math.exp(-homeDistance(f, j) / 150)) : 0;
      total += tmpWeights[j];
    }
    if (total <= 0) { f.goal = (f.goal + 1) % anchors; f.bestGoal = Infinity; f.progressAt = time; return; }
    let pick = rng() * total;
    for (let j = 0; j < anchors; j++) {
      pick -= tmpWeights[j];
      if (pick <= 0 && tmpWeights[j] > 0) { f.goal = j; break; }
    }
    f.bestGoal = Infinity;
    f.progressAt = time;
  }
  const tmpWeights = new Float64Array(Math.max(1, anchors));
  const homeDistance = (f, j) => {
    if (f.home < 0) return 0;
    const v = geo.flowAt(anchorDist[f.home], anchorFlow[f.home], anchorX[j], anchorY[j], tmp2);
    return Number.isFinite(v) ? v : 1e4;
  };

  function findPellet(uid) {
    for (let i = 0; i < foodCount; i++) if (food[i].uid === uid) return food[i];
    return null;
  }

  function lineOfSight(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(d / 4);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (field.sample(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) < 1) return false;
    }
    return true;
  }

  function addRipple(x, y, size, duration) {
    if (reduced || rippleCount >= MAX_RIPPLES) return;
    const r = ripples[rippleCount++];
    r.x = x; r.y = y; r.born = time; r.duration = duration; r.size = size;
  }

  /** Drop 1-3 pellets around (x, y) on open water. Returns how many landed. */
  function drop(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !openAt(x, y) || field.sample(x, y) < 5) return 0;
    const wanted = 1 + Math.floor(rng() * 3);
    let landed = 0;
    for (let k = 0; k < wanted && foodCount < MAX_FOOD; k++) {
      const a = rng() * TAU, r = k === 0 ? 0 : 2 + rng() * 4;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (!openAt(px, py) || field.sample(px, py) < 4) continue;
      const p = food[foodCount++];
      p.uid = ++foodUid; p.x = px; p.y = py; p.born = time; p.angle = rng() * TAU; p.drift = 0.4 + rng() * 0.5;
      landed++;
    }
    if (landed) addRipple(x, y, 0.35, 0.7);
    return landed;
  }

  function removePellet(p) {
    const i = food.indexOf(p);
    if (i < 0) return;
    foodCount--;
    food[i] = food[foodCount];
    food[foodCount] = p;
  }

  // ---- Visitor: the nearest roomy open water to a person standing at the edge.
  function scanVisitor() {
    visitor.scanX = visitor.x; visitor.scanY = visitor.y;
    let best = -1, bestD = Infinity;
    if (visitor.x > -250 && visitor.y > -250 && visitor.x < width + 250 && visitor.y < height + 250) {
      for (let c = 0; c < geo.count; c++) {
        if (geo.clear[c] < 22) continue;
        const cx = ((c % geo.cols) + 0.5) * geo.cell, cy = (Math.floor(c / geo.cols) + 0.5) * geo.cell;
        if (!openAt(cx, cy)) continue;
        const d = (cx - visitor.x) ** 2 + (cy - visitor.y) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    visitor.viewCell = best;
    visitor.viewDist = best < 0 ? Infinity : Math.sqrt(bestD);
    if (best >= 0) {
      visitor.viewX = ((best % geo.cols) + 0.5) * geo.cell;
      visitor.viewY = (Math.floor(best / geo.cols) + 0.5) * geo.cell;
    }
  }

  function updateVisitor() {
    if (!visitor.present) {
      if (visitor.noticed && time - visitor.leftAt > 1.5) { visitor.noticed = false; visitor.epoch++; }
      visitor.nearSince = -1;
      return;
    }
    if (time >= visitor.nextScan && Math.hypot(visitor.x - visitor.scanX, visitor.y - visitor.scanY) > 6
      || Number.isNaN(visitor.scanX)) {
      scanVisitor();
      visitor.nextScan = time + 0.1;
    }
    if (visitor.viewDist <= NEAR_VISITOR) {
      if (visitor.nearSince < 0) visitor.nearSince = time;
      visitor.leftAt = -1;
      if (!visitor.noticed && time - visitor.nearSince >= NOTICE_VISITOR) {
        visitor.noticed = true; visitor.epoch++; visitor.slots = 0;
      }
      if (visitor.noticed && visitor.fieldCell !== visitor.viewCell) {
        geo.compute(visitor.viewX, visitor.viewY, visitorDist, visitorFlow);
        visitor.fieldCell = visitor.viewCell;
      }
    } else {
      visitor.nearSince = -1;
      if (visitor.noticed) {
        if (visitor.leftAt < 0) visitor.leftAt = time;
        else if (time - visitor.leftAt > 1.5) { visitor.noticed = false; visitor.epoch++; }
      }
    }
  }

  // ---- Decisions (10 Hz per fish, staggered).
  function rayClear(f, angle, horizon) {
    const c = Math.cos(angle), s = Math.sin(angle);
    let m = Infinity;
    for (let k = 1; k <= 3; k++) {
      const d = field.sample(f.x + c * horizon * k / 3, f.y + s * horizon * k / 3) - f.hardClear;
      if (d < m) m = d;
    }
    return m;
  }

  function choosePellet(f) {
    const mx = f.x + Math.cos(f.heading) * 0.3 * f.length, my = f.y + Math.sin(f.heading) * 0.3 * f.length;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < foodCount; i++) {
      const p = food[i];
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d > f.perception) continue;
      if (time < p.born + f.noticeDelay + d / 140 + (f.mode === REST ? 1.2 : 0)) continue;
      const score = p.uid === f.foodUid ? d * 0.7 : d;
      if (score < bestScore && lineOfSight(f.x, f.y, p.x, p.y)) { best = p; bestScore = score; }
    }
    return best;
  }

  function think(f) {
    const scale = reduced ? REDUCED : 1;
    // Food first: noticing depends on distance and boldness; rivals compete for the same pellet.
    if (f.gulp <= 0) {
      const pellet = f.satiety < SATIETY_LIMIT && foodCount ? choosePellet(f) : null;
      if (pellet) {
        if (f.mode !== FOOD) setMode(f, FOOD);
        f.foodUid = pellet.uid; f.foodX = pellet.x; f.foodY = pellet.y;
      } else if (f.mode === FOOD) {
        if (time - f.ateAt < 2.5) { setMode(f, CRUISE); chooseGoal(f); }
        else { setMode(f, DISPERSE, 1.6 + rng() * 1.6); f.stroke = 0; f.strokeUntil = time; }
        f.foodUid = -1;
      }
    }
    if (visitor.noticed && f.mode !== FOOD && f.mode !== DISPERSE && f.mode !== CURIOUS
      && f.visitorEpoch !== visitor.epoch && time >= f.curiousCooldown) {
      f.visitorEpoch = visitor.epoch;
      const reach = geo.flowAt(visitorDist, visitorFlow, f.x, f.y, tmp2);
      // Only fish within sight of the bank respond, likelier the closer and bolder they are.
      if (Number.isFinite(reach) && rng() < f.curiosity * clamp(1.4 - reach / 280, 0, 1)) {
        setMode(f, CURIOUS, 25 + rng() * 35);
        f.slot = visitor.slots++;
      }
    }
    if (f.mode === CURIOUS) {
      if (!visitor.noticed) {
        if (f.leaveAt < 0) f.leaveAt = time + rng() * 2.5;
        else if (time >= f.leaveAt) { setMode(f, CRUISE); chooseGoal(f, true); }
      } else if (time >= f.modeUntil) {
        setMode(f, CRUISE); chooseGoal(f, true);
        f.curiousCooldown = time + 30 + rng() * 40;
        f.visitorEpoch = -1;
      }
    }
    if ((f.mode === REST || f.mode === DISPERSE) && time >= f.modeUntil) {
      const far = f.mode === DISPERSE;
      setMode(f, CRUISE);
      chooseGoal(f, far);
    }
    if (f.mode === CRUISE && anchors) {
      if (f.goal < 0) chooseGoal(f);
      const remaining = goalDistance(f.goal, f.x, f.y);
      if (remaining < f.bestGoal - 8) { f.bestGoal = remaining; f.progressAt = time; }
      // Rest happens in the deep part of the pond (far from every bank), on arrival or idly.
      const deep = field.sample(f.x, f.y) >= deepWater;
      if (remaining < 26) {
        counters.arrivals++;
        if (deep && rng() < f.restiness) setMode(f, REST, 5 + rng() * 9);
        else chooseGoal(f);
      } else if (time - f.progressAt > 22) { counters.timeouts++; chooseGoal(f); }
      else if (deep && rng() < 0.01 * f.restiness) setMode(f, REST, 4 + rng() * 8);
    }

    // Desired direction per mode.
    let dx, dy, comfort = f.comfort, horizon = 12 + 1.2 * f.speed + 0.45 * f.length, social = 1;
    const wander = noise(f, time);
    if (f.mode === CRUISE) {
      let base = f.heading;
      if (anchors) {
        geo.flowAt(anchorDist[f.goal], anchorFlow[f.goal], f.x, f.y, tmp);
        if (tmp[0] || tmp[1]) base = Math.atan2(tmp[1], tmp[0]);
      }
      base += f.wanderAmp * wander;
      dx = Math.cos(base); dy = Math.sin(base);
      f.floorV = 0.78 * f.cruise; f.ceilV = 1.3 * f.cruise;
      f.burstEffort = 0.42 + 0.18 * f.boldness; f.glideEffort = 0.05; f.maxTurn = 1.1;
      f.depthTarget = clamp(f.prefDepth + 0.12 * Math.sin(time * f.w2 + f.p3), 0.1, 0.85);
      f.approachV = TOP_SPEED;
    } else if (f.mode === REST) {
      const base = f.heading + 0.35 * wander;
      dx = Math.cos(base); dy = Math.sin(base);
      f.floorV = 0.35; f.ceilV = 1.1; f.burstEffort = 0.1; f.glideEffort = 0.02; f.maxTurn = 0.35;
      f.depthTarget = 0.92; f.approachV = 1.4;
    } else if (f.mode === FOOD) {
      const vx = f.foodX - f.x, vy = f.foodY - f.y, d = Math.hypot(vx, vy) || 1;
      dx = vx / d; dy = vy / d;
      const chase = f.top * (0.65 + 0.35 * f.boldness);
      f.floorV = 0.8 * chase; f.ceilV = chase; f.burstEffort = 0.9 + 0.35 * f.boldness; f.glideEffort = 0.2;
      f.maxTurn = 1.8; f.depthTarget = d < 70 ? 0.06 : f.prefDepth * 0.7;
      f.approachV = TOP_SPEED;
      horizon = Math.min(horizon, d);
      if (d < 50) comfort = f.hardClear + 3;
      social = 0.5;
    } else if (f.mode === CURIOUS) {
      // Fan out along the bank: each curious fish takes its own slot beside the viewing point.
      const ax = visitor.x - visitor.viewX, ay = visitor.y - visitor.viewY, al = Math.hypot(ax, ay) || 1;
      const side = (f.slot % 2 ? 1 : -1) * Math.ceil(f.slot / 2) * 16;
      let tx = visitor.viewX - (ay / al) * side, ty = visitor.viewY + (ax / al) * side;
      if (field.sample(tx, ty) < f.comfort) { tx = visitor.viewX; ty = visitor.viewY; }
      const vx = tx - f.x, vy = ty - f.y, d = Math.hypot(vx, vy);
      if (d > 40) {
        geo.flowAt(visitorDist, visitorFlow, f.x, f.y, tmp);
        if (tmp[0] || tmp[1]) { dx = tmp[0]; dy = tmp[1]; } else { dx = vx / d; dy = vy / d; }
        f.floorV = 0.8 * f.cruise; f.ceilV = 1.25 * f.cruise; f.burstEffort = 0.45; f.approachV = TOP_SPEED;
      } else {
        // Hover facing the visitor, drifting toward the slot.
        const lx = visitor.x - f.x, ly = visitor.y - f.y, ll = Math.hypot(lx, ly) || 1;
        dx = lx / ll + (vx / 40) * 0.8; dy = ly / ll + (vy / 40) * 0.8;
        f.floorV = 0.5; f.ceilV = 1.8; f.burstEffort = 0.16; f.approachV = 1.5 + d * 0.15;
        comfort = f.hardClear + 6;
      }
      f.glideEffort = 0.04; f.maxTurn = 0.9; f.depthTarget = d < 60 ? 0.12 : f.prefDepth * 0.8;
    } else {
      const vx = f.x - f.foodX, vy = f.y - f.foodY, d = Math.hypot(vx, vy) || 1;
      const base = Math.atan2(vy / d, vx / d) + 0.6 * wander;
      dx = Math.cos(base); dy = Math.sin(base);
      f.floorV = 0.9 * f.cruise; f.ceilV = 1.7 * f.cruise; f.burstEffort = 0.7; f.glideEffort = 0.05;
      f.maxTurn = 1.5; f.depthTarget = clamp(f.prefDepth + 0.15, 0, 0.9); f.approachV = TOP_SPEED;
    }
    f.floorV *= scale; f.ceilV *= scale; f.approachV *= scale;
    if (reduced) f.maxTurn *= 0.6;

    // Boids-lite: body-aware separation from every fish (closest of head/centre against the
    // other's head/centre/rear), yielding to a fish just ahead, and alignment and cohesion
    // with up to 4 nearest neighbours.
    let near = 0, sepX = 0, sepY = 0;
    f.yieldV = TOP_SPEED; f.slipX = 0; f.slipY = 0;
    const bx = f.chain[4], by = f.chain[5], hc = Math.cos(f.heading), hs = Math.sin(f.heading);
    for (const g of fish) {
      if (g === f) continue;
      let best = Infinity, ox = 0, oy = 0;
      for (let a = 0; a <= 8; a += 4) {
        const px = f.chain[a], py = f.chain[a + 1];
        for (let b = 0; b <= 12; b += 4) {
          const qx = px - g.chain[b], qy = py - g.chain[b + 1], d = qx * qx + qy * qy;
          if (d < best) { best = d; ox = qx; oy = qy; }
        }
      }
      let d = Math.sqrt(best);
      const spacing = 0.5 * (f.width + g.width) + 8 + 0.12 * (f.length + g.length);
      if (d < spacing) {
        if (d < 0.01) { const a = (f.id - g.id) * 2.39996; ox = Math.cos(a); oy = Math.sin(a); d = 1; }
        const w = 1 - d / spacing;
        sepX += (ox / d) * w * (1 + w); sepY += (oy / d) * w * (1 + w);
        // Bodies actually touching: a gentle sideways slip, like koi bumping past each other.
        const contact = 0.5 * (f.width + g.width);
        if (d < contact) { f.slipX += (ox / d) * (1 - d / contact); f.slipY += (oy / d) * (1 - d / contact); }
        // Following a fish just ahead in my lane: ease off instead of swimming into it.
        const along = Math.cos(g.heading) * hc + Math.sin(g.heading) * hs;
        const qx = g.chain[4] - bx, qy = g.chain[5] - by, proj = qx * hc + qy * hs;
        if (f.mode !== FOOD && along > 0.3 && proj > 0 && Math.abs(qy * hc - qx * hs) < contact + 4) {
          f.yieldV = Math.min(f.yieldV, Math.max(1.2, g.speed * (0.25 + 0.6 * d / spacing)));
        }
      }
      // Paths about to cross within 3 s: steer away from where the other fish will be.
      const rvx = hc * f.speed - Math.cos(g.heading) * g.speed, rvy = hs * f.speed - Math.sin(g.heading) * g.speed;
      const rv2 = rvx * rvx + rvy * rvy, px = bx - g.chain[4], py = by - g.chain[5];
      if (rv2 > 0.25 && px * px + py * py < 3600) {
        const tca = -(px * rvx + py * rvy) / rv2;
        if (tca > 0 && tca < 3) {
          const qx = px + rvx * tca, qy = py + rvy * tca, qd = Math.hypot(qx, qy);
          if (qd < spacing) {
            const w = 1.4 * (1 - qd / spacing) * (1 - tca / 3);
            if (qd > 0.5) { sepX += (qx / qd) * w; sepY += (qy / qd) * w; } else { sepX += -hs * w; sepY += hc * w; }
          }
        }
      }
      // Oncoming fish ahead: both keep to their right, so they pass instead of jamming.
      const gx = g.chain[0] - f.x, gy = g.chain[1] - f.y, gd = Math.hypot(gx, gy);
      if (gd < 2.2 * spacing && gx * hc + gy * hs > 0.5 * gd
        && Math.cos(g.heading) * hc + Math.sin(g.heading) * hs < -0.3) {
        const w = 1.6 * (1 - gd / (2.2 * spacing));
        sepX += -hs * w; sepY += hc * w;
      }
      const cd = Math.hypot(bx - g.chain[4], by - g.chain[5]);
      if (cd < 90) {
        let k;
        if (near < 4) k = near++;
        else if (cd < nearDist[3]) k = 3;
        else continue;
        while (k > 0 && nearDist[k - 1] > cd) { nearDist[k] = nearDist[k - 1]; nearIndex[k] = nearIndex[k - 1]; k--; }
        nearDist[k] = cd; nearIndex[k] = g.id;
      }
    }
    dx += sepX * 3.5 * social; dy += sepY * 3.5 * social;
    if (near && (f.mode === CRUISE || f.mode === DISPERSE)) {
      let ax = 0, ay = 0, cx = 0, cy = 0;
      for (let k = 0; k < near; k++) {
        const g = fish[nearIndex[k]];
        ax += Math.cos(g.heading); ay += Math.sin(g.heading); cx += g.chain[4]; cy += g.chain[5];
      }
      const al = Math.hypot(ax, ay);
      if (al > 0) { dx += (ax / al) * 0.35 * f.sociability; dy += (ay / al) * 0.35 * f.sociability; }
      cx = cx / near - bx; cy = cy / near - by;
      const cl = Math.hypot(cx, cy);
      if (cl > 28) { dx += (cx / cl) * 0.45 * f.sociability; dy += (cy / cl) * 0.45 * f.sociability; }
    }

    // Shore: push off the bank here and at a look-ahead point, then check the ray ahead.
    const here = field.sample(f.x, f.y);
    if (here < comfort) {
      field.gradient(f.x, f.y, tmp);
      const w = (2.2 * (comfort - here)) / comfort;
      dx += tmp[0] * w; dy += tmp[1] * w;
    }
    const look = 10 + 1.1 * f.speed + 0.35 * f.length;
    const ax = f.x + Math.cos(f.heading) * look, ay = f.y + Math.sin(f.heading) * look;
    const ahead = field.sample(ax, ay);
    if (ahead < comfort) {
      field.gradient(ax, ay, tmp);
      const w = (1.6 * (comfort - ahead)) / comfort;
      dx += tmp[0] * w; dy += tmp[1] * w;
    }
    let target = Math.atan2(dy, dx);
    const need = clamp(comfort - f.hardClear, 2, 10);
    if (rayClear(f, target, horizon) < need) {
      let best = target, bestScore = -Infinity;
      for (let k = 1; k <= 16; k++) {
        const offset = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
        const angle = target + offset;
        const score = Math.cos(offset) + 2 * Math.min(1, rayClear(f, angle, horizon) / need)
          + 0.35 * Math.cos(wrap(angle - f.heading)) + 0.1 * f.handed * Math.sin(wrap(angle - f.heading))
          + (Math.abs(wrap(angle - f.targetHeading)) < 0.4 ? 0.2 : 0);
        if (score > bestScore) { bestScore = score; best = angle; }
      }
      target = best;
    }
    f.targetHeading = wrap(target);
  }

  // ---- Motion (every tick).
  function integrate(f, dt) {
    const scale = reduced ? REDUCED : 1;
    let pellet = null, mouthDist = Infinity;
    if (f.mode === FOOD && f.foodUid >= 0) {
      pellet = findPellet(f.foodUid);
      if (pellet) {
        const mx = f.x + Math.cos(f.heading) * 0.3 * f.length, my = f.y + Math.sin(f.heading) * 0.3 * f.length;
        mouthDist = Math.hypot(pellet.x - mx, pellet.y - my);
        f.foodX = pellet.x; f.foodY = pellet.y;
        // Final approach: aim the mouth straight at the pellet and slow down to take it.
        if (mouthDist < 30) f.targetHeading = Math.atan2(pellet.y - f.y, pellet.x - f.x);
      }
    }
    const err = wrap(f.targetHeading - f.heading);
    f.turn = approach(f.turn, clamp(err * 2, -f.maxTurn, f.maxTurn), TURN_ACCEL * dt);
    f.heading = wrap(f.heading + f.turn * dt);

    // Speed limits: mode approach, food approach, gulp, and braking before the bank.
    let cap = Math.min(f.top * scale, f.approachV, f.yieldV * scale);
    if (pellet) cap = Math.min(cap, (2 + 0.45 * mouthDist) * scale);
    if (f.gulp > 0) cap = Math.min(cap, 2.5 * scale);
    const stop = (f.speed * f.speed) / (2 * WALL_BRAKE) + 3;
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const room = Math.min(field.sample(f.x + c * stop * 0.5, f.y + s * stop * 0.5),
      field.sample(f.x + c * stop, f.y + s * stop)) - f.hardClear;
    cap = Math.min(cap, Math.sqrt(2 * WALL_BRAKE * Math.max(0, room)));

    // Stroke and glide: a burst of tail beats, then a glide until the speed sags.
    const floor = Math.min(f.floorV, 0.8 * cap), ceil = Math.min(f.ceilV, cap);
    if (f.stroke === 0) {
      if (f.speed < floor && time >= f.strokeUntil) { f.stroke = 1; f.strokeUntil = time + 0.6 + rng() * 0.7; }
    } else if (f.speed >= ceil || time >= f.strokeUntil) {
      f.stroke = 0; f.strokeUntil = time + 0.4 + rng() * 0.5;
    }
    const wantEffort = f.stroke ? f.burstEffort : f.glideEffort;
    f.effort = approach(f.effort, wantEffort, (wantEffort > f.effort ? 2.4 : 1.6) * dt);
    f.phase = (f.phase + TAU * (0.45 + 2.6 * Math.min(1, f.effort)) * scale * dt) % TAU;
    f.finPhase = (f.finPhase + TAU * (0.5 + 0.9 * (1 - f.effort)) * scale * dt) % TAU;
    const beat = Math.sin(f.phase);
    const thrust = THRUST * scale * f.effort * (0.3 + 0.7 * beat * beat);
    f.speed += (thrust - (DRAG + 0.25 * Math.abs(f.turn)) * f.speed) * dt;
    if (f.speed > cap) f.speed = Math.max(cap, f.speed - BRAKE * dt);
    if (f.speed < 0) f.speed = 0;

    // Move; never into water shallower than the body needs (slide along the bank instead).
    let mx = c * f.speed * dt, my = s * f.speed * dt;
    const slip = Math.hypot(f.slipX, f.slipY);
    if (slip > 0) { const k = (SLIP * scale * Math.min(1, slip) * dt) / slip; mx += f.slipX * k; my += f.slipY * k; }
    const current = field.sample(f.x, f.y);
    let next = field.sample(f.x + mx, f.y + my);
    if (next < f.hardClear && next < current) {
      field.gradient(f.x + mx, f.y + my, tmp);
      const gl = Math.hypot(tmp[0], tmp[1]) || 1;
      const gx = tmp[0] / gl, gy = tmp[1] / gl, into = mx * gx + my * gy;
      if (into < 0) { mx -= into * gx; my -= into * gy; }
      next = field.sample(f.x + mx, f.y + my);
      if (next < f.hardClear && next < current) { mx = 0; my = 0; f.speed *= 0.5; }
      else f.speed = Math.max(0, f.speed - BRAKE * dt);
    }
    f.x += mx; f.y += my;

    // Spine: each joint follows the one ahead at a fixed distance.
    const ch = f.chain;
    ch[0] = f.x; ch[1] = f.y;
    for (let i = 1; i < SEGMENTS; i++) {
      const ox = ch[2 * i] - ch[2 * i - 2], oy = ch[2 * i + 1] - ch[2 * i - 1];
      const d = Math.hypot(ox, oy);
      if (d > 1e-6) { ch[2 * i] = ch[2 * i - 2] + (ox / d) * f.segLen; ch[2 * i + 1] = ch[2 * i - 1] + (oy / d) * f.segLen; }
    }

    f.depth = approach(f.depth, f.depthTarget, 0.3 * dt);
    if (f.gulp > 0) f.gulp = Math.max(0, f.gulp - dt / 0.55);
    if (f.satiety > 0) f.satiety = Math.max(0, f.satiety - dt / 35);
    if (pellet && f.gulp <= 0 && mouthDist < 2.5 + 0.1 * f.length) {
      f.gulp = 1; f.satiety += 1; f.ateAt = time; f.foodUid = -1; counters.eaten++;
      addRipple(pellet.x, pellet.y, 1, 2.6);
      removePellet(pellet);
    }
  }

  function updateFood(dt) {
    const scale = reduced ? REDUCED : 1;
    for (let i = foodCount - 1; i >= 0; i--) {
      const p = food[i];
      if (time - p.born > FOOD_LIFE) { counters.expired++; removePellet(p); continue; }
      p.angle += Math.sin(time * 0.7 + p.uid * 1.7) * 0.6 * dt;
      let vx = Math.cos(p.angle) * p.drift * scale, vy = Math.sin(p.angle) * p.drift * scale;
      if (field.sample(p.x, p.y) < 10) { field.gradient(p.x, p.y, tmp); vx += tmp[0] * 0.8 * scale; vy += tmp[1] * 0.8 * scale; }
      const nx = p.x + vx * dt, ny = p.y + vy * dt;
      if (openAt(nx, ny) && field.sample(nx, ny) >= 4) { p.x = nx; p.y = ny; } else p.angle += Math.PI * 0.5;
    }
  }

  function tick(dt) {
    time += dt;
    ticks++;
    updateFood(dt);
    for (let i = rippleCount - 1; i >= 0; i--) {
      const r = ripples[i];
      if (time - r.born >= r.duration) { rippleCount--; ripples[i] = ripples[rippleCount]; ripples[rippleCount] = r; }
    }
    updateVisitor();
    for (const f of fish) {
      f.senseIn -= dt;
      if (f.senseIn <= 0) { think(f); f.senseIn += 0.1; }
    }
    for (const f of fish) integrate(f, dt);
    // Now and then a cruising fish sips something off the surface: one subtle ring.
    if (time >= nextSip) {
      nextSip = time + 10 + rng() * 12;
      const start = Math.floor(rng() * Math.max(1, fish.length));
      for (let k = 0; k < fish.length; k++) {
        const f = fish[(start + k) % fish.length];
        const mx = f.x + Math.cos(f.heading) * 0.3 * f.length, my = f.y + Math.sin(f.heading) * 0.3 * f.length;
        if ((f.mode === CRUISE || f.mode === CURIOUS) && f.gulp <= 0 && openAt(mx, my) && field.sample(mx, my) > 6) {
          f.gulp = 0.8;
          addRipple(mx, my, 0.7, 2.2);
          break;
        }
      }
    }
  }

  function reset() {
    rng = randomSource(seed);
    counters.arrivals = counters.timeouts = counters.eaten = counters.expired = 0;
    time = 0; accumulator = 0; ticks = 0; foodCount = 0; rippleCount = 0; foodUid = 0; reduced = false;
    nextSip = 8 + rng() * 8;
    Object.assign(visitor, { present: false, scanX: NaN, scanY: NaN, viewDist: Infinity, viewCell: -1, fieldCell: -1,
      nearSince: -1, leftAt: -1, noticed: false, epoch: 0, nextScan: 0, slots: 0 });
    fish.length = 0;
    const patternOffset = Math.floor(rng() * PATTERNS.length);
    const spawnOffset = Math.floor(rng() * Math.max(1, spawnPoints.length));
    for (let id = 0; id < count; id++) {
      const f = makeFish(id, patternOffset);
      placeFish(f, id, spawnOffset);
      fish.push(f);
    }
    for (const f of fish) {
      chooseGoal(f, true);
      let heading = rng() * TAU;
      if (f.goal >= 0) {
        geo.flowAt(anchorDist[f.goal], anchorFlow[f.goal], f.x, f.y, tmp);
        if (tmp[0] || tmp[1]) heading = Math.atan2(tmp[1], tmp[0]);
      }
      // Keep the tail in the water at spawn.
      for (let k = 0; k < 8; k++) {
        const tail = 0.5 * f.length;
        if (field.sample(f.x - Math.cos(heading) * tail, f.y - Math.sin(heading) * tail) > 1) break;
        heading += Math.PI / 4;
      }
      f.heading = f.targetHeading = heading;
      f.speed = f.cruise * (0.6 + 0.3 * rng());
      resetChain(f);
    }
    view.fish = fish.map((f) => ({
      id: f.id, pattern: f.pattern, variant: f.variant, length: f.length, width: f.width,
      x: 0, y: 0, heading: 0, speed: 0, turn: 0, effort: 0, phase: 0, finPhase: 0, depth: 0, gulp: 0,
      mode: 'cruise', spine: new Float32Array(SEGMENTS * 2),
    }));
  }

  function applyInputs(inputs) {
    if (!inputs) return;
    reduced = !!inputs.reducedMotion;
    if ('visitor' in inputs) {
      const v = inputs.visitor;
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
        visitor.present = true; visitor.x = v.x; visitor.y = v.y;
      } else if (visitor.present) {
        visitor.present = false; visitor.leftAt = time;
      }
    }
    if (inputs.drops) for (const d of inputs.drops) drop(d[0], d[1]);
  }

  reset();

  return {
    width, height, field, geo,
    get anchors() { return anchors; },
    get time() { return time; },
    get ticks() { return ticks; },
    get fishCount() { return fish.length; },
    /** Advance by dt seconds (capped at MAX_DT) in fixed ticks; returns the ticks run. */
    step(dtSeconds, inputs) {
      if (typeof dtSeconds !== 'number' || !Number.isFinite(dtSeconds) || dtSeconds < 0) {
        throw new RangeError('dt must be a finite, nonnegative number of seconds');
      }
      applyInputs(inputs);
      accumulator += Math.min(dtSeconds, MAX_DT);
      let run = 0;
      while (accumulator >= FIXED_DT - 1e-9) { tick(FIXED_DT); accumulator -= FIXED_DT; run++; }
      return run;
    },
    drop,
    reset,
    snapshot() {
      view.time = time; view.ticks = ticks; view.reducedMotion = reduced;
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i], o = view.fish[i];
        o.x = f.x; o.y = f.y; o.heading = f.heading; o.speed = f.speed; o.turn = f.turn; o.effort = f.effort;
        o.phase = f.phase; o.finPhase = f.finPhase; o.depth = f.depth; o.gulp = f.gulp; o.mode = MODES[f.mode];
        o.spine.set(f.chain);
      }
      view.foodCount = foodCount;
      for (let i = 0; i < foodCount; i++) {
        const o = view.food[i];
        o.x = food[i].x; o.y = food[i].y; o.age = time - food[i].born;
      }
      view.rippleCount = rippleCount;
      for (let i = 0; i < rippleCount; i++) {
        const o = view.ripples[i], r = ripples[i];
        o.x = r.x; o.y = r.y; o.age = time - r.born; o.duration = r.duration; o.size = r.size;
      }
      return view;
    },
    /** Debug/QA view of internal state (allocates; not for the frame loop). */
    debug() {
      return {
        anchors: anchorX.map((x, i) => [x, anchorY[i]]),
        counters: { ...counters },
        visitor: { present: visitor.present, noticed: visitor.noticed, viewX: visitor.viewX, viewY: visitor.viewY, viewDist: visitor.viewDist },
        fish: fish.map((f) => ({ id: f.id, mode: MODES[f.mode], goal: f.goal, home: f.home, x: f.x, y: f.y, speed: f.speed,
          satiety: f.satiety, boldness: f.boldness, cruise: f.cruise, top: f.top })),
      };
    },
  };
}
