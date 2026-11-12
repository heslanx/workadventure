/**
 * Deterministic micro-benchmark for PositionDispatcher.setViewport (P4 experiment).
 *
 * It replays fixed viewport trajectories against one or more implementations of PositionDispatcher, interleaved
 * in the same process, and records for each scenario:
 *  - the effective-bound hit ratio (updates that leave the socket's listened zones untouched),
 *  - the time per update (process.hrtime, one sample per replay of the trajectory),
 *  - the JS heap bytes allocated per update (heapUsed delta over a batch small enough to fit in the young
 *    generation, so that no garbage collection runs inside the measured batch),
 *  - a trace hash of every zone subscription / unsubscription and of the resulting zone membership, to compare the
 *    observable behavior of the implementations.
 *
 * Usage (from play/, inside the wa-fable-local container):
 *   npx tsx --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 \
 *     ../docs/audits/performance-1000-users/execution/P4/bench/viewport-bench.ts <out.json> label=path [label=path...]
 *
 * The first label is the reference. Passing the same implementation under two labels gives the A/A noise.
 * This is a micro-benchmark of one function: it is not a measurement of a live pusher with 1,000 users.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";

interface Viewport {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface Step {
    socket: number;
    viewport: Viewport;
}

interface Scenario {
    name: string;
    description: string;
    sockets: number;
    steps: Step[];
    timedReplays: number;
    allocBatch: number;
}

interface Dispatcher {
    setViewport(socket: unknown, viewport: Viewport): void;
    removeViewport(socket: unknown): void;
}

type DispatcherConstructor = new (
    roomId: string,
    zoneWidth: number,
    zoneHeight: number,
    socketListener: unknown,
    pusherRoom: unknown,
) => Dispatcher;

const ZONE_SIZE = 320; // Same value as PusherRoom.
const SCREEN_WIDTH = 2520; // 1920px plus the 300px margin the front adds on each side.
const SCREEN_HEIGHT = 1680; // 1080px plus the same margin.
const WARMUP_REPLAYS = 5;
const ALLOC_REPLAYS = 10;

/** Triangle wave: 0, 1, ..., amplitude, amplitude - 1, ..., 1, 0, 1, ... (period 2 * amplitude). */
function triangle(k: number, amplitude: number): number {
    const phase = k % (2 * amplitude);
    return phase <= amplitude ? phase : 2 * amplitude - phase;
}

function viewportAt(left: number, top: number, width = SCREEN_WIDTH, height = SCREEN_HEIGHT): Viewport {
    return { left, top, right: left + width, bottom: top + height };
}

function singleSocket(count: number, at: (k: number) => Viewport): Step[] {
    const steps: Step[] = [];
    for (let k = 0; k < count; k++) {
        steps.push({ socket: 0, viewport: at(k) });
    }
    return steps;
}

