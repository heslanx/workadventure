/**
 * The map script's link to the page's own scripts (theme/hud-audio.js, theme/hud-sale.js), over the HUD protocol of
 * hud.mjs: postMessage with {konclui: 'hud', kind}, never a `type` field. A page script announces what it handles with
 * {kind: 'feature', feature} when the HUD says hello (or on its first state); until then the map script keeps its own
 * fallback (WA.sound for the ambience and the bell, a website for the sale card), so a page without those scripts
 * loses nothing. Intents the page sends back ({kind: 'intent', intent: {kind}}) reach the handler registered here.
 * One instance per map script (map-script.js creates it), shared by social.mjs, bell.mjs and hud.mjs.
 */
export const FEATURES = ['audio', 'sale'];

export function createPageLink(win) {
  const features = new Set();
  const waiting = new Map();                         // feature -> callbacks to run once it is announced
  const intents = new Map();                         // intent kind -> handler
  const post = message => win.parent.postMessage({ konclui: 'hud', ...message }, '*');
  win.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.konclui !== 'hud' || event.source !== win.parent) return;
    if (data.kind === 'feature' && FEATURES.includes(data.feature) && !features.has(data.feature)) {
      features.add(data.feature);
      for (const callback of waiting.get(data.feature) || []) callback();
      waiting.delete(data.feature);
    } else if (data.kind === 'intent' && typeof data.intent?.kind === 'string') {
      intents.get(data.intent.kind)?.(data.intent);
    }
  });
  return {
    post,
    has: feature => features.has(feature),
    any: () => features.size > 0,
    /** Run `callback` once the page announces `feature` (at once if it already did). */
    onFeature(feature, callback) {
      if (features.has(feature)) return callback();
      waiting.set(feature, [...(waiting.get(feature) || []), callback]);
    },
    onIntent(kind, handler) { intents.set(kind, handler); },
  };
}
