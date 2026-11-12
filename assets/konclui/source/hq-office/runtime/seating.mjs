/**
 * Automatic sitting for WorkAdventure 1.34.1: walk onto a chair and stop, and the avatar sits on it, facing the way
 * the chair faces; walk away and it is standing again. No key, no menu, no lock while seated.
 *
 * Seats come from the WAM the room serves now (office/runtime/seat-core.mjs resolveSeats: every placed prefab with a
 * seat template), so chairs moved or added in the editor sit too. The pure part (seat-pick.mjs) has no WorkAdventure
 * dependency and is tested in seat-pick.test.mjs.
 *
 * WorkAdventure has no facing API: the last step sets the direction. Settling therefore puts the avatar a few pixels
 * behind the anchor and walks it onto the anchor, so the last step faces the chair's way. Measured on 1.34.1 (see
 * office/runtime/wa-seating.mjs): moveTo(x, y) stops 16 px above y and never in the bottom half of a tile, hence aimY.
 */
import { resolveSeats } from './seat-core.mjs';
import { createWamReader } from './wam.mjs';
import { seatUnder, occupied, settlePlan, settled, aimY, withCushions, posePayload, reseat, rereadDue } from './seat-pick.mjs';

export async function installAutoSeating(WA, config, wamUrl,
  { pollMs = 15000, settleMs = 140, retryMs = 700, onChange = () => {}, readWam = createWamReader(wamUrl) } = {}) {
  await WA.onInit();
  let seats = [], seatsOf = null;
  // The reader downloads the .wam only when it changed (wam.mjs); the seats are worked out again only then.
  const refresh = async ({ force = false } = {}) => {
    const wam = await readWam({ force });
    if (wam === seatsOf) return;
    seats = withCushions(resolveSeats(config, wam));
    seatsOf = wam;
  };
  await refresh().catch(() => {});                       // a failed first read leaves no seats until the next one
  await WA.players.configureTracking({ players: true, movement: true });
  const others = () => [...WA.players.list()].map(p => p.position).filter(Boolean);
  let seated = null, seatedAt = null, busy = false, timer = null;   // seatedAt: where the walk ended (reachY)
  // Everyone's browser draws a seated pose from this public player variable (local gateway patch seated-pose.mjs).
  const publish = value => Promise.resolve(WA.player.state.saveVariable('officeSeat', value, { public: true, persist: false }))
    .catch(() => {});
  publish(null);

  // Settling: one step to the middle of the tile behind the chair (when it is free) and back onto the anchor, so the
  // last step crosses a tile edge facing the chair's way (a scripted move inside one tile wanders off). Measured on
  // 1.34.1, 18/10/2026: the walk ends on the anchor (aimY) facing the chair's way from any side.
  const walk = (x, y) => WA.player.moveTo(x, aimY(y)).catch(() => null);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let lastDirection = null;
  const sit = async seat => {
    busy = true;
    try {
      const { behind, to } = settlePlan(seat);
      // A walk straight onto the chair already ends on it facing its way: no settling. Settling steps out and back in,
      // and out of an area for one person at a time (the booths) the walk back ended on the next tile in 5 of 12 tries
      // (measured 18/10/2026 on 1.34.1; likely the area still counting whoever just stepped out).
      // Otherwise up to two rounds: the engine reports the direction of each step; if the last one did not face the
      // chair's way (a step can finish a few pixels sideways) or did not end on it, settle once more, after retryMs
      // outside.
      for (let round = 0; round < 2 && !settled(await WA.player.getPosition(), seat, lastDirection); round += 1) {
        if (round) await sleep(retryMs);
        if (seat.reachable !== false) await walk(behind.x, behind.y);
        await walk(to.x, to.y);
        await sleep(160);
      }
      // No snapping teleport: a teleport turns the avatar to face down, which undoes the settling step.
      const at = await WA.player.getPosition();
      if (Math.hypot(at.x - to.x, at.y - to.y) <= 8) {
        seated = seat;
        seatedAt = at;
        publish(posePayload(seat, at, wamUrl));
        onChange(seat);
      } else if (seated) {                             // following a moved chair failed: standing, not posed elsewhere
        seated = null;
        publish(null);
        onChange(null);
      }
    } finally {
      busy = false;
    }
  };

  // Every read of the room's map also moves whoever sits along with a chair moved in the editor.
  const follow = () => {
    const next = busy ? null : reseat(seated, seats, others());
    if (next?.stand) {
      seated = null;
      publish(null);
      onChange(null);
    } else if (next?.seat) sit(next.seat);
  };
  // Someone sitting follows their chair on every tick; someone standing reads every fourth one (a minute), which is
  // how a chair added far from every known seat is found. Each read is a HEAD unless the map changed (wam.mjs).
  let tick = 0;
  setInterval(() => { if (rereadDue(tick += 1, seated)) refresh().then(follow).catch(() => {}); }, pollMs);

  let moves = 0;
  WA.player.onPlayerMove(event => {
    moves += 1;
    if (event.direction) lastDirection = event.direction;
    clearTimeout(timer);
    if (busy) return;
    if (seated && Math.hypot(event.x - seatedAt.x, event.y - seatedAt.y) > 4) {
      seated = null;                                   // walked off the chair: standing again
      publish(null);
      onChange(null);
    }
    if (event.moving || seated) return;
    const stop = moves;
    timer = setTimeout(async () => {
      // A chair moved in the editor takes its seat along, and the periodic read can be 15 s old (owner, 18/10/2026: sat
      // 14 px off right after moving one): stopping near a seat reads the room's map again first.
      if (seats.some(s => Math.hypot(s.x - event.x, s.y - event.y) < 64)) await refresh({ force: true }).catch(() => {});
      if (stop !== moves || busy || seated) return;      // walked on meanwhile
      const seat = seatUnder(seats, event.x, event.y);
      if (seat && !occupied(seat, others())) sit(seat);
    }, settleMs);
  });
  return { snapshot: () => ({ seats: seats.length, seated: seated && seated.id, direction: lastDirection }), refresh,
    seats: () => seats, walkTo: seat => walk(seat.x, seat.y) };
}
