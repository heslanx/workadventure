/**
 * The office HUD for WorkAdventure 1.34.1 (installed by the map script; nothing runs on import). It works out where
 * the visitor is, who is in the office and which moment the visitor is in, and hands that to the HUD view of the page
 * (theme/moment-hud.js, injected by the local gateway) through postMessage. Without the view nothing else changes: the
 * native bar, the "ESPAÇO para…" messages, the "Minha mesa" button and the visitor's status stay as they are.
 *   presence  every browser broadcasts its name, position and moment (WA.event, the whole room, nothing stored) on
 *             arrival, after each walk, on a change of moment and as a heartbeat; WA.players moves the near ones live
 *             (it only sees the viewport's neighbourhood, so it cannot count the office by itself). A broadcast
 *             reaches everyone, so each browser paces its own to its share of the room's rate (hud-core.mjs,
 *             presenceGap): at once in a small office, every 100 s among 1000
 *   moment    jogo (a game modal is open), conversa (a meeting with someone), mesa (sitting at a desk), andando. A bubble
 *             counts its participants from WA's join/leave events; a room call (LiveKit area, stage) counts the people
 *             whose presence is in the same area, because WA reports nobody leaving an area meeting
 *   focus     sitting at a desk sets the status to Ocupado until the visitor stands up or ends the focus in the view
 * Messages carry {konclui: 'hud', kind}; they have no `type` field, which WorkAdventure's own listener would report
 * as an invalid event. kind 'hello', 'state', 'notice' and 'walk' go to the page, 'ready' and 'intent' come back.
 *   walk      the simplified view's double click: intent 'walk' {x, y} walks there; 'walk-cancel' stops on the spot.
 *             The page hears {kind: 'walk', status: 'going' | 'arrived' | 'cancelled' | 'blocked'}
 * The page's other scripts answer the hello with 'feature' (page.mjs): then 'ambience' and 'sound' (social.mjs,
 * bell.mjs) go to theme/hud-audio.js, which also reads the state, and 'sale' (bell.mjs) to theme/hud-sale.js.
 */
import { T, namedAreas, placeAt, momentOf, presenceMessage, readPresence, createRoster, describePeople, deskLabel,
  deskRect, cameraAway, presenceGap, presenceTtl, createPresencePacer } from './hud-core.mjs';
import { createWamReader } from './wam.mjs';

const EVENT = 'office-presence';
const HEARTBEAT_CHECK_MS = 5000;
const AREAS_REFRESH_MS = 60000;
const SEND_AFTER_WALK_PX = 2 * T;
const HELLO_EVERY_MS = 2000;
const HELLO_ATTEMPTS = 20;
const VIEW_UPDATE_MS = 120;

