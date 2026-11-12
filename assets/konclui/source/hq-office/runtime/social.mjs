/**
 * The office's social behaviours for WorkAdventure 1.34.1 (installed by the map script, nothing runs on import):
 *   desks    sitting at a free desk offers "ESPAÇO para reservar esta mesa"; others standing at it see "Mesa de Fulano";
 *            the "Minha mesa" button walks you back to it and you sit (one desk per person; reserving another moves it)
 *   rooms    inside a team or meeting room the action bar offers "Trancar sala": the doors stay shut and their gaps
 *            block; outside a locked door "ESPAÇO para bater" knocks, and anyone inside gets "ESPAÇO para abrir";
 *            the room unlocks itself when whoever locked it leaves and nobody else is seen inside
 *   react    "Aplaudir" and "Confete" buttons show a short animation over your avatar to everyone around
 *   ambience the water of the lake and the coffee bar in the cafe, as soft loops that fade in with nearness (in the page,
 *            theme/hud-audio.js), with an on/off button that says which
 * Shared state lives in two declared room variables (mesas, salas); every visual change is local and derived from it.
 */
const T = 32;
const inside = (p, r) => p && p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) <= d;

/** {chairId: {uuid, name}} with every earlier desk of `uuid` released and `chairId` reserved. Pure, tested. */
export function reserve(desks, chairId, uuid, name) {
  const next = Object.fromEntries(Object.entries(desks || {}).filter(([, v]) => v?.uuid !== uuid));
  next[chairId] = { uuid, name: String(name || 'Alguém').slice(0, 40) };
  return next;
}

/** The desk `uuid` holds, or null. Pure, tested. */
export const deskOf = (desks, uuid) => Object.entries(desks || {}).find(([, v]) => v?.uuid === uuid)?.[0] || null;

/** What Space does on the desk chair `chair`: claim it, move your claim to it, release it, or nothing (another's).
 * Pure, tested. */
export function deskAction(mesas, chair, uuid) {
  const owner = mesas?.[chair];
  if (!owner) return deskOf(mesas, uuid) ? 'move' : 'claim';
  return owner.uuid === uuid ? 'release' : null;
}

/** The seated prompt copy for a desk action. Pure, tested. */
export function deskPromptText(action, ownerName) {
  if (action === 'claim') return 'ESPAÇO para reivindicar esta mesa';
  if (action === 'move') return 'ESPAÇO para mover sua mesa para cá';
  if (action === 'release') return 'Sua mesa · ESPAÇO para liberar';
  return `Mesa de ${ownerName}`;
}

/** Claim the free desk chair `chairId` through the reserve path (moving yours there); null when someone else owns it.
 * Pure, tested. */
export function claim(desks, chairId, uuid, name) {
  const owner = desks?.[chairId];
  if (owner && owner.uuid !== uuid) return null;
  if (owner) return desks;
  return reserve(desks, chairId, uuid, name);
}

