// Deterministic differential trace and micro-measurement of NoncedMessageStore: baseline (ddbe245a8) vs PR #6688 head.
// Run from the snapshot: npx tsx --expose-gc /work/.p3/bench.mts > /work/.p3/micro-measurement.json
// Synthetic payloads only (zero-filled buffers). The clock is a fake Date.now(); only CPU timings use the real clock.
import { performance } from "node:perf_hooks";
import { NoncedMessageStore as BaselineStore } from "./baseline/NoncedMessageStore.ts";
import { NoncedMessageStore as PrStore } from "../play/src/common/NoncedMessageStore.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyStore = any;
const RETENTION_MS = 30_000;
const MAX_MESSAGES = 2_000; // RESUME_STORE_MAX_MESSAGES at the PR head
const MAX_BYTES = 4 * 1024 * 1024; // RESUME_STORE_MAX_BYTES at the PR head

let now = 1_700_000_000_000;
Date.now = () => now;
const gc = (globalThis as any).gc as () => void;

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const same = (a: any[], b: any[]) =>
    a.length === b.length && a.every((m, i) => m.nonce === b[i].nonce && m.payload === b[i].payload);

// Part 1: the uncapped PR store must answer like the baseline for the same trace of operations.
function differential(seed: number, operations: number) {
    const random = mulberry32(seed);
    const baseline: AnyStore = new BaselineStore(RETENTION_MS);
    const pr: AnyStore = new PrStore(RETENTION_MS);
    let nonce = 0;
    const calls = { add: 0, advance: 0, getAll: 0, getAfter: 0, hasEveryNonceAfter: 0 };
    const mismatches = { getAll: 0, getAfter: 0, hasEveryNonceAfterEmptyStorePeerBehind: 0, hasEveryNonceAfterOther: 0 };
    for (let i = 0; i < operations; i++) {
        const r = random();
        if (r < 0.55) {
            nonce++;
            const payload = new Uint8Array(1 + Math.floor(random() * 512));
            baseline.add(nonce, payload);
            pr.add(nonce, payload);
            calls.add++;
        } else if (r < 0.75) {
            const k = random();
            // Mostly short gaps; sometimes exactly the retention or one millisecond less, to sit on the cutoff.
            now += k < 0.6 ? Math.floor(random() * 200) : k < 0.9 ? Math.floor(random() * 5_000) : k < 0.95 ? 29_999 : 30_000;
            calls.advance++;
        } else if (r < 0.83) {
            calls.getAll++;
            if (!same(baseline.getAll(), pr.getAll())) mismatches.getAll++;
        } else if (r < 0.92) {
            calls.getAfter++;
            const after = Math.max(0, nonce - Math.floor(random() * 50));
            if (!same(baseline.getAfter(after), pr.getAfter(after))) mismatches.getAfter++;
        } else {
            calls.hasEveryNonceAfter++;
            const peer = Math.max(0, nonce - Math.floor(random() * 50));
            const expected = baseline.hasEveryNonceAfter(peer);
            const actual = pr.hasEveryNonceAfter(peer);
            if (expected !== actual) {
                const emptyAndBehind = baseline.getAll().length === 0 && peer < nonce && expected && !actual;
                if (emptyAndBehind) mismatches.hasEveryNonceAfterEmptyStorePeerBehind++;
                else mismatches.hasEveryNonceAfterOther++;
            }
        }
    }
    return { seed, operations, calls, mismatches };
}

// Part 2a: a burst of frames inside one retention window, then one prune of all of them.
function storm(label: string, makeStore: () => AnyStore, frames: number, frameBytes: number) {
    gc();
    const before = process.memoryUsage();
    const store = makeStore();
    let refusedAdds = 0;
    let held = 0;
    let heldBytes = 0;
    let peakMessages = 0;
    let peakBytes = 0;
    const t0 = performance.now();
    for (let nonce = 1; nonce <= frames; nonce++) {
        if (nonce % 10 === 0) now += 1; // 10 frames per fake millisecond: the whole burst fits in the retention
        if (store.add(nonce, new Uint8Array(frameBytes)) === false) {
            refusedAdds++;
            held = 0;
            heldBytes = 0;
        } else {
            held++;
            heldBytes += frameBytes;
            if (held > peakMessages) peakMessages = held;
            if (heldBytes > peakBytes) peakBytes = heldBytes;
        }
    }
    const addMs = performance.now() - t0;
    gc();
    const after = process.memoryUsage();
    const retainedAtEnd = store.getAll().length;
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) store.getAfter(frames - 100);
    const replayTailMicrosPerCall = ((performance.now() - t1) / 200) * 1000;
    now += RETENTION_MS + 1;
    const t2 = performance.now();
    const afterPrune = store.getAll().length;
    const pruneAllMs = performance.now() - t2;
    return {
        label,
        frames,
        frameBytes,
        addMs: +addMs.toFixed(2),
        refusedAdds,
        peakRetainedMessages: peakMessages,
        peakRetainedPayloadBytes: peakBytes,
        retainedMessagesAtEnd: retainedAtEnd,
        heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
        arrayBuffersDeltaBytes: after.arrayBuffers - before.arrayBuffers,
        replayTailOf100MicrosPerCall: +replayTailMicrosPerCall.toFixed(2),
        pruneAllMs: +pruneAllMs.toFixed(2),
        retainedMessagesAfterPrune: afterPrune,
    };
}

// Part 2b: the healthy path. 10 frames per second, about 300 frames in the store, one add per frame.
function steady(makeStore: () => AnyStore, adds: number): number {
    const store = makeStore();
    const payload = new Uint8Array(300);
    const t0 = performance.now();
    for (let nonce = 1; nonce <= adds; nonce++) {
        now += 100;
        store.add(nonce, payload);
    }
    return ((performance.now() - t0) / adds) * 1e6; // nanoseconds per add
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const makeBaseline = () => new BaselineStore(RETENTION_MS);
const makePrCapped = () => new PrStore(RETENTION_MS, MAX_MESSAGES, MAX_BYTES);
const makePrUncapped = () => new PrStore(RETENTION_MS);

const result: any = { node: process.version, differential: [], storm: [], steady: {} };
for (const seed of [1, 2, 3]) result.differential.push(differential(seed, 200_000));
for (const frames of [25_000, 50_000, 100_000, 200_000]) {
    result.storm.push(storm("baseline", makeBaseline, frames, 256));
    result.storm.push(storm("pr-head uncapped (front configuration)", makePrUncapped, frames, 256));
    result.storm.push(storm("pr-head capped (pusher configuration)", makePrCapped, frames, 256));
}
const rounds: Record<string, number[]> = { baseline: [], prCapped: [] };
steady(makeBaseline, 200_000); // warm-up
steady(makePrCapped, 200_000);
for (let round = 0; round < 7; round++) {
    rounds.baseline.push(steady(makeBaseline, 1_000_000));
    rounds.prCapped.push(steady(makePrCapped, 1_000_000));
}
result.steady = {
    addsPerRound: 1_000_000,
    rounds: 7,
    baselineNanosPerAdd: rounds.baseline.map((v) => +v.toFixed(1)),
    prCappedNanosPerAdd: rounds.prCapped.map((v) => +v.toFixed(1)),
    baselineMedianNanosPerAdd: +median(rounds.baseline).toFixed(1),
    prCappedMedianNanosPerAdd: +median(rounds.prCapped).toFixed(1),
};
console.log(JSON.stringify(result, null, 1));