export async function installHud(WA, { wamUrl, plan, readWam = createWamReader(wamUrl) },
  { social, desks = [], onSeatChange, onGameChange, page }) {
  await WA.onInit();
  const myId = WA.player.playerId;
  const myName = WA.player.name || 'Você';
  const deskChairs = new Set(desks.map(d => d.chair));
  let areas = [];
  const loadAreas = async () => { areas = namedAreas(await readWam()); };
  await loadAreas().catch(() => {});
  setInterval(() => loadAreas().catch(() => {}), AREAS_REFRESH_MS);

  let me = await WA.player.getPosition();
  let chair = null;                                   // the desk chair the visitor sits on (entity id)
  let game = null;                                    // label of the open game
  const meetings = new Set();                         // {kind, count} of every meeting the visitor is in
  const focus = { active: false, paused: false, since: 0 };
  let ownStatus = false;                              // the status was set by the focus, so standing up clears it
  const roster = createRoster();
  let view = null, pending = null, lastSent = '';

  const BUBBLES = new Set(['default', 'proximity']);
  const peopleHere = () => {
    const here = placeAt(areas, me.x, me.y);
    return roster.list().filter(p => placeAt(areas, p.x, p.y) === here).length;
  };
  const conversation = () => [...meetings].reduce((sum, m) => sum + (BUBBLES.has(m.kind) ? m.count : peopleHere()), 0);
  const conversationKind = () => ([...meetings].some(m => !BUBBLES.has(m.kind) && peopleHere()) ? 'sala' : 'bolha');
  const moment = () => momentOf({ game: Boolean(game), conversation: conversation(), atDesk: Boolean(chair) });

  // ------------------------------------------------------------------------------------------- presence
  let sentFrom = { ...me };
  const headcount = () => roster.list().length + 1;
  const pacer = createPresencePacer({ people: headcount, send: ask => {
    sentFrom = { ...me };
    Promise.resolve(WA.event.broadcast(EVENT, presenceMessage({ name: myName, ...me, moment: moment(), ask })))
      .catch(() => {});
  } });
  const send = (ask = false) => pacer.request(ask);
  let replyTimer = null;
  const replySoon = () => {                          // spread the answers to a newcomer over a second, or over the gap
    if (replyTimer) return;
    replyTimer = setTimeout(() => { replyTimer = null; send(); }, 300 + Math.random() * Math.max(900, presenceGap(headcount())));
  };
  WA.event.on(EVENT).subscribe(({ data, senderId }) => {
    if (senderId === undefined || senderId === myId) return;
    const presence = readPresence(data);
    if (!presence) return;
    roster.upsert(senderId, presence, Date.now());
    if (presence.ask) replySoon();
    momentChanged();                                  // someone entering or leaving a room call changes the moment
  });
  WA.players.onPlayerMoves.subscribe(({ player, newPosition }) => {
    roster.move(player.playerId, newPosition.x, newPosition.y);
    if (roster.get(player.playerId)) momentChanged();
  });
  setInterval(() => {
    roster.prune(Date.now(), presenceTtl(headcount()));
    if (pacer.due()) send();
    momentChanged();
  }, HEARTBEAT_CHECK_MS);

  // ------------------------------------------------------------------------------------------- moment and focus
  const setStatus = value => {
    try { WA.player.setStatus(value); } catch { /* the status is a courtesy, never a requirement */ }
  };
  const setFocus = on => {
    if (on === focus.active) return;
    Object.assign(focus, { active: on, paused: !on, since: on ? Date.now() : focus.since });
    setStatus(on ? 'BUSY' : 'ONLINE');
    ownStatus = on;
  };
  const followChair = () => {
    if (chair && view && !focus.active && !focus.paused) setFocus(true);
    if (chair) return;
    if (ownStatus) setStatus('ONLINE');
    Object.assign(focus, { active: false, paused: false });
    ownStatus = false;
  };
  let lastMoment = null;
  function momentChanged() {
    const now = moment();
    if (now !== lastMoment) { lastMoment = now; send(); }
    update();
  }
  onSeatChange(seat => {
    const id = seat?.id?.startsWith('chair:') ? seat.id.slice(6) : null;
    chair = id && deskChairs.has(id) ? id : null;
    followChair();
    momentChanged();
  });
  onGameChange(label => { game = label || null; momentChanged(); });
  try {
    WA.player.meetings.onJoin().subscribe(meeting => {
      const entry = { kind: meeting.kind, count: (meeting.participants || []).length };
      meetings.add(entry);
      meeting.onParticipantJoin().subscribe(() => { entry.count += 1; momentChanged(); });
      meeting.onParticipantLeave().subscribe(() => { entry.count = Math.max(0, entry.count - 1); momentChanged(); });
      meeting.onLeave().subscribe(() => { meetings.delete(entry); momentChanged(); });
      momentChanged();
    });
  } catch (error) {
    console.error('hud meetings', error);
  }
  WA.player.onPlayerMove(event => {
    me = { x: event.x, y: event.y };
    if (!event.moving && Math.hypot(me.x - sentFrom.x, me.y - sentFrom.y) >= SEND_AFTER_WALK_PX) send();
    update();
  });
  // The camera, for "Centralizar em mim" (shown while the camera is away from you, as in the source office). WA settles
  // its zoom while the room loads (the game is resized two or three times), so the default zoom is the height of the
  // last view that follows you during the first seconds after the first update.
  const HOME_SETTLE_MS = 6000;
  let camera = null, home = 0, firstView = 0;
  try {
    WA.camera.onCameraUpdate().subscribe(next => {
      camera = next;
      const now = Date.now();
      firstView ||= now;
      if (now - firstView < HOME_SETTLE_MS && !cameraAway(next, me, 0, plan)) home = next.height;
      update();
    });
  } catch (error) {
    console.error('hud camera', error);
  }

  // Every claimable desk: where it is (tiles) and who owns it, sorted so the JSON diff in update() does not churn.
  // Read fresh on every state() from the seating seats (chairs moved in the editor follow along) and the `mesas`
  // variable; refreshed through the existing update paths plus the `mesas` subscription below, no new loop.
  const desksState = () => {
    const snapshot = social?.snapshot?.() || {};
    const seats = social?.deskSeats?.() || [];
    return seats
      .map(s => ({ id: s.id, rect: deskRect({ id: `chair:${s.id}`, entityId: s.id, x: s.x, y: s.y,
        direction: s.direction }), owner: snapshot.mesas?.[s.id]?.name ?? null, mine: snapshot.myDesk === s.id }))
      .filter(d => d.rect)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };

  // ------------------------------------------------------------------------------------------- view
  const state = () => {
    roster.prune(Date.now(), presenceTtl(headcount()));
    const people = describePeople(roster.list(), me, areas);
    const snapshot = social?.snapshot?.() || {};
    const now = moment();
    return {
      v: 1,
      me: { name: myName, x: me.x, y: me.y, place: placeAt(areas, me.x, me.y), moment: now },
      desk: chair ? { label: deskLabel(chair, snapshot.mesas, snapshot.myDesk) } : null,
      desks: desksState(),
      hasDesk: Boolean(snapshot.myDesk),
      focus: { ...focus },
      conversation: now === 'conversa' ? { count: conversation(), kind: conversationKind() } : null,
      game,
      people,
      counts: { online: people.length + 1, near: people.filter(p => p.near).length },
      camera: { away: cameraAway(camera, me, home, plan), zoom: camera && home ? Math.round(home / camera.height * 100) / 100 : 1 },
      plan,
      // the named rooms and areas, for the simplified view's floor plan
      areas: areas.map(({ name, x, y, width, height, entrance }) => ({ name, x, y, width, height, entrance })),
    };
  };
  const post = message => window.parent.postMessage({ konclui: 'hud', ...message }, '*');
  // The state also goes to a page whose theme/hud-audio.js announced 'audio' (page.mjs), even without the view: the
  // ambience fades with the visitor's position.
  function update() {
    if ((!view && !page?.has('audio')) || pending) return;
    pending = setTimeout(() => {
      pending = null;
      const next = JSON.stringify(state());
      if (next !== lastSent) { lastSent = next; post({ kind: 'state', state: JSON.parse(next) }); }
    }, VIEW_UPDATE_MS);
  }
  // Walk next to someone: below them, or the nearest free tile around them; say so when no tile can be reached.
  const AROUND = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]];
  const walkTo = async person => {
    post({ kind: 'notice', text: `Indo até ${person.name}…` });
    for (const [dx, dy] of AROUND) {
      try {
        const result = await WA.player.moveTo(person.x + dx * T, person.y + dy * T);
        post({ kind: 'notice', text: result?.cancelled ? '' : `Você está perto de ${person.name}.` });
        return;
      } catch { /* no path to this tile: try the next one */ }
    }
    post({ kind: 'notice', text: `Não há caminho até ${person.name} daqui.`, error: true });
  };
  // Walk to a point of the floor (the simplified view's double click). A newer walk or a cancel wins: WA cancels the
  // walk in progress when another moveTo starts, and only the latest walk reports how it ended.
  let walkToken = 0;
  const walkToPoint = async ({ x, y }) => {
    const token = ++walkToken;
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
    post({ kind: 'walk', status: 'going' });
    try {
      const result = await WA.player.moveTo(Number(x), Number(y));
      if (token === walkToken) post({ kind: 'walk', status: result?.cancelled ? 'cancelled' : 'arrived' });
    } catch {
      if (token === walkToken) post({ kind: 'walk', status: 'blocked' });   // no path to that point
    }
  };
  const cancelWalk = async () => {
    walkToken++;
    try {
      const here = await WA.player.getPosition();
      await WA.player.moveTo(here.x, here.y);
    } catch { /* already standing */ }
    post({ kind: 'walk', status: 'cancelled' });
  };
  const intents = {
    walk: walkToPoint,
    'walk-cancel': cancelWalk,
    goto: ({ id }) => {
      const person = roster.get(Number(id));
      if (person) walkTo(person);
    },
    'goto-desk': () => social?.goToMyDesk?.(),
    // Claim the free desk chair `id` (moving yours there); someone else's desk is refused by social's claim path.
    'claim-desk': ({ id }) => { social?.claim?.(id); update(); },
    focus: ({ on }) => { if (chair) setFocus(Boolean(on)); update(); },
    center: () => { try { WA.camera.followPlayer(true); } catch { /* the camera already follows */ } },
  };
  // A claim from another browser changes `mesas`: send the fresh desks list to the page.
  try {
    WA.state.onVariableChange('mesas').subscribe(() => update());
  } catch { /* the desks list still refreshes on the existing update paths */ }
  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.konclui !== 'hud' || event.source !== window.parent) return;
    if (data.kind === 'ready' && !view) {
      view = event.source;
      // "Minha mesa" leaves the dock: the people map has it, and the source layout's right column.
      social?.showDeskButton?.(false);
      followChair();
      update();
    } else if (data.kind === 'intent') {
      intents[data.intent?.kind]?.(data.intent);
    }
  });
  page?.onFeature('audio', () => update());
  let attempts = 0;
  const hello = () => {
    if (view || attempts++ >= HELLO_ATTEMPTS) return;
    post({ kind: 'hello', v: 1 });
    setTimeout(hello, HELLO_EVERY_MS);
  };
  hello();
  send(true);
  return { snapshot: () => ({ ...state(), viewReady: Boolean(view), meetings: [...meetings].map(m => ({ ...m })) }) };
}