const parse = value => {
  try {
    const v = typeof value === 'string' ? (value ? JSON.parse(value) : {}) : value;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

export async function installSocial(WA, { desks = [], rooms = [], ambience = [], reactionsUrl, soundsBase },
  { seating, interactions, onSeatChange, page }) {
  await WA.onInit();
  let uuid;
  try { uuid = WA.player.uuid; } catch { uuid = null; }
  uuid = uuid || `p-${WA.player.playerId}`;
  const myName = WA.player.name || 'Alguém';
  let me = await WA.player.getPosition();
  const deskIds = new Set(desks.map(d => d.chair));
  let mesas = parse(WA.state.loadVariable('mesas'));
  let salas = parse(WA.state.loadVariable('salas'));
  // key: the prompt on screen (null once WA consumed it on Space). stale: show it again even with the same key, after a
  // change of seat or of the desks; resetting the key there instead lost track of an open desk prompt, which then
  // stayed on screen after the visitor stood up and walked away.
  const message = { current: null, key: null, stale: false };
  const show = (key, text, callback = () => {}) => {
    if (message.key === key && !message.stale) return;
    message.stale = false;
    message.current?.remove();
    message.current = key ? WA.ui.displayActionMessage({ message: text, callback }) : null;
    message.key = key;
  };

  // ------------------------------------------------------------------------------------------- desks
  let seatedId = null;
  const seatById = id => seating.seats().find(s => s.id === id);
  const saveDesks = next => { mesas = next; return WA.state.saveVariable('mesas', JSON.stringify(next)).catch(() => {}); };
  let deskButtonShown = true;                       // the HUD view takes "Minha mesa" into its people map
  const myDeskButton = () => {
    WA.ui.actionBar.removeButton('minha-mesa');
    const chair = deskOf(mesas, uuid);
    if (!chair || !deskButtonShown) return;
    WA.ui.actionBar.addButton({ id: 'minha-mesa', label: 'Minha mesa', callback: () => {
      const seat = seatById(`chair:${chair}`);
      if (seat) seating.walkTo(seat);
    } });
  };
  const deskPrompt = () => {
    const chair = seatedId?.startsWith('chair:') ? seatedId.slice(6) : null;
    if (chair && deskIds.has(chair)) {
      const action = deskAction(mesas, chair, uuid);
      if (action === 'release') return show(`desk-mine-${chair}`, deskPromptText('release'), () => {
        const next = { ...mesas };
        delete next[chair];
        saveDesks(next).then(() => { myDeskButton(); message.key = null; deskPrompt(); });
      });
      if (action) return show(`desk-free-${chair}`, deskPromptText(action), () => {
        saveDesks(reserve(mesas, chair, uuid, myName)).then(() => { myDeskButton(); message.key = null; deskPrompt(); });
      });
      return show(`desk-other-${chair}`, deskPromptText(null, mesas[chair].name));
    }
    // standing at someone's desk: whose it is
    const seat = seating.seats().find(s => deskIds.has(s.entityId) && mesas[s.entityId] && near(s, me, 40));
    if (seat) return show(`desk-near-${seat.entityId}`, `Mesa de ${mesas[seat.entityId].name}`);
    if (message.key?.startsWith('desk-')) show(null);
  };

  // ------------------------------------------------------------------------------------------- rooms
  const roomOf = p => rooms.find(r => inside(p, r.rect)) || null;
  const saveRooms = next => { salas = next; return WA.state.saveVariable('salas', JSON.stringify(next)).catch(() => {}); };
  const applyLocks = () => {
    for (const room of rooms) {
      const locked = Boolean(salas[room.key]?.locked);
      (locked ? WA.room.showLayer : WA.room.hideLayer)(room.layer);
      interactions?.setLocked(room.doors, locked);
    }
  };
  let lockButtonFor = null;
  const lockButton = () => {
    const room = roomOf(me);
    const key = room ? `${room.key}:${Boolean(salas[room.key]?.locked)}` : null;
    if (key === lockButtonFor) return;
    lockButtonFor = key;
    WA.ui.actionBar.removeButton('trancar-sala');
    if (!room) return;
    const locked = Boolean(salas[room.key]?.locked);
    WA.ui.actionBar.addButton({ id: 'trancar-sala', label: locked ? 'Destrancar sala' : 'Trancar sala', callback: () => {
      saveRooms({ ...salas, [room.key]: locked ? { locked: false } : { locked: true, by: uuid, name: myName } });
      applyLocks();
      lockButtonFor = null;
      lockButton();
    } });
  };
  let lastRoom = roomOf(me);
  const autoUnlock = () => {
    const room = roomOf(me);
    if (lastRoom && lastRoom !== room && salas[lastRoom.key]?.by === uuid) {
      const someone = [...WA.players.list()].some(p => inside(p.position, lastRoom.rect));
      if (!someone) { saveRooms({ ...salas, [lastRoom.key]: { locked: false } }); applyLocks(); }
    }
    lastRoom = room;
  };
  const knockPrompt = () => {
    if (roomOf(me)) return;
    const room = rooms.find(r => salas[r.key]?.locked && r.doorCenters.some(c => near({ x: c[0], y: c[1] }, me, 2 * T)));
    if (room) return show(`knock-${room.key}`, `${room.name} está trancada · ESPAÇO para bater`, () => {
      WA.event.broadcast('office-knock', { room: room.key, name: myName }).catch(() => {});
      message.key = null;
    });
    if (message.key?.startsWith('knock-')) show(null);
  };
  WA.event.on('office-knock').subscribe(({ data }) => {
    const room = rooms.find(r => r.key === data?.room);
    if (!room || roomOf(me) !== room) return;
    const name = typeof data.name === 'string' ? data.name.slice(0, 40) : 'Alguém';
    show(`open-${room.key}`, `${name} está na porta · ESPAÇO para abrir`, () => {
      saveRooms({ ...salas, [room.key]: { locked: false } });
      applyLocks();
      message.key = null;
    });
  });

  // ------------------------------------------------------------------------------------------- reactions
  let reactionCount = 0;
  const react = async (kind, x, y) => {
    const name = `reacao-${kind}-${Date.now()}-${reactionCount += 1}`;
    const site = await WA.room.website.create({ name, url: `${reactionsUrl}?kind=${kind}`, visible: true, allowApi: false,
      origin: 'map', scale: 1, position: { x: Math.round(x - 48), y: Math.round(y - 112), width: 96, height: 96 } });
    setTimeout(() => (site?.remove ? site.remove() : WA.room.website.delete(name)), 1800);
  };
  for (const [kind, label] of [['palmas', 'Aplaudir'], ['confete', 'Confete']]) {
    WA.ui.actionBar.addButton({ id: `reagir-${kind}`, label, callback: () => {
      react(kind, me.x, me.y);
      WA.event.broadcast('office-react', { kind, x: me.x, y: me.y }).catch(() => {});
    } });
  }
  WA.event.on('office-react').subscribe(({ data }) => {
    if (['palmas', 'confete'].includes(data?.kind) && Number.isFinite(data.x) && Number.isFinite(data.y)) {
      react(data.kind, data.x, data.y);
    }
  });

  // ------------------------------------------------------------------------------------------- ambience
  // Each source plays at its ideal `volume` inside its `rect` and fades to silence over `falloff` px (build.py). Once
  // the page's theme/hud-audio.js announces 'audio' (page.mjs), the fade is the page's: the map script hands it the
  // sources and the on/off switch and plays nothing itself. Without it, WA.sound plays a source at its volume inside the
  // rect grown by half the falloff, as before (WA.sound cannot change the volume of a playing sound); at arrival it
  // waits a moment for the page to answer, so the sound never starts at full volume and then jumps to the fade.
  const PAGE_GRACE_MS = 4000;
  let ambientOn = true, playing = null, viaPage = false, graceOver = false;
  const sounds = new Map();
  const sound = file => (sounds.has(file) ? sounds.get(file) : sounds.set(file, WA.sound.loadSound(`${soundsBase}${file}`)).get(file));
  const grow = (r, by) => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });
  const ambient = () => {
    const zone = ambientOn && graceOver && !viaPage
      ? ambience.find(z => inside(me, grow(z.rect, (z.falloff || 0) / 2))) : null;
    if ((zone?.file || null) === (playing?.file || null)) return;
    playing?.sound.stop();
    playing = zone ? { file: zone.file, sound: sound(zone.file) } : null;
    playing?.sound.play({ loop: true, volume: zone.volume ?? 0.25 });
  };
  page?.onFeature('audio', () => {
    viaPage = true;
    ambient();                                        // stops a WA.sound loop already playing
    page.post({ kind: 'ambience', on: ambientOn, base: soundsBase,
      sources: ambience.map(({ file, volume, rect, falloff }) => ({ file, volume, rect, falloff })) });
  });
  setTimeout(() => { graceOver = true; ambient(); }, PAGE_GRACE_MS);
  const ambientButton = () => {
    WA.ui.actionBar.removeButton('som-ambiente');
    WA.ui.actionBar.addButton({ id: 'som-ambiente', label: `Som ambiente: ${ambientOn ? 'ligado' : 'desligado'}`,
      callback: () => {
        ambientOn = !ambientOn;
        ambient();
        if (viaPage) page.post({ kind: 'ambience', on: ambientOn });
        ambientButton();
      } });
  };
  ambientButton();

  // ------------------------------------------------------------------------------------------- wiring
  onSeatChange(seat => { seatedId = seat ? seat.id : null; message.stale = true; deskPrompt(); });
  WA.state.onVariableChange('mesas').subscribe(v => { mesas = parse(v); myDeskButton(); message.stale = true; deskPrompt(); });
  WA.state.onVariableChange('salas').subscribe(v => { salas = parse(v); applyLocks(); lockButtonFor = null; lockButton(); });
  WA.player.onPlayerMove(event => {
    me = { x: event.x, y: event.y };
    autoUnlock();
    lockButton();
    knockPrompt();
    deskPrompt();
    ambient();
  });
  applyLocks();
  myDeskButton();
  lockButton();
  ambient();
  return {
    snapshot: () => ({ mesas, salas, seated: seatedId, prompt: message.key, myDesk: deskOf(mesas, uuid) }),
    lock: (key, locked) => { saveRooms({ ...salas, [key]: locked ? { locked: true, by: uuid, name: myName } : { locked: false } }); applyLocks(); },
    reserve: chair => saveDesks(reserve(mesas, chair, uuid, myName)).then(myDeskButton),
    // Claim the desk chair `chair` (a deskIds entity id) through the reserve path; false when someone else owns it.
    claim: chair => {
      if (!deskIds.has(chair)) return false;
      const next = claim(mesas, chair, uuid, myName);
      if (!next) return false;
      if (next !== mesas) saveDesks(next).then(myDeskButton);
      return true;
    },
    // The desk chairs with their current seats (position and facing), for the HUD page; side cushions never desks.
    deskSeats: () => seating.seats()
      .filter(s => deskIds.has(s.entityId) && s.id === `chair:${s.entityId}`)
      .map(s => ({ id: s.entityId, x: s.x, y: s.y, direction: s.direction })),
    goToMyDesk: () => { const c = deskOf(mesas, uuid); const s = c && seatById(`chair:${c}`); return s ? seating.walkTo(s) : null; },
    react: kind => react(kind, me.x, me.y),
    showDeskButton: on => { deskButtonShown = Boolean(on); myDeskButton(); },
  };
}
