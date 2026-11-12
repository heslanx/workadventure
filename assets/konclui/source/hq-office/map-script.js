// Map script of the HQ office (an ES module, as WorkAdventure loads it): its behaviours on WorkAdventure.
//   runtime/seating.mjs       walk onto a chair and stop to sit, walk away to stand
//   runtime/interactions.mjs  sliding glass doors, games on the arcade / ping-pong / pool table, wave and go-to
//   runtime/social.mjs        desk reservations, locking rooms and knocking, reactions, ambient sound
//   runtime/bell.mjs          the sales bell: manual rings, real sales from the bell service, one card at a time
//   runtime/hud.mjs           presence, place and moment for the page's HUD view (theme/moment-hud.js)
//   runtime/page.mjs          what the page's own scripts handle (theme/hud-audio.js, theme/hud-sale.js)
//   koi/                             the koi of the lake and the canal
import { installAutoSeating } from './runtime/seating.mjs';
import { installInteractions } from './runtime/interactions.mjs';
import { installSocial } from './runtime/social.mjs';
import { installBell } from './runtime/bell.mjs';
import { installHud } from './runtime/hud.mjs';
import { createPageLink } from './runtime/page.mjs';
import { createWamReader } from './runtime/wam.mjs';

await WA.onInit();
const here = name => new URL(name, import.meta.url).href;
const json = name => fetch(here(name), { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
const page = createPageLink(window);
// Pets (theme/pets/ draws them): the pet's name variable and the room's pet events, relayed to the page.
window.__officePets = await import('./runtime/pets.mjs').then(m => m.installPets(WA, { page }))
  .catch(error => console.error('pets', error));
for (const overlay of (await json('../koi/overlays.json')) || []) {
  WA.room.website.create({
    name: `carpas-${overlay.name}`, url: here(`../koi/index.html?scene=${overlay.name}`), position: overlay.position,
    visible: true, allowApi: true, origin: 'map', scale: 1,
  });
}
const [interactionsConfig, seatsConfig, socialConfig, hudConfig, bellConfig] = await Promise.all(
  [json('../interactions.json'), json('../seats.json'), json('../social.json'), json('../hud.json'), json('../bell.json')]);
const gameListeners = [];
const interactions = interactionsConfig && await installInteractions(WA,
  { ...interactionsConfig, gamesBase: here('../games/') },
  { onGame: label => gameListeners.forEach(listener => listener(label)) })
  .catch(error => console.error('interactions', error));
const seatListeners = [];
const readWam = createWamReader(here('../office.wam'));   // one reader for the seats and the HUD's places
const seating = await installAutoSeating(WA, seatsConfig, here('../office.wam'),
  { readWam, onChange: seat => seatListeners.forEach(listener => listener(seat)) });
const social = socialConfig && await installSocial(WA,
  { ...socialConfig, reactionsUrl: here('../reactions/index.html'), soundsBase: here('../sounds/') },
  { seating, interactions, page, onSeatChange: listener => seatListeners.push(listener) })
  .catch(error => console.error('social', error));
// The bell is quieter at a desk in focus: the HUD's focus while its view is up, else simply sitting at a desk.
const focused = () => {
  const hudState = window.__officeHud?.snapshot?.();
  return !hudState?.viewReady || Boolean(hudState.focus?.active);
};
const bell = bellConfig && await installBell(WA,
  { ...bellConfig, soundUrl: here(`../sounds/${bellConfig.sound}`), cardUrl: here('../pages/sale.html') },
  { page, focused, deskChairs: new Set((socialConfig?.desks || []).map(d => d.chair)),
    onSeatChange: listener => seatListeners.push(listener) })
  .catch(error => console.error('bell', error));
const hud = hudConfig && await installHud(WA,
  { wamUrl: here('../office.wam'), readWam, plan: { ...hudConfig.plan, url: here(`../${hudConfig.plan.file}`) } },
  { social, page, desks: socialConfig?.desks || [], onSeatChange: listener => seatListeners.push(listener),
    onGameChange: listener => gameListeners.push(listener) })
  .catch(error => console.error('hud', error));
Object.assign(window, { __officeSeating: seating, __officeInteractions: interactions, __officeSocial: social,
  __officeBell: bell, __officeHud: hud });
