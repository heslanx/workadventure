/** Pure part of the automatic sitting (seating.mjs): no WorkAdventure, tested in seat-pick.test.mjs. */
const FACING = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const T = 32;

/** The seat a woka standing at (x, y) is on, or null: the nearest one whose sitting box (one tile around its anchor,
 * from half a tile left and above to half a tile right and below) holds the woka. A grid chair's box is its sitting
 * tile for the woka's body, centred 8 px below its position, as the anchor sits 8 px above the tile's middle: a woka
 * whose feet are on the chair sits even when its position is still in the tile above (owner, 18/10/2026). A chair
 * moved off the grid in the editor carries its box with it. */
/** Whether this tick of the seating timer reads the room's map again: every tick for someone seated (their chair may
 * have moved), every `standingEvery` ticks for someone standing (a chair may have appeared far from any known seat). */
export function rereadDue(tick, seated, standingEvery = 4) {
  return Boolean(seated) || tick % standingEvery === 0;
}

export function seatUnder(seats, x, y) {
  let best = null, nearest = Infinity;
  for (const s of seats) {
    const dx = x - s.x, dy = y - s.y;
    if (dx >= -T / 2 && dx < T / 2 && dy >= -T / 2 && dy < T / 2 && Math.abs(dx) + Math.abs(dy) < nearest) {
      best = s;
      nearest = Math.abs(dx) + Math.abs(dy);
    }
  }
  return best;
}

/** Every cushion of a couch or bench is a seat: resolveSeats gives one seat per piece (its middle cushion) and the
 * build lists the piece's other sitting points in `more`, as anchor offsets from the piece. Each becomes a seat with the
 * piece's facing and room; its approach is not known here, so it has no entry tile. Every seat keeps the piece's corner
 * (`origin`), where its front layer is drawn. */
export function withCushions(seats) {
  return seats.flatMap(seat => {
    if (!seat.anchorOffset) return [seat];
    const origin = { x: seat.x - seat.anchorOffset.x, y: seat.y - seat.anchorOffset.y };
    return [{ ...seat, origin }, ...(seat.more || []).map((offset, i) => ({ ...seat, origin, id: `${seat.id}:${i + 2}`,
      x: origin.x + offset.x, y: origin.y + offset.y, entry: null }))];
  });
}

/** The public seat variable the local gateway's seated-pose patch draws from (local-wa/hot-reload/seated-pose.mjs):
 * the facing; the offset that puts the woka's hips where the piece seats them (`pose.dy` from the anchor, built per
 * piece), measured from where the walk ended; the rows to hide (`pose.crop`); and the piece's front layer at its
 * corner. */
export function posePayload(seat, at, base) {
  const value = { v: 1, direction: seat.direction };
  if (Number.isFinite(seat.pose?.dy)) value.dy = Math.max(-16, Math.min(16, seat.y + seat.pose.dy - at.y));
  if (Number.isInteger(seat.pose?.crop)) value.crop = seat.pose.crop;
  if (seat.front && seat.origin) value.front = { src: new URL(seat.front, base).href, x: seat.origin.x, y: seat.origin.y };
  return value;
}

/** After the room's map is read again, what happens to whoever sits: nothing; sit again on the chair's new spot, when
 * it was moved in the editor by up to a tile and nobody else is there (owner, 18/10/2026); or stand, when the chair is
 * gone, went further or someone else stands on its new spot (review, same day). */
export function reseat(seated, seats, others) {
  if (!seated) return null;
  const fresh = seats.find(s => s.id === seated.id);
  const moved = fresh ? Math.hypot(fresh.x - seated.x, fresh.y - seated.y) : Infinity;
  if (moved <= 1) return null;
  return moved <= T && !occupied(fresh, others) ? { seat: fresh } : { stand: true };
}

/** Someone other than me stands on the anchor. */
export function occupied(seat, others, radius = 12) {
  return others.some(p => Math.hypot(p.x - seat.x, p.y - seat.y) < radius);
}

/** Where to step back to (exactly one tile behind the anchor) and where to walk to: the last step is then a pure move
 * in the seat's direction (stepping back to the tile's middle left a few pixels sideways, and the engine reported
 * that last sliver as the facing). */
export function settlePlan(seat) {
  const [dx, dy] = FACING[seat.direction] || [0, 1];
  const y = reachY(seat.y);
  return { behind: { x: seat.x - dx * T, y: y - dy * T }, to: { x: seat.x, y } };
}

/** A woka already sits as settling would put it: on the settle target (within 8 px, what seating.mjs accepts) and last
 * facing the seat's way. A walk straight onto a chair ends so, and settling would only step out and back in. */
export function settled(at, seat, direction) {
  const { to } = settlePlan(seat);
  return direction === seat.direction && Math.hypot(at.x - to.x, at.y - to.y) <= 8;
}

export const aimY = y => { const top = Math.floor(y / T) * T; return top + Math.min(y - top, 15) + 16; };

/** moveTo ends only in the top 16 px of a tile (aimY). A chair moved in the editor can put its anchor lower in the tile:
 * the reachable spot nearest the anchor is then the tile's last reachable row or the next tile's first (at most 8 px). */
export const reachY = y => {
  const top = Math.floor(y / T) * T, off = y - top;
  return off <= 15 ? y : off - 15 <= T - off ? top + 15 : top + T;
};

