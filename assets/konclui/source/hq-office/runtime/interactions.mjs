/**
 * The office's interactions for WorkAdventure 1.34.1 (the map script installs them; nothing runs on import):
 *   doors     sliding glass doors that open while someone is within two tiles and close after (they open as
 *             people walk up); frames are tiles of the "doors" layer, swapped with WA.room.setTiles, per browser,
 *             from the positions every browser already tracks
 *   games     standing next to the arcade, the ping-pong or the pool table offers "ESPAÇO para jogar", which opens the
 *             game (map/campus_web/games) in a modal with the scripting API
 *   people    clicking someone offers "Acenar" (a wave they see, with a shortcut to walk to you) and "Ir até" (walk
 *             there)
 * Whiteboards, capacity, the spotlight and the room calls are WAM properties (build.py), not script.
 */
const T = 32;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Doors to open: those with any of the positions within `radius` px of their middle. Pure, tested. */
export function doorsToOpen(doors, positions, radius = 2 * T) {
  return new Set(doors.filter(d => positions.some(p => Math.hypot(p.x - d.center[0], p.y - d.center[1]) <= radius))
    .map(d => d.id));
}

/** The game spot a position stands in, or null; where spots overlap (terminals side by side), the one whose object is
 * nearest: a spot's rect is its object's picture grown by a tile each side (build.py). Pure, tested. */
export function spotAt(spots, x, y) {
  const inside = spots.filter(s => x >= s.rect.x && y >= s.rect.y && x < s.rect.x + s.rect.width
    && y < s.rect.y + s.rect.height);
  const away = (s) => {
    const x0 = s.rect.x + T, y0 = s.rect.y + T, x1 = s.rect.x + s.rect.width - T, y1 = s.rect.y + s.rect.height - T;
    return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  };
  return inside.reduce((best, s) => (best && away(best) <= away(s) ? best : s), null);
}

export async function installInteractions(WA, { doors = [], games = [], gamesBase }, { frameMs = 55, onGame = () => {} } = {}) {
  await WA.onInit();
  await WA.players.configureTracking({ players: true, movement: true }).catch(() => {});
  let me = await WA.player.getPosition();

  // Doors: each door animates from its current frame towards open (last) or closed (0), one frame per tick.
  const state = new Map(doors.map(d => [d.id, { frame: 0, target: 0 }]));
  const put = (door, frame) => WA.room.setTiles(door.cells.map(([x, y], i) => ({
    x, y, tile: door.frames[frame][i] || null, layer: 'doors' })));
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (let moving = true; moving;) {
        moving = false;
        for (const door of doors) {
          const s = state.get(door.id);
          if (s.frame === s.target) continue;
          s.frame += Math.sign(s.target - s.frame);
          put(door, s.frame);
          moving = true;
        }
        if (moving) await sleep(frameMs);
      }
    } finally {
      ticking = false;
    }
  };
  const locked = new Set();                         // doors of locked rooms stay shut (social.mjs)
  const refreshDoors = () => {
    const positions = [me, ...[...WA.players.list()].map(p => p.position).filter(Boolean)];
    const open = doorsToOpen(doors.filter(d => !locked.has(d.id)), positions);
    for (const door of doors) state.get(door.id).target = open.has(door.id) ? door.frames.length - 1 : 0;
    tick();
  };

  // Games: one prompt at a time, replaced when the visitor walks to another spot.
  let prompt = null, promptFor = null;
  const refreshGames = () => {
    const spot = spotAt(games, me.x, me.y);
    if (spot?.key === promptFor) return;
    prompt?.remove();
    prompt = null;
    promptFor = spot?.key || null;
    if (!spot) return;
    prompt = WA.ui.displayActionMessage({
      message: `ESPAÇO para jogar ${spot.label}`,
      callback: () => {
        onGame(spot.label);
        WA.ui.modal.openModal({ title: spot.label, src: new URL(`${spot.game}/index.html`, gamesBase).href,
          allowApi: true, allowPolicy: 'fullscreen; autoplay', position: 'center' },
        () => { onGame(null); promptFor = null; refreshGames(); });
      },
    });
  };

  WA.player.onPlayerMove(event => {
    me = { x: event.x, y: event.y };
    refreshDoors();
    refreshGames();
  });
  WA.players.onPlayerMoves.subscribe(() => refreshDoors());
  refreshDoors();
  refreshGames();

  // People: wave and go to (a click on a person). Optional: doors and games keep working without it.
  try {
    installPeople(WA);
  } catch (error) {
    console.error('people actions', error);
  }
  return {
    snapshot: () => ({ doors: Object.fromEntries([...state].map(([id, s]) => [id, s.frame])), prompt: promptFor,
      locked: [...locked] }),
    setLocked: (ids, on) => { for (const id of ids) (on ? locked.add(id) : locked.delete(id)); refreshDoors(); },
  };
}

function installPeople(WA) {
  WA.ui.onRemotePlayerClicked.subscribe(remote => {
    remote.addAction('Acenar', () => Promise.resolve(remote.sendEvent?.('office-wave', { name: WA.player.name }))
      .catch(() => {}));
    remote.addAction('Ir até', () => {
      const p = WA.players.get(remote.playerId)?.position || remote.position;
      if (p) WA.player.moveTo(p.x, p.y + T).catch(() => {});
    });
  });
  WA.event.on('office-wave').subscribe(({ data, senderId }) => {
    const name = typeof data?.name === 'string' ? data.name.slice(0, 40) : 'Alguém';
    const message = WA.ui.displayActionMessage({
      message: `${name} acenou · ESPAÇO para ir até ${name}`,
      callback: () => {
        const p = WA.players.get(senderId)?.position;
        if (p) WA.player.moveTo(p.x, p.y + T).catch(() => {});
      },
    });
    setTimeout(() => message.remove(), 8000);
  });
}
