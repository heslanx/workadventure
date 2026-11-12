// Flappy Koru: the MakeSchool FlappyBirdTemplate-Spritebuilder game (MainScene.m, Obstacle.m, Character.m), ported from
// Objective-C/Cocos2d to Canvas 2D with the Koru in place of the bird. See VENDOR.md. World in points, y down, 288 x 512:
// the art pack's native size (its PNGs are 2x). The template's numbers are kept: gravity 700 pt/s², a flap leaves the Koru
// climbing at 200 pt/s (the template clamps the climb there), 80 pt/s forward, a pipe pair every 160 pt, a 117 pt gap.
/* global KG */
const FlappyKoru = (() => {
  "use strict";

  const W = 288, H = 512, GROUND = 400;       // world, top of the ground
  const GRAVITY = 700, FLAP = 200, SPEED = 80;
  const PIPE_W = 53, GAP = 117, SPACING = 160, FIRST = W + 24;
  const GAP_MIN = 100, GAP_MAX = 300;          // gap centre: at least 41 pt of pipe above and below
  const GAP_STEP = 150;                        // two gaps in a row differ by at most this (a climb that is always possible)
  const KORU_X = 80, KORU_START = 220;
  const KORU_SCALE = 52 / 71;                  // art px -> points: the Koru spans 52 pt, about a pipe's width
  const PIVOT = [35.5, 20.5];                  // her body centre inside a frame of art/koru.png
  const HIT_W = 20, HIT_H = 19;                // her head and body: wings, ear tufts and feet never collide
  const FRAMES = 4, FLAP_FPS = 12, DOWNSTROKE = 2;
  const STEP = 1 / 120;                        // fixed physics step: same game at 30 and 60 fps
  const RESTART_GUARD = 450;                   // ms after the end before Space starts again (no accidental restarts)
  const FONT = '800 {s}px Urbanist, -apple-system, "Segoe UI", sans-serif';
  const ART = ["sky", "clouds", "bush", "ground", "pipe_top", "pipe_bottom", "koru"];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function create(canvas, { onplay, onpause, onscore, onhit, ongameover } = {}) {
    const ctx = canvas.getContext("2d");
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches; // no shake, no flash
    const art = {};
    for (const name of ART) {
      art[name] = new Image();
      art[name].onload = () => { if (!handle) draw(); };
      art[name].src = `art/${name}.png`;
    }

    let phase = "ready";          // ready | play | fall | over
    let paused = false;
    let handle = null, acc = 0, overAt = 0;
    let score = 0, scroll = 0, flapClock = 0, shake = 0, flash = 0;
    let pipes = [];               // { x, gap (centre y), passed }
    let autopilot = false;        // test hook: she flies by herself
    const koru = { y: KORU_START, vy: 0, angle: 0 };

    // ------------------------------------------------------------------ flow
    function run() { if (!handle) { acc = 0; handle = KG.loop(frame); } }
    function stop() { if (handle) { handle.stop(); handle = null; } }

    function nextGap(prev) {
      return prev === undefined ? rand(GAP_MIN, GAP_MAX) : rand(Math.max(GAP_MIN, prev - GAP_STEP), Math.min(GAP_MAX, prev + GAP_STEP));
    }

    function start() {
      stop();
      phase = "play";
      paused = false;
      score = 0;
      scroll = 0;
      shake = flash = 0;
      Object.assign(koru, { y: KORU_START, vy: 0, angle: 0 });
      pipes = [{ x: FIRST, gap: nextGap(), passed: false }];
      onscore?.(score);
      onplay?.();
      flap();
      run();
    }

    function flap() {
      if (phase === "ready" || phase === "over") return start();
      if (phase !== "play" || paused) return;
      koru.vy = -FLAP;
      flapClock = DOWNSTROKE / FLAP_FPS; // the wings beat down on every flap
    }

    function pause() {
      if (phase !== "play") return;
      paused = !paused;
      if (paused) stop();
      else run();
      draw();
      onpause?.(paused);
    }

    function hit() {
      phase = "fall";
      if (!calm) { shake = 0.2; flash = 0.25; }
      onhit?.(score);
    }

    function land() {
      koru.y = GROUND - HIT_H / 2;
      koru.vy = 0;
      phase = "over";
      overAt = performance.now();
      stop();
      draw();
      ongameover?.(score);
    }

    // ------------------------------------------------------------------ physics (one fixed step)
    function steer() {
      const next = pipes.find((p) => p.x + PIPE_W > KORU_X - HIT_W / 2);
      if (koru.y > (next ? next.gap + 10 : KORU_START) && koru.vy > -60) flap();
    }

    function physics(dt) {
      if (phase === "play") {
        if (autopilot) steer();
        scroll += SPEED * dt;
        flapClock += dt;
        for (const p of pipes) p.x -= SPEED * dt;
        if (pipes[0].x < -PIPE_W) pipes.shift();
        while (pipes[pipes.length - 1].x < W) {
          const last = pipes[pipes.length - 1];
          pipes.push({ x: last.x + SPACING, gap: nextGap(last.gap), passed: false });
        }
        for (const p of pipes) {
          if (!p.passed && p.x + PIPE_W / 2 < KORU_X) {
            p.passed = true;
            score += 1;
            onscore?.(score);
          }
        }
      }
      koru.vy += GRAVITY * dt;
      koru.y += koru.vy * dt;
      if (koru.y < HIT_H / 2) { koru.y = HIT_H / 2; koru.vy = Math.max(koru.vy, 0); } // the sky has a lid
      if (phase === "play") {
        koru.angle += (clamp(koru.vy * 0.06, -12, 25) - koru.angle) * Math.min(1, dt * 12);
        const left = KORU_X - HIT_W / 2, right = KORU_X + HIT_W / 2, top = koru.y - HIT_H / 2, bottom = koru.y + HIT_H / 2;
        const touches = (p) => right > p.x + 1 && left < p.x + PIPE_W - 1 && (top < p.gap - GAP / 2 || bottom > p.gap + GAP / 2);
        if (pipes.some(touches)) hit();
      } else {
        koru.angle = Math.min(90, koru.angle + 360 * dt); // she tumbles down, like the template's 90° game over
      }
      shake = Math.max(0, shake - dt);
      flash = Math.max(0, flash - dt);
      if (koru.y + HIT_H / 2 >= GROUND) {
        if (phase === "play") hit();
        land();
      }
    }

    function frame(dt) {
      acc += dt;
      while (acc >= STEP && handle) {
        physics(STEP);
        acc -= STEP;
      }
      draw();
    }

    // ------------------------------------------------------------------ input
    function keydown(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.target instanceof Element && ev.target.closest("button, summary, a, input")) return; // the control handles it
      const flapKey = ev.code === "Space" || ev.code === "ArrowUp" || ev.code === "KeyW";
      if (flapKey || ev.code === "ArrowDown") ev.preventDefault(); // Space and the arrows never scroll the page
      if (ev.repeat) return;
      if (ev.code === "KeyP" || ev.code === "Escape") return pause();
      if (!flapKey) return;
      if (paused) return pause();
      if (phase === "over" && performance.now() - overAt < RESTART_GUARD) return;
      flap();
    }
    document.addEventListener("keydown", keydown);

    // ------------------------------------------------------------------ drawing
    const ratio = () => (KG.profile === "leve" ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    const loaded = (im) => im.complete && im.naturalWidth > 0;

    // Backing store follows the CSS size set by the page. Called again by the page on resize.
    function resize() {
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio()));
      const h = Math.max(1, Math.round((w * H) / W));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (!handle) draw();
      }
    }

    function draw() {
      const k = canvas.width / W;
      // every edge lands on a device pixel: crisp pixel art, no seams between ground tiles
      const put = (im, x, y, w = im.width / 2, h = im.height / 2) => {
        if (!loaded(im)) return;
        const x0 = Math.round(x * k), y0 = Math.round(y * k);
        ctx.drawImage(im, x0 / k, y0 / k, (Math.round((x + w) * k) - x0) / k, (Math.round((y + h) * k) - y0) / k);
      };
      const tile = (im, offset, y) => {
        const w = im.width / 2;
        for (let x = -(offset % w); x < W; x += w) put(im, x, y);
      };
      const dx = shake ? Math.round((Math.random() - 0.5) * 4) : 0, dy = shake ? Math.round((Math.random() - 0.5) * 4) : 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#0A142E";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, dx * k, dy * k);
      put(art.sky, 0, 0);
      tile(art.clouds, scroll * 0.1, 16);
      tile(art.bush, scroll * 0.5, GROUND - art.bush.height / 2);
      for (const p of pipes) {
        put(art.pipe_top, p.x, p.gap - GAP / 2 - art.pipe_top.height / 2);
        put(art.pipe_bottom, p.x, p.gap + GAP / 2);
      }
      tile(art.ground, scroll, GROUND);
      if (loaded(art.koru)) {
        const fw = art.koru.width / FRAMES, fh = art.koru.height;
        const f = phase === "play" ? Math.floor(flapClock * FLAP_FPS) % FRAMES : 0;
        ctx.save();
        ctx.translate(Math.round(KORU_X * k) / k, Math.round(koru.y * k) / k);
        ctx.rotate((koru.angle * Math.PI) / 180);
        ctx.scale(KORU_SCALE, KORU_SCALE);
        ctx.drawImage(art.koru, f * fw, 0, fw, fh, -PIVOT[0], -PIVOT[1], fw, fh);
        ctx.restore();
      }
      if (phase !== "ready") {
        ctx.font = FONT.replace("{s}", "40");
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.lineJoin = "round";
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#03051A";
        ctx.fillStyle = "#F0F5FB";
        const label = score.toLocaleString("pt-BR");
        ctx.strokeText(label, W / 2, 64);
        ctx.fillText(label, W / 2, 64);
      }
      if (flash) {
        ctx.fillStyle = `rgba(240, 245, 251, ${(flash / 0.25) * 0.7})`;
        ctx.fillRect(-4, -4, W + 8, H + 8);
      }
    }

    function reset() {
      stop();
      phase = "ready";
      paused = false;
      score = 0;
      pipes = [];
      Object.assign(koru, { y: KORU_START, vy: 0, angle: 0 });
      draw();
    }

    return {
      start, flap, pause, resize, draw, reset,
      get phase() { return phase; },
      get paused() { return paused; },
      get running() { return !!handle; },
      get score() { return score; },
      get koru() { return { x: KORU_X, y: koru.y, vy: koru.vy, angle: koru.angle }; },
      get pipes() { return pipes.map((p) => ({ ...p })); },
      get artLoaded() { return ART.every((name) => loaded(art[name])); },
      // test hooks
      set autopilot(on) { autopilot = !!on; },
      crash(points) {
        if (phase !== "play") start();
        score = Math.max(0, Math.round(points));
        onscore?.(score);
        hit();
      },
    };
  }

  return { create, W, H, GROUND };
})();