function buildScenarios(): Scenario[] {
    // 39 zones wide plus a fraction: covers exactly 40x40 = 1600 zones, the cap, without being cropped.
    const maxSide = 39 * ZONE_SIZE;

    // 1,000 sockets spread over a 16000x16000px map by a fixed linear congruential generator.
    const crowdSteps: Step[] = [];
    const crowdSockets = 1000;
    const crowdOrigins: Array<{ left: number; top: number }> = [];
    let seed = 20261111;
    const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
    };
    for (let s = 0; s < crowdSockets; s++) {
        crowdOrigins.push({ left: next() % 13000, top: next() % 14000 });
    }
    for (let round = 0; round < 40; round++) {
        for (let s = 0; s < crowdSockets; s++) {
            const origin = crowdOrigins[s];
            crowdSteps.push({
                socket: s,
                viewport: viewportAt(origin.left + triangle(round + s, 20) * 26, origin.top),
            });
        }
    }

    return [
        {
            name: "stationary",
            description: "One socket, 1080p viewport, the same viewport repeated",
            sockets: 1,
            steps: singleSocket(10000, () => viewportAt(4000, 4000)),
            timedReplays: 30,
            allocBatch: 2000,
        },
        {
            name: "inside-bounds",
            description: "One socket, 1080p viewport moving 4-5px per update without crossing a zone boundary",
            sockets: 1,
            steps: singleSocket(10000, (k) => viewportAt(3900 + triangle(k, 50) * 4, 3850 + triangle(k, 40) * 5)),
            timedReplays: 30,
            allocBatch: 2000,
        },
        {
            name: "walk",
            description: "One socket, 1080p viewport moving 26px per update along x (back and forth over 6500px)",
            sockets: 1,
            steps: singleSocket(10000, (k) => viewportAt(1000 + triangle(k, 250) * 26, 4000)),
            timedReplays: 30,
            allocBatch: 2000,
        },
        {
            name: "cross-every-update",
            description: "One socket, 1080p viewport moving one full zone (320px) per update: every update is a miss",
            sockets: 1,
            steps: singleSocket(10000, (k) => viewportAt(960 + triangle(k, 20) * ZONE_SIZE, 4000)),
            timedReplays: 30,
            allocBatch: 2000,
        },
        {
            name: "max-inside-bounds",
            description: "One socket, 40x40 zones (the cap), moving 4px per update without crossing a zone boundary",
            sockets: 1,
            steps: singleSocket(400, (k) =>
                viewportAt(3210 + triangle(k, 50) * 4, 3210 + triangle(k, 50) * 4, maxSide, maxSide),
            ),
            timedReplays: 30,
            allocBatch: 80,
        },
        {
            name: "max-cross-every-update",
            description: "One socket, 40x40 zones (the cap), moving one full zone per update: every update is a miss",
            sockets: 1,
            steps: singleSocket(400, (k) => viewportAt(3200 + triangle(k, 20) * ZONE_SIZE, 3200, maxSide, maxSide)),
            timedReplays: 30,
            allocBatch: 80,
        },
        {
            name: "oversized-cropped",
            description: "One socket, 1,000,000px viewport cropped to the cap, the same viewport repeated",
            sockets: 1,
            steps: singleSocket(400, () => viewportAt(0, 0, 1_000_000, 1_000_000)),
            timedReplays: 30,
            allocBatch: 80,
        },
        {
            name: "crowd-walk",
            description: "1,000 sockets in one room, 1080p viewports, each moving 26px per update, round-robin",
            sockets: crowdSockets,
            steps: crowdSteps,
            timedReplays: 12,
            allocBatch: 2000,
        },
    ];
}

/** A Set that counts the calls that really change its content. */
class CountingSet extends Set<string> {
    public mutations = 0;

    public add(value: string): this {
        if (!this.has(value)) {
            this.mutations++;
        }
        return super.add(value);
    }

    public delete(value: string): boolean {
        const deleted = super.delete(value);
        if (deleted) {
            this.mutations++;
        }
        return deleted;
    }
}

interface World {
    dispatcher: Dispatcher;
    sockets: unknown[];
    zoneSets: Array<Set<string>>;
}

function createWorld(
    Implementation: DispatcherConstructor,
    scenario: Scenario,
    pusherRoom: unknown,
    createSet: () => Set<string>,
): World {
    const dispatcher = new Implementation("bench-room", ZONE_SIZE, ZONE_SIZE, {}, pusherRoom);
    const sockets: unknown[] = [];
    const zoneSets: Array<Set<string>> = [];
    for (let s = 0; s < scenario.sockets; s++) {
        const userData = { userId: s + 1, listenedZones: createSet() };
        zoneSets.push(userData.listenedZones);
        sockets.push({ getUserData: () => userData });
    }
    return { dispatcher, sockets, zoneSets };
}

function replay(world: World, steps: Step[], from: number, to: number): void {
    const { dispatcher, sockets } = world;
    for (let k = from; k < to; k++) {
        const step = steps[k];
        dispatcher.setViewport(sockets[step.socket], step.viewport);
    }
}

interface BehaviorResult {
    updates: number;
    hits: number;
    hitRatio: number;
    subscribeCalls: number;
    unsubscribeCalls: number;
    traceSha256: string;
}

