/** Pure, deterministic local seat selection. No browser or WorkAdventure globals. */
export const CLAIM_KEY = 'koncluiSeatV1';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => p && finite(p.x) && finite(p.y);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p, r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
// The way the woka looks (its last step). A seat within 45° of it counts as FACING_BONUS px nearer, so walking up
// to a chair picks that chair rather than a neighbour at almost the same distance (adversarial review 2026-10-13:
// half of the approaches got the neighbouring chair on nearest-anchor alone).
const LOOK = { up: [0, -1], top: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const FACING_BONUS = 12;

export function validateSeats(seats) {
  if (!Array.isArray(seats)) throw new Error('seats must be an array');
  const ids = new Set();
  for (const seat of seats) {
    if (typeof seat.id !== 'string' || !seat.id || ids.has(seat.id) || !point(seat)) {
      throw new Error('Every seat requires a unique id and finite pixel coordinates');
    }
    if (seat.silentRadius !== undefined && (!finite(seat.silentRadius) || seat.silentRadius < 0)) {
      throw new Error(`Invalid silentRadius: ${seat.id}`);
    }
    ids.add(seat.id);
  }
  return seats.map(seat => ({ ...seat }));
}

const STEP = { up: [0, -1], north: [0, -1], top: [0, -1], down: [0, 1], south: [0, 1],
  left: [-1, 0], west: [-1, 0], right: [1, 0], east: [1, 0] };

/** Blocked tiles as the engine sees them: the map's collision tiles plus every placed piece's collision grid. */
function blockedTiles(collision, wam) {
  if (!collision) return null;
  const blocked = new Set(collision.blocked);
  for (const entity of Object.values(wam.entities)) {
    const grid = collision.prefabs?.[`${entity.prefabRef?.collectionName}/${entity.prefabRef?.id}`];
    if (!grid || !point(entity)) continue;
    const tx = Math.floor(entity.x / collision.tile), ty = Math.floor(entity.y / collision.tile);
    grid.forEach((row, r) => row.forEach((solid, c) => { if (solid) blocked.add((ty + r) * collision.width + tx + c); }));
  }
  return blocked;
}

/** With the map's collision: is the seat reachable (its own tile and the tile behind it free) and which free tile
 *  to come from so the woka enters the tile behind from outside it: the far side first, then either side. */
function approach(seat, blocked, collision) {
  const step = STEP[seat.direction];
  if (!blocked || !step) return {};
  const [dx, dy] = step, t = collision.tile, w = collision.width;
  const tx = Math.floor(seat.x / t), ty = Math.floor(seat.y / t);
  const free = (x, y) => x >= 0 && x < w && y >= 0 && !blocked.has(y * w + x);
  const bx = tx - dx, by = ty - dy;
  if (!free(tx, ty) || !free(bx, by)) return { reachable: false };
  const entry = [[bx - dx, by - dy], [bx + dy, by + dx], [bx - dy, by - dx]].find(([x, y]) => free(x, y));
  return { reachable: true, entry: entry ? { tx: entry[0], ty: entry[1] } : null };
}

/** Current WAM positions are authoritative, including deletions and duplicated chairs. */
export function resolveSeats(config, wam) {
  if (!wam || !wam.entities || typeof wam.entities !== 'object' || Array.isArray(wam.entities)) {
    throw new Error('Current WAM must contain an entities object');
  }
  const configured = new Map((config.seats || []).map(s => [s.entityId, s]));
  const blocked = blockedTiles(config.collision, wam);
  const result = [];
  for (const [entityId, entity] of Object.entries(wam.entities)) {
    const template = (config.prefabSeats || []).find(p =>
      p.collectionName === entity.prefabRef?.collectionName && p.prefabId === entity.prefabRef?.id);
    const original = configured.get(entityId);
    // A known UUID changed to a non-chair prefab must stop behaving as a seat.
    if (config.prefabSeats?.length && !template) continue;
    if (!template && !original) continue;
    if (!point(entity)) throw new Error(`Invalid chair position: ${entityId}`);
    const seat = { ...template, ...original,
      anchorOffset: template?.anchorOffset ?? original?.anchorOffset,
      direction: template?.direction ?? original?.direction };
    if (!point(seat.anchorOffset)) throw new Error(`Missing anchorOffset: ${entityId}`);
    const x = entity.x + seat.anchorOffset.x, y = entity.y + seat.anchorOffset.y;
    const room = (config.rooms || []).find(r => inside({ x, y }, r));
    const kind = template?.fixedKind ?? room?.kind ?? seat.kind;
    // Recompute room membership after a move; do not retain a stale room restriction.
    result.push({ ...seat, ...approach({ x, y, direction: seat.direction }, blocked, config.collision),
      id: original?.id || `chair:${entityId}`, entityId, x, y, kind,
      room: room?.id ?? (config.rooms?.length ? null : seat.room),
      silentRadius: room?.silentRadius ?? seat.silentRadius ?? (['work', 'focus'].includes(kind) ? 64 : 0) });
  }
  return validateSeats(result);
}

export function validClaim(value, actorId, seats) {
  return value && value.v === 1 && value.actorId === String(actorId) &&
    ['pending', 'seated'].includes(value.phase) && typeof value.seatId === 'string' &&
    point(value) && seats.some(s => s.id === value.seatId && distance(s, value) < 1);
}

/** Not an authoritative lock: remote observations can arrive late or be culled. */
export class SeatClient {
  constructor({ actorId, seats, position, radius = 64, occupancyRadius = 12, rooms = [] }) {
    if (!point(position) || !finite(radius) || radius <= 0) throw new Error('Invalid client position/radius');
    this.actorId = String(actorId);
    this.seats = validateSeats(seats);
    this.position = { ...position };
    this.radius = radius;
    this.occupancyRadius = occupancyRadius;
    this.rooms = rooms;
    this.peers = new Map();
    this.claim = null;
    this.origin = null;
    this.facing = null;
  }
  setFacing(direction) { this.facing = LOOK[direction] ? direction : null; }
  score(seat) {
    const d = distance(this.position, seat), look = LOOK[this.facing];
    if (!look) return d;
    const dx = seat.x - this.position.x, dy = seat.y - this.position.y;
    const along = dx * look[0] + dy * look[1], across = Math.abs(dx * look[1] - dy * look[0]);
    return along > 0 && along >= across ? d - FACING_BONUS : d;
  }
  get seat() { return this.seats.find(s => s.id === this.claim?.seatId); }
  updatePeer(actorId, position, claim = null) {
    if (String(actorId) === this.actorId || !point(position)) return;
    this.peers.set(String(actorId), { actorId: String(actorId), position: { ...position },
      claim: validClaim(claim, actorId, this.seats) ? { ...claim } : null });
  }
  removePeer(actorId) { this.peers.delete(String(actorId)); }
  updateSeats(seats) {
    this.seats = validateSeats(seats);
    if (this.claim && !validClaim(this.claim, this.actorId, this.seats)) return this.release('chair-edited');
    return null;
  }
  setPosition(position) {
    if (!point(position)) throw new Error('Invalid player position');
    this.position = { x: position.x, y: position.y };
    const reference = this.claim?.phase === 'seated' ? this.seat : this.origin;
    if (this.claim && (!reference || distance(position, reference) > 12)) return this.release('walked-away');
    return null;
  }
  candidates(excluded = new Set()) {
    const room = this.rooms.find(r => inside(this.position, r));
    // A seat known to be unreachable (its tile or the tile behind it blocked, e.g. a chair put against a wall in
    // the editor) is never offered: the woka could only sit there with a jump.
    return this.seats.filter(seat => !excluded.has(seat.id) && seat.reachable !== false &&
      distance(this.position, seat) <= this.radius &&
      (!this.rooms.length || seat.room === room?.id) &&
      ![...this.peers.values()].some(peer =>
        peer.claim?.seatId === seat.id || distance(peer.position, seat) <= this.occupancyRadius))
      .sort((a, b) => this.score(a) - this.score(b) || a.id.localeCompare(b.id));
  }
  begin(excluded) {
    if (this.claim) return null;
    const seat = this.candidates(excluded)[0];
    if (!seat) return null;
    this.origin = { ...this.position };
    this.claim = { v: 1, actorId: this.actorId, seatId: seat.id, phase: 'pending', x: seat.x, y: seat.y };
    return seat;
  }
  winner() {
    if (!this.claim) return null;
    const contenders = [this.claim, ...[...this.peers.values()].map(p => p.claim)]
      .filter(c => c?.seatId === this.claim.seatId);
    // Existing seated people beat new claims; equal phases use a total, stable order.
    contenders.sort((a, b) => Number(b.phase === 'seated') - Number(a.phase === 'seated') ||
      a.actorId.localeCompare(b.actorId, 'en', { numeric: true }));
    return contenders[0]?.actorId;
  }
  commit() {
    if (!this.claim || this.winner() !== this.actorId) return null;
    const seat = this.seat;
    if ([...this.peers.values()].some(p => !p.claim && distance(p.position, seat) <= this.occupancyRadius)) return null;
    this.claim = { ...this.claim, phase: 'seated' };
    return seat;
  }
  reconcile() {
    return this.claim && this.winner() !== this.actorId ? this.release('contention') : null;
  }
  release(reason = 'stood-up') {
    const previous = this.claim && { claim: this.claim, origin: this.origin, reason };
    this.claim = null;
    this.origin = null;
    return previous;
  }
  isQuiet() {
    return this.seats.some(s => s.silentRadius > 0 &&
      (!this.rooms.length || this.rooms.some(room => room.id === s.room && inside(this.position, room))) &&
      distance(this.position, s) <= s.silentRadius);
  }
}
