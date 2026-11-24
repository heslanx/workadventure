/** The koi at the map's scale and in whole pixels (audit item N57). Run: cd hq-office/pool/koi && node --test
 * KOI_DIR=<another copy of the module> node --test size-and-pixels.test.mjs runs it against that copy (how the test was
 * seen to fail on the module as it was: KOI_DIR=/tmp/asset-proto/lanes/reactions/before/koi).
 * No browser: the painter gets a recording stand-in for the 2D context that has only the calls a pixel painter needs
 * (fillRect, clearRect, setTransform, drawImage), so a painter that builds paths or fills shapes throws. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = process.env.KOI_DIR ? resolve(process.env.KOI_DIR) : dirname(fileURLToPath(import.meta.url));
const { createSchool } = await import(pathToFileURL(resolve(here, 'simulation.mjs')).href);
const { createPainter } = await import(pathToFileURL(resolve(here, 'draw.mjs')).href);

const MIN_PX = 10, MAX_PX = 20;                      // 0.5 to 0.95 m at 21 px per metre
const SIZE = 260;

/** An open pond with a 24 px bank all round. */
function pond(count, seed) {
  const swim = new Uint8Array(SIZE * SIZE);
  for (let y = 24; y < SIZE - 24; y++) for (let x = 24; x < SIZE - 24; x++) swim[y * SIZE + x] = 1;
  return { swim, open: swim, width: SIZE, height: SIZE, count, seed, spawnPoints: [[80, 80], [180, 90], [120, 180], [60, 170]] };
}

test('every koi is 10 to 20 px long and the school is mostly 12 to 17 px', () => {
  const lengths = [];
  for (let seed = 1; seed <= 60; seed++) {
    for (const f of createSchool(pond(16, seed)).snapshot().fish) {
      assert.ok(f.length >= MIN_PX && f.length <= MAX_PX, `seed ${seed} fish ${f.id}: ${f.length.toFixed(1)} px`);
      assert.ok(f.width <= 0.31 * f.length && f.width >= 0.24 * f.length, 'width stays a quarter to a third of the length');
      lengths.push(f.length);
    }
  }
  lengths.sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  assert.ok(median >= 12 && median <= 17, `median ${median.toFixed(1)} px`);
});

test('the same seed keeps its patterns (the length change draws in the same order)', () => {
  const patterns = createSchool(pond(8, 45)).snapshot().fish.map((f) => f.pattern);
  assert.deepEqual(patterns, createSchool(pond(8, 45)).snapshot().fish.map((f) => f.pattern));
  assert.equal(new Set(patterns).size, 5, 'all five patterns are in a school of eight');
});

/** A 2D context that records fillRect and has nothing else a path painter would call. */
function recorder() {
  const calls = [];
  const ctx = {
    fillStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over',
    setTransform() {}, clearRect() { calls.length = 0; }, drawImage() {},
    fillRect(x, y, w, h) { calls.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha }); },
  };
  return { ctx, calls, canvas: { width: SIZE, height: SIZE, getContext: () => ctx } };
}

function paintOne(seed, seconds) {
  const school = createSchool(pond(1, seed));
  const { ctx, calls, canvas } = recorder();
  const painter = createPainter({ canvas, clip: {} });
  for (let i = 0; i < seconds * 60; i++) school.step(1 / 60, {});
  painter.paint(school.snapshot());
  return { calls: calls.slice(), fish: school.snapshot().fish[0], ctx };
}

test('a fish is painted in whole opaque 1 px cells and nothing else', () => {
  for (const [seed, seconds] of [[3, 5], [4, 20], [5, 40]]) {
    const { calls } = paintOne(seed, seconds);
    assert.ok(calls.length >= 20, `${calls.length} cells`);
    for (const c of calls) {
      assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y), `cell at ${c.x},${c.y}`);
      assert.equal(c.w, 1); assert.equal(c.h, 1);
      assert.equal(c.alpha, 1, 'no translucency');
      assert.match(c.style, /^#[0-9a-f]{6}$/);
    }
    const cells = new Set(calls.map((c) => `${c.x},${c.y}`));
    assert.equal(cells.size, calls.length, 'no cell is written twice');
  }
});

test('one pixel of ink closes the whole fish, with no painted shadow beyond it', () => {
  const INK = '#123e47';
  for (const [seed, seconds] of [[3, 5], [4, 20], [5, 40], [6, 60]]) {
    const { calls } = paintOne(seed, seconds);
    const at = new Map(calls.map((c) => [`${c.x},${c.y}`, c.style]));
    const around = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    let ink = 0;
    for (const [key, style] of at) {
      const [x, y] = key.split(',').map(Number);
      if (style === INK) {
        ink++;
        assert.ok(around(x, y).some(([a, b]) => at.has(`${a},${b}`) && at.get(`${a},${b}`) !== INK), `ink at ${key} touches nothing`);
      } else {
        for (const [a, b] of around(x, y)) assert.ok(at.has(`${a},${b}`), `${key} has bare water beside it, the ink is open`);
      }
    }
    assert.ok(ink >= 8, `${ink} ink cells`);
  }
});
