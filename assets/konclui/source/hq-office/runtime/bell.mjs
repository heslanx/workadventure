/**
 * The sales bell of the HQ office for WorkAdventure 1.34 (installed by the map script; nothing runs on import), ported
 * from the campus (map/campus_web/campus.js, "sales bell"):
 *   ring    Space in the "Sino da venda" area rings for everyone (WA.event 'sino-da-venda'); the prompt comes back after
 *           a short pause while you stay there
 *   sale    a real sale arrives as the Room API event 'venda-nova' from the bell service (bell/bell.mjs); it is accepted
 *           only without a senderId, so no player can forge one
 *   card    every ring shows one card at a time, from a queue of up to 10 where a flood of manual rings never pushes a
 *           real sale out: green for a new sale, cyan for a renewal, gold for a manual ring
 *   sound   the owl (sale.mp3), at 0.4 inside meeting rooms, team rooms, focus booths and the auditorium and at a desk
 *           in focus, 1 elsewhere
 * With the page's scripts (page.mjs features) the card is the HUD's own notice (theme/hud-sale.js) and the owl plays in
 * the page (theme/hud-audio.js, which honours the person's bell switch and volume); without them the card is the
 * campus page (pages/sale.html) in a website and the owl plays through WA.sound.
 */
export const BELL_EVENT = 'sino-da-venda';
export const SALE_EVENT = 'venda-nova';
export const QUEUE_MAX = 10;
export const QUIET_VOLUME = 0.4;
export const RING_GAP_MS = 3000;                 // your own prompt comes back after this pause
export const ACCEPT_GAP_MS = 2500;               // a ring from one sender counts once in this time (jitter: < RING_GAP_MS)
export const PROMPT = 'ESPAÇO para tocar o sino da venda';

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The queue with `card` added: when it is full, a real sale takes the place of the oldest manual ring; a manual ring
 * into a full queue is dropped. Pure, tested. */
export function enqueue(queue, card, max = QUEUE_MAX) {
  const next = [...queue];
  if (next.length >= max && !card.manual) {
    const manual = next.findIndex(c => c.manual);
    if (manual !== -1) next.splice(manual, 1);
  }
  if (next.length < max) next.push(card);
  return next;
}

/** A sale card read from an untrusted event payload (bell/bell.mjs toCard), or null. Pure, tested. */
export function readSale(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const valor = Number(data.valor);
  return {
    tipo: data.tipo === 'renovacao' ? 'renovacao' : 'nova',
    valor: Number.isFinite(valor) && valor > 0 ? valor : 0,
    cliente: text(data.cliente, 60), plano: text(data.plano, 60), vendedor: text(data.vendedor, 40),
    squad: text(data.squad, 30), cidade: text(data.cidade, 40), uf: text(data.uf, 4), quando: text(data.quando, 40),
    teste: data.teste === true,
  };
}

/** A manual ring read from an untrusted event payload. Pure, tested. */
export const readRing = data => ({ manual: true, nome: text(data?.nome, 40) || 'Alguém' });

/** How long a card stays on screen. Pure, tested. */
export const cardMs = card => (card.manual ? 6000 : 11000);

/** Whether a ring from a sender who last rang at `last` (ms, or undefined) counts at `now`. Pure, tested. */
export const ringAllowed = (last, now, gap = ACCEPT_GAP_MS) => last === undefined || now - last >= gap;

const holds = (r, p) => p && p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

/** Whether the point is inside one of the quiet rects. Pure, tested. */
export const quietAt = (point, rects) => (rects || []).some(r => holds(r, point));

const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** What the HUD's card shows, every field plain text (the page sets it with textContent). Pure, tested. */
export function describeCard(card) {
  if (card.manual) {
    return { tone: 'bell', tag: 'Sino da venda', time: '', title: 'Toca o sino!',
      who: `${card.nome || 'Alguém'} tocou o sino da venda`, where: '', seller: null, squad: null };
  }
  const renewal = card.tipo === 'renovacao';
  const when = card.quando ? new Date(card.quando) : null;
  const place = [card.cidade, card.uf].filter(Boolean).join(', ');
  return {
    tone: renewal ? 'renewal' : 'sale',
    tag: `${card.teste ? 'Teste: ' : ''}${renewal ? 'Renovação' : 'Venda nova'}`,
    time: when && !Number.isNaN(when.getTime())
      ? when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    title: card.valor > 0 ? brl(card.valor) : 'Venda aprovada',
    who: card.cliente || 'Cliente Koncluí',
    where: [place, card.plano ? `Plano ${card.plano}` : ''].filter(Boolean).join(' · '),
    seller: card.vendedor || card.squad ? card.vendedor || 'o time' : null,
    squad: card.squad || null,
  };
}

