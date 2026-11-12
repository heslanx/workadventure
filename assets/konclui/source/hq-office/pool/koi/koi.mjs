/** Koi overlay for the HQ office pool. Loads scene.json, swim.png and open.png from
 * `base`, runs the deterministic school at a fixed step and paints it at native resolution.
 *
 * In WorkAdventure the map script opens index.html as a WA.room.website over the pond
 * (origin 'map', scale 1, allowApi). With the API, koi drift toward a visitor standing at
 * the edge and the native action message offers SPACE to feed. Without it (standalone
 * preview) everything else works the same. */
import { createSchool, MAX_DT } from './simulation.mjs';
import { createPainter } from './draw.mjs';

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`could not load ${src}`));
  image.src = src;
});

/** Alpha > 127 as 0/1 bits, plus a crisp canvas of the same mask for clipping. */
function readMask(image, width, height, doc) {
  if (image.naturalWidth !== width || image.naturalHeight !== height) {
    throw new RangeError(`${image.src} is ${image.naturalWidth}x${image.naturalHeight}, scene is ${width}x${height}`);
  }
  const canvas = doc.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  const bits = new Uint8Array(width * height);
  for (let i = 0; i < bits.length; i++) {
    const on = pixels.data[i * 4 + 3] > 127;
    bits[i] = on ? 1 : 0;
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
    pixels.data[i * 4 + 3] = on ? 255 : 0;
  }
  context.putImageData(pixels, 0, 0);
  return { bits, canvas };
}

