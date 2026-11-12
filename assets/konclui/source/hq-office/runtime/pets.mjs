/**
 * The office pets' part of the map script (installed by map-script.js; nothing runs on import). The page's runtime
 * (theme/pets/) draws the pets and decides what they do; this part only does what needs WA's scripting API:
 *   name    the visitor's pet name as the PUBLIC player variable officePet = {v: 1, name}, written when the page asks
 *           (intent 'pet-name'); the page keeps the name in the browser and sends it again on every load, so it is
 *           not persisted here
 *   events  the room's pet events (WA.event 'officePet': pet, throw, pick, return) go out from the page's intent
 *           'pet-action' and come back to every page as {kind: 'pet-event', event: {..., senderId}}. The sender's own
 *           echo is dropped by event id (its page already played it); a petter pets once per 1.5 s (1.2 s on receipt,
 *           for network jitter); a throw, pick or return counts only from the pet's owner
 *   bell    a ring of the sales bell (a manual ring or a real sale) reaches the page as {kind: 'celebrate'}: every pet on
 *           screen celebrates, never tied to the seller
 *   hello   {kind: 'pet-hello', me, uuid, name} tells the page who the visitor is (WA's player id, the key of every
 *           remote player on the page), every 2 s until the page answers 'pet-ready'; 'pet-hi' asks for it again
 * Every message uses the HUD protocol of page.mjs ({konclui: 'hud', kind}, no `type` field).
 */
import { BELL_EVENT, SALE_EVENT } from './bell.mjs';

export const PET_EVENT = 'officePet';
export const PET_VARIABLE = 'officePet';
export const PET_GAP_MS = 1500;
export const RECEIPT_GAP_MS = 1200;
export const NAME_MAX = 20;
const HELLO_EVERY_MS = 2000;
const HELLO_ATTEMPTS = 60;
const RING_GAP_MS = 2500;
const ID = /^[\w.:-]{4,64}$/;

/** A pet name: control characters removed, spaces collapsed, trimmed, 1 to 20 characters; else null. Pure, tested. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/ +/g, ' ').trim();
  const n = [...s].length;
  return n >= 1 && n <= NAME_MAX ? s : null;
}

const point = p => (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e5 && Math.abs(p.y) < 1e5
  ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
const playerId = v => (Number.isInteger(v) && v >= 0 ? v : null);

/** A pet event read from an untrusted payload sent by `senderId`, or null (theme/pets/core.mjs readEvent, same rules).
 * Pure, tested. */
export function readPetEvent(data, senderId) {
  if (!data || typeof data !== 'object' || !ID.test(String(data.id || ''))) return null;
  const id = String(data.id);
  const owner = playerId(data.owner);
  if (owner === null) return null;
  if (data.kind === 'pet') {
    const by = playerId(senderId);
    return by === null ? null : { id, kind: 'pet', owner, by };
  }
  if (senderId !== owner) return null;
  if (data.kind === 'throw') {
    const from = point(data.from), to = point(data.to);
    return from && to ? { id, kind: 'throw', owner, from, to, at: Number.isFinite(data.at) ? data.at : undefined } : null;
  }
  if ((data.kind === 'pick' || data.kind === 'return') && ID.test(String(data.ball || ''))) {
    const to = point(data.to);
    if (data.kind === 'return' && !to) return null;
    return { id, kind: data.kind, owner, ball: String(data.ball), ...(data.kind === 'return' ? { to } : {}) };
  }
  return null;
}

/** What goes out and what comes in, for the visitor `me`: ids seen once, petting rate-limited per petter. Pure but for
 * its memory, tested. */
export function createRelay(me, { maxIds = 256 } = {}) {
  const ids = new Set();
  const lastPet = new Map();
  const remember = id => {
    if (ids.has(id)) return false;
    ids.add(id);
    if (ids.size > maxIds) ids.delete(ids.values().next().value);
    return true;
  };
  const gate = (by, now, gap) => {
    const at = lastPet.get(by);
    if (at !== undefined && now - at < gap) return false;
    lastPet.set(by, now);
    return true;
  };
  return {
    /** The event to broadcast for the page's action, or null (invalid, repeated, or petting too soon). */
    outgoing(data, now) {
      const ev = readPetEvent(data, me);
      if (!ev || (ev.kind === 'pet' && !gate(me, now, PET_GAP_MS)) || !remember(ev.id)) return null;
      return ev;
    },
    /** The event to hand to the page for a room event, or null (invalid, our own echo, or petting too soon). */
    incoming(data, senderId, now) {
      const ev = readPetEvent(data, senderId);
      if (!ev || ids.has(ev.id)) return null;
      if (ev.kind === 'pet' && senderId !== me && !gate(senderId, now, RECEIPT_GAP_MS)) return null;
      remember(ev.id);
      return ev;
    },
  };
}

export async function installPets(WA, { page }) {
  await WA.onInit();
  const me = WA.player.playerId;
  const relay = createRelay(me);
  const counts = { hello: 0, sent: 0, received: 0, dropped: 0, celebrations: 0 };
  let ready = false, name = null;
  const hello = () => page.post({ kind: 'pet-hello', v: 1, me, uuid: WA.player.uuid || null, name: WA.player.name || '' });
  const greet = () => {
    if (ready || counts.hello >= HELLO_ATTEMPTS) return;
    counts.hello += 1;
    hello();
    setTimeout(greet, HELLO_EVERY_MS);
  };
  page.onIntent('pet-ready', () => { ready = true; });
  page.onIntent('pet-hi', () => hello());
  page.onIntent('pet-name', intent => {
    name = cleanName(intent.name);
    Promise.resolve(WA.player.state.saveVariable(PET_VARIABLE, name ? { v: 1, name } : null, { public: true, persist: false }))
      .catch(error => console.error('pets name', error));
  });
  page.onIntent('pet-action', intent => {
    const ev = relay.outgoing(intent.event, Date.now());
    if (!ev) { counts.dropped += 1; return; }
    counts.sent += 1;
    Promise.resolve(WA.event.broadcast(PET_EVENT, ev)).catch(error => console.error('pets event', error));
  });
  WA.event.on(PET_EVENT).subscribe(({ data, senderId }) => {
    const ev = relay.incoming(data, senderId, Date.now());
    if (!ev) return;
    counts.received += 1;
    page.post({ kind: 'pet-event', event: { ...ev, senderId } });
  });
  let lastRing = 0;
  const celebrate = () => {
    const now = Date.now();
    if (now - lastRing < RING_GAP_MS) return;          // one ring heard twice (a sale and its card) celebrates once
    lastRing = now;
    counts.celebrations += 1;
    page.post({ kind: 'pet-event', event: { id: `ring-${now.toString(36)}`, kind: 'celebrate' } });
  };
  WA.event.on(BELL_EVENT).subscribe(() => celebrate());
  WA.event.on(SALE_EVENT).subscribe(({ senderId }) => { if (senderId === undefined) celebrate(); });
  greet();
  return { snapshot: () => ({ ready, name, ...counts }) };
}