export async function installBell(WA, { area, quiet = [], soundUrl, cardUrl },
  { page, onSeatChange = () => {}, deskChairs = new Set(), focused = () => true } = {}) {
  await WA.onInit();
  const myId = WA.player.playerId;
  const myName = text(WA.player.name, 40) || 'Alguém';
  let me = await WA.player.getPosition();
  WA.player.onPlayerMove(event => { me = { x: event.x, y: event.y }; });
  let atDesk = false;
  onSeatChange(seat => {
    const id = seat?.id?.startsWith('chair:') ? seat.id.slice(6) : null;
    atDesk = Boolean(id && deskChairs.has(id));
  });
  const quietNow = () => quietAt(me, quiet) || (atDesk && focused());

  // ------------------------------------------------------------------------------------------- sound
  let rings = 0;
  const ring = () => {
    rings += 1;
    const volume = quietNow() ? QUIET_VOLUME : 1;
    if (page?.has('audio')) page.post({ kind: 'sound', category: 'bell', url: soundUrl, volume });
    else WA.sound.loadSound(soundUrl).play({ volume, loop: false });
  };

  // ------------------------------------------------------------------------------------------- cards
  let queue = [], showing = null, timer = null, site = null, shown = 0;
  const openSite = async card => {
    try {
      site = await WA.ui.website.open({ url: `${cardUrl}#${encodeURIComponent(JSON.stringify(card))}`, visible: true,
        allowApi: false, position: { vertical: 'top', horizontal: 'right' },
        size: { width: '380px', height: card.manual ? '112px' : '148px' }, margin: { top: '84px', right: '12px' } });
    } catch (error) {
      console.error('bell card', error);
    }
  };
  const hide = () => {
    if (page?.has('sale')) page.post({ kind: 'sale', card: null });
    try { site?.close(); } catch (error) { console.error('bell card close', error); }   // never leave the queue stuck
    site = null;
  };
  const next = () => {
    if (showing || !queue.length) return;
    [showing, ...queue] = queue;
    shown += 1;
    ring();
    if (page?.has('sale')) page.post({ kind: 'sale', card: describeCard(showing), ms: cardMs(showing) });
    else openSite(showing);
    timer = setTimeout(done, cardMs(showing));
  };
  function done() {
    clearTimeout(timer);
    hide();
    showing = null;
    next();
  }
  const announce = card => { queue = enqueue(queue, card); next(); };
  page?.onIntent('sale-close', () => { if (showing) done(); });

  // ------------------------------------------------------------------------------------------- the manual bell
  let inArea = false, prompt = null, reoffer = null;
  const offer = () => {
    prompt?.remove();
    prompt = WA.ui.displayActionMessage({ message: PROMPT, callback: () => {
      prompt = null;                                  // WorkAdventure took the message away on Space
      Promise.resolve(WA.event.broadcast(BELL_EVENT, { nome: myName })).catch(() => {});
      announce({ manual: true, nome: myName });
      clearTimeout(reoffer);
      reoffer = setTimeout(() => { if (inArea) offer(); }, RING_GAP_MS);
    } });
  };
  WA.mapEditor.area.onEnter(area).subscribe(() => { inArea = true; offer(); });
  WA.mapEditor.area.onLeave(area).subscribe(() => {
    inArea = false;
    clearTimeout(reoffer);
    prompt?.remove();
    prompt = null;
  });
  const lastRing = new Map();                         // sender -> when it last rang, against a flood from one person
  WA.event.on(BELL_EVENT).subscribe(({ data, senderId }) => {
    if (senderId !== undefined && senderId === myId) return;   // our own ring is already in the queue
    const key = senderId ?? 'room', now = Date.now();
    if (!ringAllowed(lastRing.get(key), now)) return;
    lastRing.set(key, now);
    announce(readRing(data));
  });
  WA.event.on(SALE_EVENT).subscribe(({ data, senderId }) => {
    if (senderId !== undefined) return;               // only the Room API (no sender) announces a sale, never a player
    const card = readSale(data);
    if (card) announce(card);
  });
  return {
    snapshot: () => ({ inArea, prompt: Boolean(prompt), rings, shown, quiet: quietNow(),
      showing: showing && (showing.manual ? 'manual' : showing.tipo),
      queue: queue.map(c => (c.manual ? 'manual' : c.tipo)), via: page?.has('sale') ? 'hud' : 'website' }),
  };
}
