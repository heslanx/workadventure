/**
 * One reader of the room's .wam for every module of the map script (seats, places).
 *
 * The map script runs in a sandboxed frame, which gets no HTTP cache: a `no-cache` GET still moves the whole file
 * (measured 13/10/2026 and again 11/11/2026: 31 KB compressed every 15 s per visitor, 21 kbps of a visitor standing
 * still). So a read asks with HEAD first and downloads the .wam only when its Last-Modified changed. That header is
 * readable cross-origin (the ETag is not exposed); a server that does not send it gets a download every time, as
 * before. Reads under way are shared, and a read newer than `freshMs` answers without asking again, so two modules
 * polling on their own timers cost one request.
 */
export function createWamReader(wamUrl, { fetcher = globalThis.fetch, freshMs = 5000, now = Date.now } = {}) {
  let wam = null, modified = null, readAt = -Infinity, pending = null;
  const request = async (method) => {
    const response = await fetcher(wamUrl, { method, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`WAM read failed: HTTP ${response.status}`);
    return response;
  };
  async function read() {
    if (wam && modified) {
      const head = await request('HEAD');
      if (head.headers?.get?.('last-modified') === modified) { readAt = now(); return wam; }
    }
    const response = await request('GET');
    wam = await response.json();
    modified = response.headers?.get?.('last-modified') || null;
    readAt = now();
    return wam;
  }
  /** The room's .wam as last saved. `force` asks the server even right after another read (before sitting down). */
  return ({ force = false } = {}) => {
    if (pending) return pending;
    if (!force && wam && now() - readAt < freshMs) return Promise.resolve(wam);
    pending = read().finally(() => { pending = null; });
    return pending;
  };
}