export async function startKoi({ canvas, base = './', useWA = true } = {}) {
  const root = new URL(base, location.href);
  const url = (name) => new URL(name, root).href;
  const response = await fetch(url('scene.json'), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`scene.json: HTTP ${response.status}`);
  const scene = await response.json();
  const { width, height } = scene;
  const [swimImage, openImage] = await Promise.all([loadImage(url('swim.png')), loadImage(url('open.png'))]);
  const swim = readMask(swimImage, width, height, document);
  const open = readMask(openImage, width, height, document);
  const school = createSchool({
    swim: swim.bits, open: open.bits, width, height,
    count: scene.count ?? 10, seed: scene.seed ?? 1, spawnPoints: scene.spawnPoints ?? [],
  });
  canvas.width = width;
  canvas.height = height;
  const painter = createPainter({ canvas, clip: open.canvas });
  const openAt = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    return ix >= 0 && iy >= 0 && ix < width && iy < height && open.bits[iy * width + ix] === 1;
  };

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const inputs = { drops: [], visitor: null, reducedMotion: reducedQuery.matches };
  const visitorPoint = { x: 0, y: 0 };
  let onScreen = true, userPaused = false, failure = null, lastTicks = -1;
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }).observe(canvas);
  let last = performance.now();
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  const costs = new Float32Array(120);
  let costIndex = 0, costCount = 0, frames = 0, fpsSince = performance.now(), fps = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    // Never catch up: time spent hidden, off screen or paused is simply skipped.
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
    last = now;
    if (userPaused || !onScreen || document.hidden) return;
    try {
      inputs.reducedMotion = reducedQuery.matches;
      school.step(dt, inputs);
      inputs.drops.length = 0;
      if (school.ticks === lastTicks) return;
      lastTicks = school.ticks;
      const start = performance.now();
      painter.paint(school.snapshot());
      costs[costIndex] = performance.now() - start;
      costIndex = (costIndex + 1) % costs.length;
      costCount = Math.min(costs.length, costCount + 1);
      frames++;
      if (now - fpsSince >= 1000) { fps = (frames * 1000) / (now - fpsSince); frames = 0; fpsSince = now; }
    } catch (error) {
      if (!failure) console.error('koi frame', error);
      failure = String((error && error.stack) || error);
    }
  }
  requestAnimationFrame(frame);

  // Food lands only on open water; one rule for pointer and keyboard.
  function drop(x, y) {
    if (!openAt(x, y)) return false;
    inputs.drops.push([x, y]);
    return true;
  }
  const toScene = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [((event.clientX - rect.left) * width) / rect.width, ((event.clientY - rect.top) * height) / rect.height];
  };
  canvas.addEventListener('pointerdown', (event) => drop(...toScene(event)));
  canvas.addEventListener('pointermove', (event) => {
    canvas.style.cursor = openAt(...toScene(event)) ? 'pointer' : 'default';
  });

  // Open-water points away from the bank, for the keyboard action and the preview button.
  const waterPoints = [];
  for (let y = 2; y < height; y += 4) {
    for (let x = 2; x < width; x += 4) {
      if (openAt(x, y) && school.field.sample(x, y) >= 10) waterPoints.push(x, y);
    }
  }
  function nearestWater(px, py) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < waterPoints.length; i += 2) {
      const d = (waterPoints[i] - px) ** 2 + (waterPoints[i + 1] - py) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best < 0 ? null : [waterPoints[best], waterPoints[best + 1], Math.sqrt(bestD)];
  }
  /** Feed a little way out from a point (the keyboard action) or anywhere (preview button). */
  function feed(px, py) {
    let target = px === undefined ? null : nearestWater(px, py);
    if (!target) {
      if (!waterPoints.length) return false;
      const i = 2 * Math.floor((Math.random() * waterPoints.length) / 2);
      target = [waterPoints[i], waterPoints[i + 1]];
    }
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 24;
      const x = target[0] + Math.cos(a) * r, y = target[1] + Math.sin(a) * r;
      if (openAt(x, y) && school.field.sample(x, y) >= 8) return drop(x, y);
    }
    return drop(target[0], target[1]);
  }

  function setVisitor(point) {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      visitorPoint.x = point.x; visitorPoint.y = point.y;
      inputs.visitor = visitorPoint;
    } else inputs.visitor = null;
  }

  // WorkAdventure: the player's map position (minus the overlay origin) drives curiosity,
  // and near the pond the native action message offers SPACE to feed.
  const origin = Array.isArray(scene.origin) ? scene.origin : null;
  const nearPx = scene.nearWaterPx ?? 48;
  let hint = null, hintNear = false;
  function refreshHint() {
    if (!origin || !inputs.visitor) { if (hint) { hint.remove(); hint = null; } return; }
    const water = nearestWater(visitorPoint.x, visitorPoint.y);
    const near = !!water && water[2] <= nearPx;
    if (near && !hint) {
      hint = WA.ui.displayActionMessage({
        message: 'ESPAÇO para alimentar as carpas',
        callback: () => {
          hint = null;                    // WorkAdventure closes the message it just triggered
          feed(visitorPoint.x, visitorPoint.y);
          refreshHint();
        },
      });
    } else if (!near && hint) { hint.remove(); hint = null; }
    hintNear = near;
  }
  if (useWA && window.WA && origin) {
    WA.onInit().then(async () => {
      const place = (p) => { setVisitor({ x: p.x - origin[0], y: p.y - origin[1] }); refreshHint(); };
      place(await WA.player.getPosition());
      WA.player.onPlayerMove((move) => place(move));
    }).catch((error) => console.error('koi WA', error));
  }

  const quantile = (q) => {
    const v = Array.from(costs.slice(0, costCount)).sort((a, b) => a - b);
    return v.length ? +v[Math.min(v.length - 1, Math.floor(q * v.length))].toFixed(3) : null;
  };
  const controller = {
    school, scene, masks: { swim: swim.bits, open: open.bits },
    drop, feed, setVisitor,
    pause(value = true) { userPaused = !!value; last = performance.now(); },
    get paused() { return userPaused; },
    failure: () => failure,
    stats: () => ({ fps: +fps.toFixed(1), paintP50ms: quantile(0.5), paintP95ms: quantile(0.95), onScreen,
      hidden: document.hidden, time: +school.time.toFixed(2), hintNear }),
  };
  window.__koi = controller;
  return controller;
}

// index.html marks its canvas with data-koi (the base URL of scene/masks) to start at once.
const autostart = typeof document !== 'undefined' && document.querySelector('canvas[data-koi]');
if (autostart) {
  // ?scene=lake loads lake/scene.json and its masks: one module serves every overlay of the map.
  const scene = new URLSearchParams(location.search).get('scene');
  startKoi({ canvas: autostart, base: scene && /^[a-z0-9-]+$/.test(scene) ? `${scene}/` : autostart.dataset.koi || './' })
    .catch((error) => { console.error('koi', error); autostart.dataset.failed = String(error.message || error); });
}