/** Untimed pass: counts the hits and hashes every observable effect of the second replay of the trajectory. */
function observeBehavior(Implementation: DispatcherConstructor, scenario: Scenario): BehaviorResult {
    const hash = createHash("sha256");
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const pusherRoom = {
        subscribeToZone(x: number, y: number) {
            subscribeCalls++;
            hash.update(`S${x},${y};`);
        },
        unsubscribeFromZone(x: number, y: number) {
            unsubscribeCalls++;
            hash.update(`U${x},${y};`);
        },
    };
    const sets: CountingSet[] = [];
    const world = createWorld(Implementation, scenario, pusherRoom, () => {
        const set = new CountingSet();
        sets.push(set);
        return set;
    });

    replay(world, scenario.steps, 0, scenario.steps.length);
    subscribeCalls = 0;
    unsubscribeCalls = 0;

    let hits = 0;
    for (let k = 0; k < scenario.steps.length; k++) {
        const step = scenario.steps[k];
        const set = sets[step.socket];
        const before = set.mutations;
        world.dispatcher.setViewport(world.sockets[step.socket], step.viewport);
        if (set.mutations === before) {
            hits++;
        }
        hash.update(`|${k}:${set.size}|`);
    }
    for (const set of sets) {
        hash.update([...set].sort().join(" "));
        hash.update("/");
    }
    // Leaving must release every zone, whatever the implementation remembers about the socket.
    for (const socket of world.sockets) {
        world.dispatcher.removeViewport(socket);
    }
    hash.update(`left:${sets.reduce((total, set) => total + set.size, 0)}`);

    return {
        updates: scenario.steps.length,
        hits,
        hitRatio: hits / scenario.steps.length,
        subscribeCalls,
        unsubscribeCalls,
        traceSha256: hash.digest("hex"),
    };
}

function quantile(sorted: number[], q: number): number {
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function summarize(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        min: sorted[0],
        p10: quantile(sorted, 0.1),
        median: quantile(sorted, 0.5),
        p90: quantile(sorted, 0.9),
        max: sorted[sorted.length - 1],
    };
}

function round(value: number, digits = 2): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

