/**
 * Pure part of the office HUD (hud.mjs): where someone is, who is around, which moment the visitor is in, and the
 * room-wide presence roster. No WorkAdventure dependency; tested in hud-core.test.mjs.
 */
export const T = 32;
export const HALL = 'Hall';
export const ENTRANCE = 'Entrada';
export const OUTSIDE = 'Área externa';
export const MOMENTS = ['andando', 'mesa', 'conversa', 'jogo'];
export const PRESENCE_TTL_MS = 45000;
// Presence is a broadcast: every browser hears every other one, so what a room moves grows with the square of its
// people (measured 11/11/2026: a fixed 15 s heartbeat is 67 messages a second to each of 1000 visitors). The room as a
// whole sends at most PRESENCE_RATE presences a second: each browser's share of that is its gap, whatever the room's
// size, so every visitor hears a bounded stream and the people list simply gets coarser as the office fills up.
export const PRESENCE_RATE = 10;
export const PRESENCE_HEARTBEAT_MS = 15000;
export const NEAR_RADIUS_PX = 8 * T;

/** Named areas of a WAM, smallest first, so a booth wins over the hall area around it. The unnamed arrival area (the
 * one with a `start` property) is the entrance. */
export function namedAreas(wam) {
  const isStart = a => (a?.properties || []).some(p => p?.type === 'start');
  const nameOf = a => (typeof a?.name === 'string' && a.name.trim()) || (isStart(a) ? ENTRANCE : '');
  return (wam?.areas || [])
    .filter(nameOf)
    .map(a => ({ name: nameOf(a), x: a.x, y: a.y, width: a.width, height: a.height, entrance: isStart(a) }))
    .sort((a, b) => a.width * a.height - b.width * b.height);
}

const holds = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;

/** Name of the place at pixel (x, y): the smallest named area holding it; else the hall when it is inside the
 * building (the box around the named rooms), else outside. */
export function placeAt(areas, x, y) {
  const area = areas.find(a => holds(a, x, y));
  if (area) return area.name;
  const rooms = areas.filter(a => !a.entrance);
  if (!rooms.length) return HALL;
  const left = Math.min(...rooms.map(a => a.x)), top = Math.min(...rooms.map(a => a.y));
  const building = { x: left, y: top, width: Math.max(...rooms.map(a => a.x + a.width)) - left,
    height: Math.max(...rooms.map(a => a.y + a.height)) - top };
  return holds(building, x, y) ? HALL : OUTSIDE;
}

/** The visitor's moment, by priority: a game over everything, then a conversation, then sitting at a desk. */
export function momentOf({ game = false, conversation = 0, atDesk = false } = {}) {
  if (game) return 'jogo';
  if (conversation > 0) return 'conversa';
  if (atDesk) return 'mesa';
  return 'andando';
}

/** What one browser broadcasts about itself. `ask` asks everyone else to answer with theirs. */
export function presenceMessage({ name, x, y, moment, ask = false }) {
  return { v: 1, name: String(name || 'Alguém').slice(0, 40), x: Math.round(x), y: Math.round(y), moment,
    ...(ask ? { ask: true } : {}) };
}

/** A presence read from an untrusted event payload, or null. */
export function readPresence(data) {
  if (!data || data.v !== 1) return null;
  const x = Number(data.x), y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 40) : 'Alguém';
  return { name, x, y, moment: MOMENTS.includes(data.moment) ? data.moment : 'andando', ask: data.ask === true };
}

/** The shortest wait between two presences of one browser in a room of `people`: 1 s up to 10, 3 s at 30, 100 s at 1000. */
export function presenceGap(people) {
  return Math.max(1000, Math.ceil(Math.max(1, people) / PRESENCE_RATE) * 1000);
}

/** How often a browser with nothing new still says it is here: 15 s up to 150 people, then its gap. */
export function presenceHeartbeat(people) {
  return Math.max(PRESENCE_HEARTBEAT_MS, presenceGap(people));
}

/** After how long of silence someone is forgotten: three heartbeats (45 s up to 150 people). */
export function presenceTtl(people) {
  return 3 * presenceHeartbeat(people);
}

/**
 * Paces one browser's presences. `request()` sends at once when the browser's share of the room's rate allows it;
 * otherwise once, at the end of the wait, with whatever is true by then (`send` reads the state when it runs). An
 * `ask` waiting for its turn is kept. `due()` says when the heartbeat is owed.
 */
