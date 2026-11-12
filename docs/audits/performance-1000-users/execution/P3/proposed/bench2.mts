// One implementation per process, so that memory deltas and JIT state are not shared between implementations.
// Run: npx tsx --expose-gc /work/.p3/bench2.mts <module path> <label> <capped|uncapped>
import { performance } from "node:perf_hooks";

/* eslint-disable @typescript-eslint/no-explicit-any */
const [modulePath, label, mode] = process.argv.slice(2);
const { NoncedMessageStore } = (await import(modulePath)) as any;
const RETENTION_MS = 30_000;
const makeStore = () =>
    mode === "capped" ? new NoncedMessageStore(RETENTION_MS, 2_000, 4 * 1024 * 1024) : new NoncedMessageStore(RETENTION_MS);

let now = 1_700_000_000_000;
Date.now = () => now;
const gc = (globalThis as any).gc as () => void;
const settle = async () => {
    for (let i = 0; i < 3; i++) {
        gc();
        await new Promise((resolve) => setImmediate(resolve));
    }
};

// Healthy path: 10 frames per second, about 300 frames in the store, each add expires one frame.
function steady(adds: number): number {
    const store = makeStore();
    const payload = new Uint8Array(300);
    const t0 = performance.now();
    for (let nonce = 1; nonce <= adds; nonce++) {
        now += 100;
        store.add(nonce, payload);
    }
    return ((performance.now() - t0) / adds) * 1e6;
}
steady(300_000);
const rounds: number[] = [];
for (let i = 0; i < 9; i++) rounds.push(+steady(1_000_000).toFixed(1));
const sorted = [...rounds].sort((a, b) => a - b);

// Burst: 100,000 frames of 256 bytes inside one retention window, then one prune of everything.
await settle();
const before = process.memoryUsage();
const store = makeStore();
let refusedAdds = 0;
for (let nonce = 1; nonce <= 100_000; nonce++) {
    if (nonce % 10 === 0) now += 1;
    if (store.add(nonce, new Uint8Array(256)) === false) refusedAdds++;
}
await settle();
const after = process.memoryUsage();
const retained = store.getAll();
const retainedMessages = retained.length;
const retainedPayloadBytes = retained.reduce((sum: number, m: any) => sum + m.payload.byteLength, 0);
now += RETENTION_MS + 1;
const t0 = performance.now();
store.getAll();
const pruneAllMs = +(performance.now() - t0).toFixed(2);

console.log(
    JSON.stringify({
        label,
        mode,
        steadyNanosPerAdd: { rounds, min: sorted[0], median: sorted[4], max: sorted[8] },
        burst100kFramesOf256Bytes: {
            refusedAdds,
            retainedMessages,
            retainedPayloadBytes,
            heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
            arrayBuffersDeltaBytes: after.arrayBuffers - before.arrayBuffers,
            rssDeltaBytes: after.rss - before.rss,
            pruneAllMs,
        },
    }),
);
