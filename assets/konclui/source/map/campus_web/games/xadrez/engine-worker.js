// Koru's brain: runs js-chess-engine off the main thread.
//
// The engine ships as CommonJS (tsc output, one file per module) and there is no build step here, so vendor/ keeps the
// files wrapped in function scopes in one script (self.__cjsModules) and this worker resolves require() against it.
// Protocol: { id, fen, level, randomness } in, { id, from, to } out ("a1" style squares; { id, error } on failure).
"use strict";

importScripts("vendor/js-chess-engine/engine.bundle.js");

const cache = new Map();

// "types" is the only directory the engine requires; everything else is a plain file next to the requester.
function resolve(fromId, request) {
  const parts = fromId.split("/").slice(0, -1);
  for (const part of request.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  const id = parts.join("/");
  return id === "types" ? "types/index" : id;
}

function load(id) {
  if (cache.has(id)) return cache.get(id).exports;
  const define = self.__cjsModules[id];
  if (!define) throw new Error(`engine module not found: ${id}`);
  const mod = { exports: {} };
  cache.set(id, mod);
  define.call(mod.exports, mod.exports, (request) => load(resolve(id, request)), mod);
  return mod.exports;
}

const { Game } = load("index");

self.onmessage = (e) => {
  const { id, fen, level, randomness } = e.data;
  try {
    const { move } = new Game(fen).ai({ level, randomness, play: false });
    const [from] = Object.keys(move);
    self.postMessage({ id, from: from.toLowerCase(), to: move[from].toLowerCase() });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