async function main(): Promise<void> {
    const [outputPath, ...implementationArgs] = process.argv.slice(2);
    if (!outputPath || implementationArgs.length === 0) {
        throw new Error("Usage: viewport-bench.ts <out.json> label=path [label=path...]");
    }
    const collectGarbage = (globalThis as { gc?: () => void }).gc;
    if (!collectGarbage) {
        throw new Error("Run with --expose-gc");
    }
    // The dispatcher warns once per room about the oversized viewport: keep the output bounded.
    console.warn = () => {};

    const implementations: Array<{ label: string; path: string; Implementation: DispatcherConstructor }> = [];
    for (const arg of implementationArgs) {
        const separator = arg.indexOf("=");
        const label = arg.slice(0, separator);
        const path = resolve(arg.slice(separator + 1));
        const module = (await import(pathToFileURL(path).href)) as { PositionDispatcher: DispatcherConstructor };
        implementations.push({ label, path, Implementation: module.PositionDispatcher });
    }
    const reference = implementations[0].label;
    const noopRoom = { subscribeToZone() {}, unsubscribeFromZone() {} };
    const results: Record<string, unknown> = {};

    for (const scenario of buildScenarios()) {
        const behavior: Record<string, BehaviorResult> = {};
        for (const { label, Implementation } of implementations) {
            behavior[label] = observeBehavior(Implementation, scenario);
        }

        const worlds = implementations.map(({ label, Implementation }) => ({
            label,
            world: createWorld(Implementation, scenario, noopRoom, () => new Set<string>()),
        }));
        const count = scenario.steps.length;
        for (let warmup = 0; warmup < WARMUP_REPLAYS; warmup++) {
            for (const { world } of worlds) {
                replay(world, scenario.steps, 0, count);
            }
        }

        // Timed replays, interleaved: the order of the implementations rotates at every replay.
        const nsPerUpdate: Record<string, number[]> = {};
        for (const { label } of worlds) {
            nsPerUpdate[label] = [];
        }
        for (let run = 0; run < scenario.timedReplays; run++) {
            for (let offset = 0; offset < worlds.length; offset++) {
                const { label, world } = worlds[(run + offset) % worlds.length];
                collectGarbage();
                const start = process.hrtime.bigint();
                replay(world, scenario.steps, 0, count);
                const elapsed = process.hrtime.bigint() - start;
                nsPerUpdate[label].push(Number(elapsed) / count);
            }
        }

        // Allocation: heapUsed delta over the first `allocBatch` updates, then the rest of the trajectory untimed
        // so that every batch starts from the same state.
        const bytesPerUpdate: Record<string, number[]> = {};
        for (const { label } of worlds) {
            bytesPerUpdate[label] = [];
        }
        for (let run = 0; run < ALLOC_REPLAYS; run++) {
            for (let offset = 0; offset < worlds.length; offset++) {
                const { label, world } = worlds[(run + offset) % worlds.length];
                collectGarbage();
                const before = process.memoryUsage().heapUsed;
                replay(world, scenario.steps, 0, scenario.allocBatch);
                const after = process.memoryUsage().heapUsed;
                bytesPerUpdate[label].push((after - before) / scenario.allocBatch);
                replay(world, scenario.steps, scenario.allocBatch, count);
            }
        }

        const perImplementation: Record<string, unknown> = {};
        for (const { label } of worlds) {
            const pairedTime = nsPerUpdate[label].map((value, run) => value / nsPerUpdate[reference][run]);
            perImplementation[label] = {
                behavior: behavior[label],
                sameTraceAsReference: behavior[label].traceSha256 === behavior[reference].traceSha256,
                nsPerUpdate: summarize(nsPerUpdate[label]),
                bytesPerUpdate: summarize(bytesPerUpdate[label]),
                pairedTimeRatioVsReference: summarize(pairedTime),
                raw: {
                    nsPerUpdate: nsPerUpdate[label].map((value) => round(value, 1)),
                    bytesPerUpdate: bytesPerUpdate[label].map((value) => round(value, 1)),
                },
            };
            const time = summarize(nsPerUpdate[label]);
            const bytes = summarize(bytesPerUpdate[label]);
            const paired = summarize(pairedTime);
            console.log(
                [
                    scenario.name.padEnd(24),
                    label.padEnd(8),
                    `hit=${round(behavior[label].hitRatio * 100, 1)}%`.padEnd(11),
                    `ns/update med=${round(time.median, 0)} p10=${round(time.p10, 0)} p90=${round(time.p90, 0)}`.padEnd(
                        44,
                    ),
                    `B/update med=${round(bytes.median, 0)} min=${round(bytes.min, 0)} max=${round(bytes.max, 0)}`.padEnd(
                        42,
                    ),
                    `time/ref med=${round(paired.median, 3)} p10=${round(paired.p10, 3)} p90=${round(paired.p90, 3)}`,
                    `trace=${behavior[label].traceSha256.slice(0, 12)}`,
                ].join(" "),
            );
        }
        results[scenario.name] = {
            description: scenario.description,
            updatesPerReplay: count,
            sockets: scenario.sockets,
            timedReplays: scenario.timedReplays,
            allocBatch: scenario.allocBatch,
            allocReplays: ALLOC_REPLAYS,
            implementations: perImplementation,
        };
    }

    const newSpace = v8.getHeapSpaceStatistics().find((space) => space.space_name === "new_space");
    writeFileSync(
        resolve(outputPath),
        JSON.stringify(
            {
                node: process.version,
                arch: process.arch,
                platform: process.platform,
                execArgv: process.execArgv,
                newSpaceBytes: newSpace?.space_size,
                reference,
                implementations: implementations.map(({ label, path }) => ({ label, path })),
                warmupReplays: WARMUP_REPLAYS,
                scenarios: results,
            },
            null,
            1,
        ) + "\n",
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
