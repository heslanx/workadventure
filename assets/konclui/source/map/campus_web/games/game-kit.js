// Koncluí campus games: the bridge between a game page and WorkAdventure (v1.34 iframe API).
//
// In the office, campus.js opens each game as a modal with allowApi, so WA.* works here: shared room variables
// (WA.state) for tables and high scores, WA.event for live moments. Opened straight in a browser (development, tests),
// KG fakes WA: variables live in localStorage and events in a BroadcastChannel, shared by the tabs of the same origin,
// so two tabs can play a 1x1 game against each other. Load order: iframe_api.js (optional), game-kit.js, the game.
//
// Anyone in the office can write any room variable (no login): every value read here is validated, never trusted, and
// never rendered as HTML.
/* global WA */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const inWA = window.parent !== window && typeof WA !== "undefined" && !params.has("local");
  const listeners = new Map(); // mock: variable name -> Set(callback)
  const channel = !inWA && "BroadcastChannel" in window ? new BroadcastChannel("kg-events") : null;
  const eventListeners = new Map(); // mock: event name -> Set(callback)
  const me = { id: "", name: "" };

  function randomId() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 16);
  }

  function parseJSON(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    try {
      return typeof value === "string" ? JSON.parse(value) : value;
    } catch {
      return fallback;
    }
  }

  const clean = (text, max = 40) => String(text ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

  // ------------------------------------------------------------------ init
  let readyPromise;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (inWA) {
        await WA.onInit();
        let uuid;
        try {
          uuid = WA.player.uuid; // the getter throws instead of returning undefined when the uuid is missing
        } catch {
          uuid = undefined;
        }
        me.id = String(uuid || `p${WA.player.playerId}`);
        me.name = clean(WA.player.name) || "Anônimo";
      } else {
        let id = sessionStorage.getItem("kg:id");
        if (!id) sessionStorage.setItem("kg:id", (id = randomId()));
        me.id = id;
        me.name = clean(params.get("nome")) || `Visitante ${id.slice(-3).toUpperCase()}`;
        window.addEventListener("storage", (e) => {
          if (e.key && e.key.startsWith("kg:v:")) notify(e.key.slice(5), e.newValue ?? undefined);
        });
        channel?.addEventListener("message", (e) => deliver(e.data.name, e.data.data, e.data.sender));
      }
      return me;
    })();
    return readyPromise;
  }

  // ------------------------------------------------------------------ shared variables
  function notify(name, value) {
    for (const cb of listeners.get(name) || []) {
      try {
        cb(value);
      } catch (err) {
        console.error("kg state listener", name, err);
      }
    }
  }

  const state = {
    load(name) {
      if (inWA) return WA.state.loadVariable(name);
      const v = localStorage.getItem(`kg:v:${name}`);
      return v === null ? undefined : v;
    },
    async save(name, value) {
      if (inWA) return WA.state.saveVariable(name, value);
      localStorage.setItem(`kg:v:${name}`, value);
      notify(name, value); // the storage event only reaches the other tabs
    },
    on(name, cb) {
      if (inWA) {
        const sub = WA.state.onVariableChange(name).subscribe(cb);
        return () => sub.unsubscribe();
      }
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(cb);
      return () => listeners.get(name).delete(cb);
    },
  };

  // ------------------------------------------------------------------ events (everyone in the office, sender included)
  function deliver(name, data, sender) {
    for (const cb of eventListeners.get(name) || []) {
      try {
        cb(data, { mine: sender === me.id });
      } catch (err) {
        console.error("kg event listener", name, err);
      }
    }
  }

  const event = {
    send(name, data) {
      if (inWA) return WA.event.broadcast(name, data);
      channel?.postMessage({ name, data, sender: me.id });
      deliver(name, data, me.id);
      return Promise.resolve();
    },
    on(name, cb) {
      if (inWA) {
        const sub = WA.event.on(name).subscribe((ev) => cb(ev.data, { mine: ev.senderId === WA.player.playerId }));
        return () => sub.unsubscribe();
      }
      if (!eventListeners.has(name)) eventListeners.set(name, new Set());
      eventListeners.get(name).add(cb);
      return () => eventListeners.get(name).delete(cb);
    },
  };

  // ------------------------------------------------------------------ performance profile (BACKLOG.md §3)
  function detectProfile() {
    const forced = params.get("perfil");
    if (forced === "leve" || forced === "padrao") return forced;
    const slow = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    return slow || reduced || navigator.connection?.saveData ? "leve" : "padrao";
  }
  const profile = detectProfile();

  // A frame loop that stops while the tab is hidden and runs at 30 fps on the light profile. step(dt in seconds).
  function loop(step, { fps } = {}) {
    const cap = fps || (profile === "leve" ? 30 : 60);
    const minGap = 1000 / cap - 1;
    let last = 0, raf = 0, running = true;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!last) last = t;
      if (t - last < minGap) return;
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      step(dt);
    }
    function onVisibility() {
      cancelAnimationFrame(raf);
      last = 0;
      if (running && !document.hidden) raf = requestAnimationFrame(frame);
    }
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);
    return {
      stop() {
        running = false;
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVisibility);
      },
    };
  }

  // ------------------------------------------------------------------ high scores: the 10 best per game
  function board(varName, { higher = true, max = 10 } = {}) {
    const valid = (r) => r && typeof r.nome === "string" && Number.isFinite(r.pontos) && typeof r.quando === "string";
    const order = (a, b) => (higher ? b.pontos - a.pontos : a.pontos - b.pontos) || a.quando.localeCompare(b.quando);
    const load = () => {
      const rows = parseJSON(state.load(varName), []);
      return (Array.isArray(rows) ? rows : []).filter(valid).map((r) => ({ nome: clean(r.nome), pontos: r.pontos, quando: r.quando }))
        .sort(order).slice(0, max);
    };
    return {
      load,
      // Saves the score and returns { rows, rank } (rank -1 when it did not enter the list).
      async submit(pontos) {
        await ready();
        const mine = { nome: me.name, pontos: Math.round(pontos), quando: new Date().toISOString() };
        const rows = [...load(), mine].sort(order).slice(0, max);
        const rank = rows.indexOf(mine);
        if (rank !== -1) await state.save(varName, JSON.stringify(rows));
        return { rows, rank };
      },
      render(el, rows = load(), highlight = -1) {
        el.replaceChildren();
        const table = document.createElement("table");
        table.className = "kg-board";
        rows.forEach((r, i) => {
          const tr = table.insertRow();
          if (i === highlight) tr.className = "kg-me";
          for (const text of [`${i + 1}.`, r.nome, r.pontos.toLocaleString("pt-BR")]) tr.insertCell().textContent = text;
        });
        if (!rows.length) {
          const p = document.createElement("p");
          p.className = "kg-muted";
          p.textContent = "Ninguém jogou ainda. O primeiro recorde é seu.";
          el.append(p);
        } else el.append(table);
      },
    };
  }

  // ------------------------------------------------------------------ tables: turn-based sessions in one room variable
  // Session: { v, id, game, status: "waiting" | "playing" | "done", seats: [{id, name} | null], turn, seq, state,
  //            winner: seat index | "empate" | null, reason, updated, started }
  // Rules (BACKLOG.md §2): every lock has an owner and an expiry; only the player whose turn it is writes; a write is
  // read back after a short wait and a lost race is reported, never retried forever.
  const WAITING_TTL = 10 * 60 * 1000, PLAYING_TTL = 15 * 60 * 1000, WO_AFTER = 2 * 60 * 1000, VERIFY_MS = 450;

  function table(varName, { game, seats = 2, initial = () => ({}), validState = () => true } = {}) {
    const subs = new Set();
    let session = null;

    function validSession(s) {
      return s && s.v === 1 && s.game === game && Array.isArray(s.seats) && s.seats.length === seats &&
        ["waiting", "playing", "done"].includes(s.status) && Number.isInteger(s.seq) && Number.isFinite(s.updated) &&
        s.seats.every((x) => x === null || (x && typeof x.id === "string" && typeof x.name === "string")) &&
        Number.isInteger(s.turn) && s.turn >= 0 && s.turn < seats && validState(s.state);
    }

    const read = () => {
      const s = parseJSON(state.load(varName), null);
      return validSession(s) ? s : null;
    };

    function stale(s) {
      if (!s) return true;
      const age = Date.now() - s.updated;
      return s.status === "done" || (s.status === "waiting" && age > WAITING_TTL) || (s.status === "playing" && age > PLAYING_TTL);
    }

    const seatOf = (s) => (s ? s.seats.findIndex((x) => x && x.id === me.id) : -1);

    function emit(prev) {
      for (const cb of subs) {
        try {
          cb(session, prev);
        } catch (err) {
          console.error("kg table listener", err);
        }
      }
    }

    async function write(next) {
      next.updated = Date.now();
      await state.save(varName, JSON.stringify(next));
      await new Promise((r) => setTimeout(r, VERIFY_MS));
      const now = read();
      return !!now && now.id === next.id && now.seq === next.seq;
    }

    function fresh() {
      const now = Date.now();
      return { v: 1, id: randomId(), game, status: "waiting", seats: Array(seats).fill(null), turn: 0, seq: 0,
               state: initial(), winner: null, reason: "", updated: now, started: now };
    }

    const api = {
      get session() {
        return session;
      },
      get seat() {
        return seatOf(session);
      },
      get role() {
        if (!session || stale(session)) return "livre";
        return seatOf(session) === -1 ? "espectador" : "jogador";
      },
      myTurn() {
        return !!session && session.status === "playing" && session.turn === seatOf(session) && seatOf(session) !== -1;
      },
      // Can the person waiting claim the win because the other player stopped answering?
      canClaimWO() {
        return !!session && session.status === "playing" && seatOf(session) !== -1 && session.turn !== seatOf(session) &&
          Date.now() - session.updated > WO_AFTER;
      },
      onChange(cb) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      // Sit at a free seat, opening a new game when the table is free or stale. Returns the seat, or -1 (spectator).
      async join() {
        await ready();
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const cur = read();
          if (cur && !stale(cur) && seatOf(cur) !== -1) return seatOf(cur);
          const base = !cur || stale(cur) ? fresh() : JSON.parse(JSON.stringify(cur));
          const free = base.seats.findIndex((x) => x === null);
          if (free === -1) return -1;
          base.seats[free] = { id: me.id, name: me.name };
          base.seq += 1;
          if (base.seats.every(Boolean)) {
            base.status = "playing";
            base.turn = 0;
            base.started = Date.now();
          }
          if (await write(base)) return free;
        }
        return seatOf(read());
      },
      // Commit my move: the new game state, then the turn passes (or stays with next: false), or the game ends.
      async play(nextState, { next = true, winner = null, reason = "" } = {}) {
        if (!api.myTurn()) return false;
        const s = JSON.parse(JSON.stringify(session));
        s.state = nextState;
        s.seq += 1;
        if (winner !== null) {
          s.status = "done";
          s.winner = winner;
          s.reason = reason;
        } else if (next) s.turn = (s.turn + 1) % seats;
        return write(s);
      },
      async resign() {
        const seat = seatOf(session);
        if (seat === -1 || session.status !== "playing") return false;
        const s = JSON.parse(JSON.stringify(session));
        Object.assign(s, { status: "done", winner: (seat + 1) % seats, reason: "desistência", seq: s.seq + 1 });
        return write(s);
      },
      async claimWO() {
        if (!api.canClaimWO()) return false;
        const s = JSON.parse(JSON.stringify(session));
        Object.assign(s, { status: "done", winner: seatOf(session), reason: "W.O.", seq: s.seq + 1 });
        return write(s);
      },
      // Leave a game that has not started yet (frees the seat).
      async leave() {
        const seat = seatOf(session);
        if (seat === -1 || session.status !== "waiting") return false;
        const s = JSON.parse(JSON.stringify(session));
        s.seats[seat] = null;
        s.seq += 1;
        return write(s);
      },
      // Clear the table for a new game: players at any time, everyone else only when it is over or stale.
      async reset() {
        if (session && !stale(session) && seatOf(session) === -1) return false;
        return write(fresh());
      },
    };

    ready().then(() => {
      session = read();
      emit(null);
      state.on(varName, () => {
        const prev = session;
        session = read();
        emit(prev);
      });
    });
    return api;
  }

  // ------------------------------------------------------------------ page chrome: title, status line, help, close
  function chrome({ title, help = "" } = {}) {
    const bar = document.createElement("header");
    bar.className = "kg-bar";
    const h = document.createElement("h1");
    h.textContent = title;
    const status = document.createElement("p");
    status.className = "kg-status";
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "kg-actions";
    if (help) {
      const details = document.createElement("details");
      details.className = "kg-help";
      const summary = document.createElement("summary");
      summary.textContent = "Como jogar";
      const p = document.createElement("p");
      p.textContent = help;
      details.append(summary, p);
      actions.append(details);
    }
    const close = document.createElement("button");
    close.className = "kg-btn kg-ghost";
    close.textContent = "Fechar";
    close.onclick = () => api.close();
    actions.append(close);
    bar.append(h, status, actions);
    document.body.prepend(bar);
    return {
      status(text) {
        status.textContent = text;
      },
    };
  }

  const api = {
    inWA,
    me,
    profile,
    ready,
    state,
    event,
    loop,
    board,
    table,
    chrome,
    parseJSON,
    clean,
    // URL of shared art next to this kit (games/koru.png), resolved from where game-kit.js was loaded.
    asset: ((base) => (name) => new URL(name, base).href)(document.currentScript ? document.currentScript.src : location.href),
    close() {
      if (inWA) WA.ui.modal.closeModal();
      else window.close();
    },
  };
  window.KG = api;
})();
