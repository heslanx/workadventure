// Koncluí air hockey: our own compact Canvas 2D game (circle physics, no engine, no network). See VENDOR.md for why the
// upstream project was not copied. Table units: 800 x 500, goals on the left and right, the puck is a circle that bounces
// off the rails, off the goal posts and off the mallets (a mallet hits with its own velocity). Two mallets, each locked to
// its half: side 0 (left, you) and side 1 (right, the Koru or the second player).
/* global KG */
const AirHockey = (() => {
  "use strict";

  const W = 800, H = 500;          // table
  const OX = 26, OY = 4;           // table origin inside the canvas: room for the goal pockets and the rails
  const CW = W + 2 * OX, CH = H + 2 * OY;
  const GOAL = 170, POST = 6;      // goal mouth (centered on each short side), post radius
  const R = 17, RM = 34;           // puck and mallet radius
  const SUB = 1 / 240;             // physics step
  const MAX_PUCK = 1500, WALL_E = 0.93, MALLET_E = 0.85, DRAG = 0.8; // DRAG: share of puck speed left after one second
  const KEY_SPEED = 640, POINTER_SPEED = 2000;
  const WIN = 7, GOAL_PAUSE = 1.25;
  const COLORS = { you: "#53FFC8", other: "#F79730", rail: "#3E4858", line: "#2D3746", puck: "#F0F5FB", ring: "#B4BDCC" };
  const FONT = '800 {s}px Urbanist, -apple-system, "Segoe UI", sans-serif';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // y of a ball that starts at y0 going vy for t seconds inside rails at R and H - R
  function foldY(y0, vy, t) {
    const len = H - 2 * R, span = 2 * len;
    const a = (((y0 + vy * t - R) % span) + span) % span;
    return R + (a > len ? span - a : a);
  }

  function create(canvas, { onplay, onpause, onscore, ongoal, ongameover } = {}) {
    const ctx = canvas.getContext("2d");
    const koru = new Image();
    koru.src = KG.asset("koru.png");
    koru.onload = () => { if (!handle) draw(); };

    let mode = "koru";              // "koru" (you against the Koru) | "duo" (two people on this device)
    let phase = "idle";             // idle | play | goal | over
    let paused = false;
    let handle = null;
    let scores = [0, 0], winner = null, scorer = -1, timer = 0, think = 0;
    let names = [KG.me.name, "Koru"];
    let leftBot = null;             // test hook: the left mallet plays by itself at this skill (0..8)
    const keys = new Set();
    const puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    const mallets = [0, 1].map((side) => ({ side, x: side ? W - 90 : 90, y: H / 2, vx: 0, vy: 0, tx: null, ty: null, speed: 0, boost: 1 }));
    let table = null;

    const isBot = (side) => (side === 1 && mode === "koru") || (side === 0 && leftBot !== null);
    const skill = (side) => (side === 0 ? leftBot : clamp(4 + scores[1] - scores[0], 0, 8)); // the Koru relaxes when behind

    // ------------------------------------------------------------------ flow
    function resetPositions(serveSide) {
      mallets[0].x = 90; mallets[1].x = W - 90;
      for (const m of mallets) { m.y = H / 2; m.vx = m.vy = 0; m.tx = m.ty = null; m.boost = 1; }
      puck.x = serveSide === 1 ? W * 0.75 : W * 0.25;
      puck.y = H / 2; puck.vx = puck.vy = 0;
    }

    function start(nextMode) {
      if (nextMode) mode = nextMode;
      names = mode === "koru" ? [KG.me.name, "Koru"] : ["Jogador 1", "Jogador 2"];
      scores = [0, 0]; winner = null; scorer = -1; paused = false; phase = "play"; think = 0;
      resetPositions(0);
      keys.clear();
      run();
      if (onplay) onplay();
      if (onscore) onscore(scores);
    }

    // Back to idle (mode switch): nothing runs.
    function reset(nextMode) {
      if (nextMode) mode = nextMode;
      stop();
      phase = "idle"; paused = false; scores = [0, 0]; winner = null; scorer = -1; keys.clear();
      names = mode === "koru" ? [KG.me.name, "Koru"] : ["Jogador 1", "Jogador 2"];
      resetPositions(0);
      draw();
      if (onscore) onscore(scores);
    }

    function finish() {
      phase = "over";
      paused = false;
      draw();
      stop();
      if (ongameover) ongameover(scores[0], scores[1]);
    }

    function pause() {
      if (phase !== "play" && phase !== "goal") return;
      paused = !paused;
      keys.clear();
      if (paused) { draw(); stop(); } else run();
      if (onpause) onpause(paused);
    }

    function run() { if (!handle) handle = KG.loop(frame); }
    function stop() { if (handle) { handle.stop(); handle = null; } }
    function frame(dt) { update(dt); draw(); }

    function scoreGoal(side) {
      scores[side] += 1;
      scorer = side;
      phase = "goal";
      timer = GOAL_PAUSE;
      puck.vx = puck.vy = 0;
      if (onscore) onscore(scores);
      if (ongoal) ongoal(side);
    }

    // ------------------------------------------------------------------ physics
    function update(dt) {
      if (phase === "goal") {
        timer -= dt;
        if (timer <= 0) {
          if (scores[scorer] >= WIN) { winner = scorer; finish(); } else { phase = "play"; resetPositions(1 - scorer); }
        }
        return;
      }
      if (phase !== "play") return;
      const thinkEvery = 0.16 - 0.01 * skill(1);
      think -= dt;
      for (const m of mallets) {
        keyDirection(m);
        if (isBot(m.side) && think <= 0) ai(m, skill(m.side), thinkEvery);
      }
      if (think <= 0) think = thinkEvery;
      for (let left = dt; left > 0 && phase === "play"; left -= SUB) step(Math.min(SUB, left));
    }

    function keyDirection(m) {
      const k = (code) => (keys.has(code) ? 1 : 0);
      const arrows = { x: k("ArrowRight") - k("ArrowLeft"), y: k("ArrowDown") - k("ArrowUp") };
      const wasd = { x: k("KeyD") - k("KeyA"), y: k("KeyS") - k("KeyW") };
      const dir = m.side === 1 ? arrows : mode === "duo" ? wasd : { x: wasd.x + arrows.x, y: wasd.y + arrows.y };
      m.kx = clamp(dir.x, -1, 1); m.ky = clamp(dir.y, -1, 1);
    }

    function moveMallet(m, h) {
      const px = m.x, py = m.y;
      if (m.kx || m.ky) {
        const n = Math.hypot(m.kx, m.ky);
        m.x += (m.kx / n) * KEY_SPEED * h; m.y += (m.ky / n) * KEY_SPEED * h;
        m.tx = m.ty = null;
      } else if (m.tx !== null) {
        const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy), s = Math.min(d, (m.speed || POINTER_SPEED) * m.boost * h);
        if (d > 0.01) { m.x += (dx / d) * s; m.y += (dy / d) * s; }
      }
      const lo = m.side ? W / 2 + RM : RM, hi = m.side ? W - RM : W / 2 - RM;
      m.x = clamp(m.x, lo, hi); m.y = clamp(m.y, RM, H - RM);
      m.vx = (m.x - px) / h; m.vy = (m.y - py) / h;
    }

    function step(h) {
      for (const m of mallets) moveMallet(m, h);
      puck.x += puck.vx * h; puck.y += puck.vy * h;
      const drag = Math.pow(DRAG, h);
      puck.vx *= drag; puck.vy *= drag;
      collideWalls();
      for (const m of mallets) collideMallet(m);
      collideWalls();
      for (const m of mallets) pushMalletOut(m);
      if (puck.x + R < 0) scoreGoal(1);
      else if (puck.x - R > W) scoreGoal(0);
    }

    function collideWalls() {
      if (puck.y < R) { puck.y = R; puck.vy = Math.abs(puck.vy) * WALL_E; }
      else if (puck.y > H - R) { puck.y = H - R; puck.vy = -Math.abs(puck.vy) * WALL_E; }
      const inMouth = Math.abs(puck.y - H / 2) < GOAL / 2;
      if (!inMouth) {
        if (puck.x < R) { puck.x = R; puck.vx = Math.abs(puck.vx) * WALL_E; }
        else if (puck.x > W - R) { puck.x = W - R; puck.vx = -Math.abs(puck.vx) * WALL_E; }
      }
      for (const px of [0, W]) {
        for (const py of [H / 2 - GOAL / 2, H / 2 + GOAL / 2]) {
          const dx = puck.x - px, dy = puck.y - py, d = Math.hypot(dx, dy), min = R + POST;
          if (d < min && d > 0) {
            const nx = dx / d, ny = dy / d, vn = puck.vx * nx + puck.vy * ny;
            puck.x = px + nx * min; puck.y = py + ny * min;
            if (vn < 0) { puck.vx -= (1 + WALL_E) * vn * nx; puck.vy -= (1 + WALL_E) * vn * ny; }
          }
        }
      }
    }

    function collideMallet(m) {
      const dx = puck.x - m.x, dy = puck.y - m.y, d = Math.hypot(dx, dy), min = R + RM;
      if (d >= min) return;
      const nx = d > 0 ? dx / d : (m.side ? -1 : 1), ny = d > 0 ? dy / d : 0;
      puck.x = m.x + nx * min; puck.y = m.y + ny * min;
      const rel = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny; // closing speed along the normal
      if (rel < 0) { puck.vx -= (1 + MALLET_E) * rel * nx; puck.vy -= (1 + MALLET_E) * rel * ny; }
      const speed = Math.hypot(puck.vx, puck.vy);
      if (speed > MAX_PUCK) { puck.vx *= MAX_PUCK / speed; puck.vy *= MAX_PUCK / speed; }
    }

    // The puck pinned between a mallet and a rail: the mallet gives way.
    function pushMalletOut(m) {
      const dx = puck.x - m.x, dy = puck.y - m.y, d = Math.hypot(dx, dy), min = R + RM;
      if (d >= min - 0.01 || d === 0) return;
      m.x = clamp(puck.x - (dx / d) * min, m.side ? W / 2 + RM : RM, m.side ? W - RM : W / 2 - RM);
      m.y = clamp(puck.y - (dy / d) * min, RM, H - RM);
    }

    // ------------------------------------------------------------------ the Koru (and the test bot): works in "my side" coordinates, my goal at x = 0
    function ai(m, level, dt) {
      const mir = m.side === 1, X = (x) => (mir ? W - x : x);
      const px = X(puck.x), pvx = mir ? -puck.vx : puck.vx, py = puck.y, speed = Math.hypot(puck.vx, puck.vy);
      const mx = X(m.x), my = m.y;
      const DEF_X = 80, err = 100 - level * 8, D = RM + R + 30;
      const reach = (x, y) => x >= RM - 8 && x <= W / 2 - RM + 8 && y >= RM - 8 && y <= H - RM + 8;
      m.speed = 380 + level * 55;
      m.boost = 1;
      let tx, ty;

      // one misjudgement per shot: it is drawn when the puck turns toward me and kept until it turns away
      if (m.approach !== pvx < 0) { m.approach = pvx < 0; m.bias = rand(-err, err); }
      const defend = () => {
        const blockX = clamp(px - RM - R - 4, RM, DEF_X);
        const t = pvx < -1 ? Math.max(0, (px - blockX) / -pvx) : 0;
        tx = blockX; ty = foldY(py, puck.vy, t) + (pvx < -1 ? m.bias : 0);
      };

      // a mallet that keeps pressing the puck (pinned against a rail) gets nowhere: back off for a moment
      m.contact = Math.hypot(puck.x - m.x, puck.y - m.y) < R + RM + 2 ? (m.contact || 0) + dt : 0;
      if (m.contact > 0.15) m.retreat = 0.7;
      m.retreat = Math.max(0, (m.retreat || 0) - dt);

      const attacking = px < W / 2 + 10 && speed < 300 && !m.retreat;
      if (attacking) {
        // attack: get behind the puck on the line to the other goal, then drive through it. A puck on a rail has no "behind" on that line:
        // bank it off the rail (aim at the goal mirrored over the top or bottom rail); in a corner, hit it from the open side instead.
        if (!m.attacking) m.aimY = H / 2 + rand(-GOAL * 0.3, GOAL * 0.3);
        let ux = 0, uy = 0;
        const unit = (ax, ay) => { const dx = px - ax, dy = py - ay, len = Math.hypot(dx, dy) || 1; ux = dx / len; uy = dy / len; };
        for (const ay of [m.aimY, -m.aimY, 2 * H - m.aimY, null]) {
          if (ay === null) unit(px - (W / 2 - px), py - (H / 2 - py)); // fallback: hit it into the rail or corner it is on, so it comes back to the middle
          else unit(W, ay);
          if (ay === null || reach(px + ux * D, py + uy * D)) break;
        }
        const along = (mx - px) * ux + (my - py) * uy, across = (mx - px) * -uy + (my - py) * ux;
        if (along > 12 && Math.abs(across) < RM * 0.9) { tx = px - ux * 40; ty = py - uy * 40; m.boost = 1.35; }
        else { tx = px + ux * D; ty = py + uy * D; }
      } else if (!m.retreat && (px < W / 2 + 10 || pvx < -80)) {
        defend(); // the puck is fast on my half, or coming at me from the other one
      } else {
        tx = 90; ty = H / 2 + (py - H / 2) * 0.55;
      }
      m.attacking = attacking;
      m.tx = clamp(X(tx), m.side ? W / 2 + RM : RM, m.side ? W - RM : W / 2 - RM);
      m.ty = clamp(ty, RM, H - RM);
    }

    // ------------------------------------------------------------------ input from the page
    // Pointer position in table units: the mallet of the given side (or of the half under the pointer when side is -1) chases it.
    function aim(side, x, y) {
      if (phase !== "play" || paused) return;
      const idx = side === -1 ? (x < W / 2 ? 0 : 1) : side;
      const m = mallets[idx];
      if (isBot(idx)) return;
      m.tx = x; m.ty = y; m.speed = POINTER_SPEED; m.boost = 1; m.kx = m.ky = 0;
    }

    const handled = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    function keydown(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (handled.has(ev.code) || ev.code === "Space") ev.preventDefault(); // arrows and Space never scroll the page
      if (ev.code === "Space" || ev.code === "Enter") {
        if (phase === "idle" || phase === "over") start();
        else if (paused) pause();
      } else if (ev.code === "KeyP" || ev.code === "Escape") pause();
      else if (handled.has(ev.code) && phase === "play" && !paused) keys.add(ev.code);
    }
    const keyup = (ev) => keys.delete(ev.code);
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);

    // ------------------------------------------------------------------ drawing
    const ratio = () => (KG.profile === "leve" ? 1 : Math.min(window.devicePixelRatio || 1, 2));

    // Backing store follows the CSS size set by the page. Called again by the page on resize.
    function resize() {
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio())), h = Math.max(1, Math.round(canvas.clientHeight * ratio()));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        table = null;
        if (!handle) draw();
      }
    }

    // Pointer (client coordinates) in table units.
    function point(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      return { x: (clientX - box.left) * (CW / box.width) - OX, y: (clientY - box.top) * (CH / box.height) - OY };
    }

    function buildTable() {
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext("2d");
      g.setTransform(c.width / CW, 0, 0, c.height / CH, OX * c.width / CW, OY * c.height / CH);
      // surface
      g.fillStyle = "#0B2740";
      g.fillRect(0, 0, W, H);
      // markings
      g.strokeStyle = COLORS.line; g.lineWidth = 4;
      g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 70, 0, Math.PI * 2); g.stroke();
      g.fillStyle = COLORS.line;
      for (const x of [W * 0.25, W * 0.75]) { g.beginPath(); g.arc(x, H / 2, 7, 0, Math.PI * 2); g.fill(); }
      // goal pockets and the glow of each mouth
      for (const side of [0, 1]) {
        const x = side ? W : -OX, color = side ? COLORS.other : COLORS.you;
        g.fillStyle = "#050B17";
        g.fillRect(x, H / 2 - GOAL / 2, OX, GOAL);
        g.fillStyle = color; g.globalAlpha = 0.9;
        g.fillRect(side ? W - 3 : 0, H / 2 - GOAL / 2, 3, GOAL);
        g.globalAlpha = 1;
      }
      // rails, with the goal mouths left open
      g.strokeStyle = COLORS.rail; g.lineWidth = 8; g.lineCap = "butt";
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(W, 0);
      g.moveTo(0, H); g.lineTo(W, H);
      for (const x of [0, W]) {
        g.moveTo(x, 0); g.lineTo(x, H / 2 - GOAL / 2);
        g.moveTo(x, H / 2 + GOAL / 2); g.lineTo(x, H);
      }
      g.stroke();
      g.fillStyle = COLORS.ring;
      for (const x of [0, W]) for (const y of [H / 2 - GOAL / 2, H / 2 + GOAL / 2]) { g.beginPath(); g.arc(x, y, POST, 0, Math.PI * 2); g.fill(); }
      return c;
    }

    function disc(x, y, r, fill) {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    function drawMallet(m) {
      const color = m.side ? COLORS.other : COLORS.you;
      disc(m.x + 2, m.y + 4, RM, "rgba(0,0,0,.35)");
      disc(m.x, m.y, RM, color);
      disc(m.x, m.y, RM * 0.7, "#0E2236");
      disc(m.x, m.y, RM * 0.55, color);
      if (m.side === 1 && mode === "koru" && koru.complete && koru.naturalWidth) ctx.drawImage(koru, m.x - 23, m.y - 22, 46, 43);
      else disc(m.x, m.y, RM * 0.2, "rgba(255,255,255,.45)");
    }

    function text(str, x, y, size, fill, align = "center") {
      ctx.font = FONT.replace("{s}", size);
      ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.fillStyle = fill;
      ctx.fillText(str, x, y);
    }

    function draw() {
      const s = canvas.width / CW;
      if (!table) table = buildTable();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(table, 0, 0);
      ctx.setTransform(s, 0, 0, canvas.height / CH, OX * s, OY * canvas.height / CH);
      // big ghost scores in each half, names under them
      text(String(scores[0]), W / 4, H / 2 + 60, 190, "rgba(83,255,200,.09)");
      text(String(scores[1]), W * 0.75, H / 2 + 60, 190, "rgba(247,151,48,.09)");
      ctx.font = FONT.replace("{s}", 18);
      let name = names[0];
      while (name.length > 3 && ctx.measureText(name).width > W / 2 - 80) name = name.slice(0, -2) + "…";
      text(name, W / 4, H - 24, 18, "rgba(83,255,200,.55)");
      text(names[1], W * 0.75, H - 24, 18, "rgba(247,151,48,.6)");
      if (phase !== "goal") {
        disc(puck.x + 2, puck.y + 3, R, "rgba(0,0,0,.35)");
        disc(puck.x, puck.y, R, COLORS.puck);
        disc(puck.x, puck.y, R * 0.62, COLORS.ring);
        disc(puck.x, puck.y, R * 0.4, COLORS.puck);
      }
      for (const m of mallets) drawMallet(m);
      if (phase === "goal") {
        const who = scorer === 0 ? names[0] : names[1];
        text("GOL!", W / 2, H / 2 + 8, 72, scorer === 0 ? COLORS.you : COLORS.other);
        text(who, W / 2, H / 2 + 44, 20, COLORS.puck);
      }
    }

    return {
      CW, CH, W, H,
      start, reset, pause, aim, resize, point, draw,
      get mode() { return mode; },
      get phase() { return phase; },
      get paused() { return paused; },
      get scores() { return scores; },
      get winner() { return winner; },
      get running() { return !!handle; },
      get puck() { return puck; },
      get mallets() { return mallets; },
      get names() { return names; },
      // test hooks
      simulate(seconds, dt = 1 / 60) { for (let t = 0; t < seconds && (phase === "play" || phase === "goal"); t += dt) update(dt); },
      setLeftBot(level) { leftBot = level; },
      park(x, y) { puck.x = x; puck.y = y; puck.vx = puck.vy = 0; },
      force(a, b) {
        if (phase === "idle" || phase === "over") start();
        scores = [a, b]; scorer = a > b ? 0 : 1; winner = scorer;
        if (onscore) onscore(scores);
        finish();
      },
    };
  }

  return { create, W, H, CW, CH };
})();