export function createPresencePacer({ send, people, now = Date.now, later = setTimeout, cancel = clearTimeout }) {
  let sentAt = -Infinity, timer = null, ask = false;
  const fire = () => {
    timer = null;
    sentAt = now();
    const asking = ask;
    ask = false;
    send(asking);
  };
  return {
    request(asking = false) {
      ask ||= asking;
      const wait = sentAt + presenceGap(people()) - now();
      if (wait > 0) { timer ??= later(fire, wait); return; }
      if (timer !== null) cancel(timer);
      fire();
    },
    due: () => now() - sentAt >= presenceHeartbeat(people()),
  };
}

/** The other visitors of the room by player id. Anyone silent for longer than `ttl` ms is forgotten. */
export function createRoster(ttl = PRESENCE_TTL_MS) {
  const entries = new Map();
  return {
    upsert(id, { name, x, y, moment }, now) { entries.set(id, { id, name, x, y, moment, seenAt: now }); },
    move(id, x, y) {
      const entry = entries.get(id);
      if (entry) Object.assign(entry, { x, y });
    },
    get: id => entries.get(id),
    prune(now, silence = ttl) {
      for (const [id, entry] of entries) if (now - entry.seenAt > silence) entries.delete(id);
    },
    list: () => [...entries.values()],
  };
}

/** The people list of the HUD: place and nearness of each visitor, nearest first. */
export function describePeople(people, me, areas, radius = NEAR_RADIUS_PX) {
  return people
    .map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, moment: p.moment, place: placeAt(areas, p.x, p.y),
      distance: Math.hypot(p.x - me.x, p.y - me.y) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'pt-BR'))
    .map(({ distance, ...person }) => ({ ...person, near: distance <= radius }));
}

/** Label of the desk the visitor sits at: theirs, someone's, or free. */
export function deskLabel(chair, desks, myDesk) {
  if (chair && chair === myDesk) return 'Sua mesa';
  const owner = desks?.[chair]?.name;
  return owner ? `Mesa de ${owner}` : 'Mesa livre';
}

const DESK_UP = new Set(['up', 'north', 'top']);
const DESK_DOWN = new Set(['down', 'south', 'bottom']);

/** Tiles of a workstation desk (3x2) derived from its chair seat: the chair faces up and sits in the bottom row at
 * (deskX+1, deskY+1); a booth chair faces down and sits above its desk at (deskX+1, deskY-1). Null for side-cushion
 * seats (`chair:<entity>:<n>`, never desks) and for seats facing any other way. */
export function deskRect(seat) {
  const { id, entityId, x, y, direction } = seat || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (typeof id === 'string') {
    const cushion = entityId === undefined ? /^chair:.+:\d+$/.test(id) : id !== `chair:${entityId}`;
    if (cushion) return null;
  }
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (DESK_UP.has(direction)) return { x: tx - 1, y: ty - 1, w: 3, h: 2 };
  if (DESK_DOWN.has(direction)) return { x: tx - 1, y: ty + 1, w: 3, h: 2 };
  return null;
}

/** The desk whose rect holds tile (tileX, tileY), or null. */
export function deskAtTile(desks, tileX, tileY) {
  return (desks || []).find(d => d?.rect && tileX >= d.rect.x && tileY >= d.rect.y
    && tileX < d.rect.x + d.rect.w && tileY < d.rect.y + d.rect.h) || null;
}

// The camera is away from you when its centre is more than a tile and a half from where it would be following you
// (your position, held inside the map's edges, where the camera stops), or when its zoom differs from the default one
// (`home`, the world-view height seen while following) by more than 5%. Then the view offers "Centralizar em mim".
export function cameraAway(view, me, home, map) {
  if (!view || !me || !(view.width > 0) || !(view.height > 0)) return false;
  const hold = (value, half, size) => (size > 2 * half ? Math.min(Math.max(value, half), size - half) : size / 2);
  const x = map ? hold(me.x, view.width / 2, map.width) : me.x;
  const y = map ? hold(me.y, view.height / 2, map.height) : me.y;
  const off = Math.hypot(view.x + view.width / 2 - x, view.y + view.height / 2 - y) > 1.5 * T;
  return off || (home > 0 && Math.abs(view.height - home) / home > 0.05);
}
