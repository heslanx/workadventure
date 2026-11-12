// Micro-benchmark for candidate C1 (plans/architecture-and-replacements.md):
// "reduce the intermediate collection in remote-player interpolation".
//
// Pure logic only: no Phaser, no DOM, no project imports. Run with plain node:
//   node --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 interpolation-bench.mjs
//
// It measures the extracted computation only. It does NOT measure browser frame time,
// GC pauses on a phone, sprite updates, or rendering.
import { createHash } from "node:crypto";
import v8 from "node:v8";

// Copied from play/src/front/Enum/EnvironmentVariable.ts lines 43-44 (HEAD ddbe245a8).
const POSITION_DELAY = 200;
const MAX_EXTRAPOLATION_TIME = 100;

// Copied from play/src/front/Phaser/Game/PlayerMovement.ts lines 5-43 (HEAD ddbe245a8),
// TypeScript annotations removed, logic and field order unchanged.
class PlayerMovement {
    constructor(startPosition, startTick, endPosition, endTick) {
        this.startPosition = startPosition;
        this.startTick = startTick;
        this.endPosition = endPosition;
        this.endTick = endTick;
    }

    isOutdated(tick) {
        if (this.endPosition.moving === false && tick > this.endTick) {
            return true;
        }
        return tick > this.endTick + MAX_EXTRAPOLATION_TIME;
    }

    getPosition(tick) {
        if (tick >= this.endTick && this.endPosition.moving === false) {
            return this.endPosition;
        }
        const x =
            (this.endPosition.x - this.startPosition.x) * ((tick - this.startTick) / (this.endTick - this.startTick)) +
            this.startPosition.x;
        const y =
            (this.endPosition.y - this.startPosition.y) * ((tick - this.startTick) / (this.endTick - this.startTick)) +
            this.startPosition.y;
        return {
            x,
            y,
            oldX: this.startPosition.x,
            oldY: this.startPosition.y,
            direction: this.endPosition.direction,
            moving: this.isOutdated(tick) ? false : this.endPosition.moving,
        };
    }
}

// Variant "current": copied from play/src/front/Phaser/Game/PlayersPositionInterpolator.ts
// lines 8-29 (HEAD ddbe245a8). Allocates a Map on every call.
class InterpolatorCurrent {
    playerMovements = new Map();

    updatePlayerPosition(userId, playerMovement) {
        this.playerMovements.set(userId, playerMovement);
    }

    removePlayer(userId) {
        this.playerMovements.delete(userId);
    }

    getUpdatedPositions(tick) {
        const positions = new Map();
        this.playerMovements.forEach((playerMovement, userId) => {
            if (playerMovement.isOutdated(tick)) {
                this.playerMovements.delete(userId);
            }
            positions.set(userId, playerMovement.getPosition(tick));
        });
        return positions;
    }
}

// Variant "direct": the plan's alternative. Same loop, the consumer is called synchronously
// instead of reading an intermediate Map.
class InterpolatorDirect {
    playerMovements = new Map();

    updatePlayerPosition(userId, playerMovement) {
        this.playerMovements.set(userId, playerMovement);
    }

    removePlayer(userId) {
        this.playerMovements.delete(userId);
    }

    forEachUpdatedPosition(tick, callback) {
        this.playerMovements.forEach((playerMovement, userId) => {
            if (playerMovement.isOutdated(tick)) {
                this.playerMovements.delete(userId);
            }
            callback(playerMovement.getPosition(tick), userId);
        });
    }
}

// Variant "reusedMap": keeps the current signature and consumer, reuses one Map instance.
class InterpolatorReusedMap {
    playerMovements = new Map();
    positions = new Map();

    updatePlayerPosition(userId, playerMovement) {
        this.playerMovements.set(userId, playerMovement);
    }

    removePlayer(userId) {
        this.playerMovements.delete(userId);
    }

    getUpdatedPositions(tick) {
        const positions = this.positions;
        positions.clear();
        this.playerMovements.forEach((playerMovement, userId) => {
            if (playerMovement.isOutdated(tick)) {
                this.playerMovements.delete(userId);
            }
            positions.set(userId, playerMovement.getPosition(tick));
        });
        return positions;
    }
}

// Stand-in for the GameScene.ts consumer (lines 1498-1517): it only stores the emitted position.
// The real consumer also updates a Phaser sprite and conversation bubbles, which this bench omits.
class Sink {
    constructor(size) {
        this.x = new Float64Array(size);
        this.y = new Float64Array(size);
        this.count = 0;
        this.onEmit = undefined;
    }

    apply(moveEvent, userId) {
        this.x[userId] = moveEvent.x;
        this.y[userId] = moveEvent.y;
        this.count++;
        if (this.onEmit !== undefined) {
            this.onEmit(moveEvent, userId);
        }
    }
}

// Frame drivers mirror the shape of GameScene.update(): one closure per frame, consumed immediately.
function frameViaMap(interpolator, sink, tick) {
    const positions = interpolator.getUpdatedPositions(tick);
    positions.forEach((moveEvent, userId) => {
        sink.apply(moveEvent, userId);
    });
}

function frameDirect(interpolator, sink, tick) {
    interpolator.forEachUpdatedPosition(tick, (moveEvent, userId) => {
        sink.apply(moveEvent, userId);
    });
}

const VARIANTS = {
    current: { create: () => new InterpolatorCurrent(), frame: frameViaMap },
    direct: { create: () => new InterpolatorDirect(), frame: frameDirect },
    reusedMap: { create: () => new InterpolatorReusedMap(), frame: frameViaMap },
};

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------------------------
// Equivalence: one deterministic script of ticks and network events, replayed on every variant.
// ---------------------------------------------------------------------------------------------

const DIRECTIONS = ["up", "right", "down", "left"];

function buildScript({ players, frames, seed, jitteredFrames }) {
    const random = mulberry32(seed);
    const stats = { moves: 0, teleports: 0, stationaryUpdates: 0, directionChanges: 0, removals: 0, silences: 0 };
    const state = [];
    for (let id = 0; id < players; id++) {
        state.push({
            x: Math.floor(random() * 2000),
            y: Math.floor(random() * 2000),
            nextFrame: Math.floor(random() * 12),
            updates: 0,
            directionIndex: 0,
            removeAtFrame: -1,
        });
    }
    const script = [];
    let tick = 1000;
    for (let frame = 0; frame < frames; frame++) {
        tick += jitteredFrames ? 8 + random() * 25 : 1000 / 60;
        const operations = [];
        for (let id = 0; id < players; id++) {
            const player = state[id];
            if (player.removeAtFrame === frame) {
                operations.push({ type: "remove", id });
                stats.removals++;
            }
            if (player.nextFrame !== frame) {
                continue;
            }
            const kind = id % 6;
            let moving = true;
            let direction = "right";
            // About 200 ms between updates, sometimes late enough to exceed the extrapolation window.
            let delay = 12 + (random() < 0.2 ? Math.floor(random() * 10) : 0);
            player.updates++;
            if (kind === 0) {
                player.x += 32;
            } else if (kind === 1) {
                player.directionIndex = (player.directionIndex + 1) % 4;
                direction = DIRECTIONS[player.directionIndex];
                player.x += direction === "right" ? 32 : direction === "left" ? -32 : 0;
                player.y += direction === "down" ? 32 : direction === "up" ? -32 : 0;
                stats.directionChanges++;
            } else if (kind === 2) {
                moving = false;
                direction = "down";
                stats.stationaryUpdates++;
            } else if (kind === 3) {
                if (player.updates % 5 === 0) {
                    player.x += 5000;
                    player.y -= 3000;
                    stats.teleports++;
                } else {
                    player.y += 32;
                    direction = "down";
                }
            } else if (kind === 4) {
                player.x -= 32;
                direction = "left";
                if (player.updates % 8 === 0) {
                    delay = 40;
                    stats.silences++;
                }
            } else {
                const phase = player.updates % 4;
                if (phase === 0) {
                    moving = false;
                    delay = 30;
                    player.removeAtFrame = frame + 20;
                } else {
                    player.y -= 32;
                    direction = "up";
                    if (phase === 2 && random() < 0.5) {
                        // Removed while its movement is still active.
                        player.removeAtFrame = frame + 3;
                        delay = 15;
                    }
                }
            }
            operations.push({ type: "move", id, x: player.x, y: player.y, direction, moving });
            stats.moves++;
            player.nextFrame = frame + delay;
        }
        script.push({ tick, operations });
    }
    return { script, stats };
}

function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function replay(variantName, script, players) {
    const variant = VARIANTS[variantName];
    const interpolator = variant.create();
    const sink = new Sink(players);
    const digest = createHash("sha256");
    const frameHashes = new Uint32Array(script.length);
    let emitted = 0;
    let emittedNotMoving = 0;
    let framesWhereMovementsExpired = 0;
    let parts = [];
    sink.onEmit = (moveEvent, userId) => {
        emitted++;
        if (moveEvent.moving === false) {
            emittedNotMoving++;
        }
        parts.push(
            `${userId},${moveEvent.x},${moveEvent.y},${moveEvent.oldX},${moveEvent.oldY},${moveEvent.direction},${moveEvent.moving}`,
        );
    };
    for (let frame = 0; frame < script.length; frame++) {
        const { tick, operations } = script[frame];
        for (const operation of operations) {
            if (operation.type === "remove") {
                interpolator.removePlayer(operation.id);
                continue;
            }
            // Mirrors GameScene.doUpdatePlayerPosition (GameScene.ts lines 4605-4623): the movement
            // starts from the position the sprite currently has.
            interpolator.updatePlayerPosition(
                operation.id,
                new PlayerMovement(
                    { x: sink.x[operation.id], y: sink.y[operation.id] },
                    tick,
                    { x: operation.x, y: operation.y, direction: operation.direction, moving: operation.moving },
                    tick + POSITION_DELAY,
                ),
            );
        }
        const sizeBefore = interpolator.playerMovements.size;
        parts = [];
        variant.frame(interpolator, sink, tick);
        const sizeAfter = interpolator.playerMovements.size;
        if (sizeAfter < sizeBefore) {
            framesWhereMovementsExpired++;
        }
        const line = `${frame}|${sizeAfter}|${parts.join(";")}`;
        frameHashes[frame] = fnv1a(line);
        digest.update(line);
        digest.update("\n");
    }
    return {
        sha256: digest.digest("hex"),
        frameHashes,
        emitted,
        emittedNotMoving,
        framesWhereMovementsExpired,
    };
}

function runEquivalence() {
    const scenarios = [
        { players: 7, frames: 3000, seed: 11, jitteredFrames: false },
        { players: 60, frames: 3000, seed: 12, jitteredFrames: true },
        { players: 300, frames: 2000, seed: 13, jitteredFrames: true },
        { players: 1000, frames: 1200, seed: 14, jitteredFrames: false },
        { players: 1000, frames: 1200, seed: 15, jitteredFrames: true },
    ];
    const results = [];
    let allIdentical = true;
    for (const scenario of scenarios) {
        const { script, stats } = buildScript(scenario);
        const reference = replay("current", script, scenario.players);
        const row = {
            scenario,
            script: stats,
            emitted: reference.emitted,
            emittedNotMoving: reference.emittedNotMoving,
            framesWhereMovementsExpired: reference.framesWhereMovementsExpired,
            sha256: { current: reference.sha256 },
            firstMismatchFrame: {},
        };
        for (const name of ["direct", "reusedMap"]) {
            const other = replay(name, script, scenario.players);
            row.sha256[name] = other.sha256;
            let firstMismatch = -1;
            for (let frame = 0; frame < script.length; frame++) {
                if (other.frameHashes[frame] !== reference.frameHashes[frame]) {
                    firstMismatch = frame;
                    break;
                }
            }
            row.firstMismatchFrame[name] = firstMismatch;
            if (other.sha256 !== reference.sha256 || other.emitted !== reference.emitted) {
                allIdentical = false;
            }
        }
        results.push(row);
    }
    return { allIdentical, results };
}

// The one path where "direct" is not equivalent: the consumer throwing mid-iteration
// (GameScene.ts line 1503 throws when a player is missing).
function runConsumerThrowCheck() {
    const outcome = {};
    for (const name of Object.keys(VARIANTS)) {
        const variant = VARIANTS[name];
        const interpolator = variant.create();
        for (let id = 0; id < 3; id++) {
            interpolator.updatePlayerPosition(
                id,
                new PlayerMovement({ x: 0, y: 0 }, 0, { x: 10, y: 10, direction: "down", moving: false }, 200),
            );
        }
        const sink = new Sink(3);
        sink.onEmit = () => {
            throw new Error("consumer failed");
        };
        try {
            variant.frame(interpolator, sink, 500);
        } catch {
            // Expected.
        }
        outcome[name] = { expiredMovementsStillStoredAfterThrow: interpolator.playerMovements.size };
    }
    return outcome;
}

// ---------------------------------------------------------------------------------------------
// Timing and allocation: steady state, every one of N remote players is mid-movement.
// ---------------------------------------------------------------------------------------------

function createLoaded(variantName, players) {
    const interpolator = VARIANTS[variantName].create();
    for (let id = 0; id < players; id++) {
        interpolator.updatePlayerPosition(
            id,
            new PlayerMovement(
                { x: id * 3.5, y: id * 1.25 },
                0,
                { x: id * 3.5 + 32, y: id * 1.25 + 16, direction: "right", moving: true },
                POSITION_DELAY,
            ),
        );
    }
    return interpolator;
}

// Ticks stay inside [0, 200): the interpolation branch runs and nothing expires, so N is constant.
function runFrames(frame, interpolator, sink, frames) {
    for (let index = 0; index < frames; index++) {
        frame(interpolator, sink, (index * 16.6667) % POSITION_DELAY);
    }
}

function timeFrames(frame, interpolator, sink, frames) {
    const start = process.hrtime.bigint();
    runFrames(frame, interpolator, sink, frames);
    return Number(process.hrtime.bigint() - start) / frames;
}

function allocationPerFrame(frame, interpolator, sink, frames) {
    globalThis.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const allocatedBefore = v8.getHeapStatistics().total_allocated_bytes;
    runFrames(frame, interpolator, sink, frames);
    const allocatedAfter = v8.getHeapStatistics().total_allocated_bytes;
    const heapAfter = process.memoryUsage().heapUsed;
    return {
        heapDelta: (heapAfter - heapBefore) / frames,
        totalAllocated: allocatedBefore === undefined ? Number.NaN : (allocatedAfter - allocatedBefore) / frames,
    };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
}

function bootstrapMedianInterval(values, random) {
    const medians = [];
    const sample = new Array(values.length);
    for (let round = 0; round < 2000; round++) {
        for (let index = 0; index < values.length; index++) {
            sample[index] = values[Math.floor(random() * values.length)];
        }
        medians.push(median(sample));
    }
    return [percentile(medians, 0.025), percentile(medians, 0.975)];
}

// Slots: "control" is a second, independent instance of the current implementation. Its ratio
// against "current" is the noise floor of the comparison itself.
const SLOTS = [
    { name: "current", variant: "current" },
    { name: "direct", variant: "direct" },
    { name: "reusedMap", variant: "reusedMap" },
    { name: "control", variant: "current" },
];

const THRESHOLD = 0.1;

function summarize(samplesBySlot, random) {
    const summary = { median: {}, min: {}, max: {} };
    for (const slot of SLOTS) {
        summary.median[slot.name] = median(samplesBySlot[slot.name]);
        summary.min[slot.name] = Math.min(...samplesBySlot[slot.name]);
        summary.max[slot.name] = Math.max(...samplesBySlot[slot.name]);
    }
    const base = samplesBySlot.current;
    const controlRatios = samplesBySlot.control.map((value, index) => value / base[index]);
    const controlBias = Math.abs(1 - median(controlRatios));
    summary.control = {
        medianRatio: median(controlRatios),
        p05: percentile(controlRatios, 0.05),
        p95: percentile(controlRatios, 0.95),
    };
    summary.comparison = {};
    for (const name of ["direct", "reusedMap"]) {
        const ratios = samplesBySlot[name].map((value, index) => value / base[index]);
        const [low, high] = bootstrapMedianInterval(ratios, random);
        const improvement = 1 - median(ratios);
        // Conservative: worst end of the 95% interval, minus the bias seen between two identical runs.
        const improvementBeyondNoise = 1 - high - controlBias;
        summary.comparison[name] = {
            medianRatio: median(ratios),
            ratioInterval95: [low, high],
            improvement,
            improvementBeyondNoise,
            passes: improvementBeyondNoise >= THRESHOLD,
        };
    }
    return summary;
}

function runMeasurements({ repetitions }) {
    const random = mulberry32(2026);
    const results = [];
    for (const players of [0, 20, 100, 500, 1000]) {
        const timedFrames = Math.max(300, Math.floor(400000 / Math.max(players, 4)));
        // Keep each allocation window well below the young generation so no scavenge hides bytes.
        const allocationFrames = Math.max(20, Math.floor(8000 / Math.max(players, 4)));
        const instances = SLOTS.map((slot) => ({
            ...slot,
            frame: VARIANTS[slot.variant].frame,
            interpolator: createLoaded(slot.variant, players),
            sink: new Sink(Math.max(players, 1)),
        }));
        for (let round = 0; round < 3; round++) {
            for (const instance of instances) {
                runFrames(instance.frame, instance.interpolator, instance.sink, timedFrames);
            }
        }
        const time = Object.fromEntries(SLOTS.map((slot) => [slot.name, []]));
        const heapDelta = Object.fromEntries(SLOTS.map((slot) => [slot.name, []]));
        const totalAllocated = Object.fromEntries(SLOTS.map((slot) => [slot.name, []]));
        for (let repetition = 0; repetition < repetitions; repetition++) {
            for (let offset = 0; offset < instances.length; offset++) {
                const instance = instances[(repetition + offset) % instances.length];
                time[instance.name].push(
                    timeFrames(instance.frame, instance.interpolator, instance.sink, timedFrames),
                );
            }
            for (let offset = 0; offset < instances.length; offset++) {
                const instance = instances[(repetition + offset) % instances.length];
                const allocation = allocationPerFrame(
                    instance.frame,
                    instance.interpolator,
                    instance.sink,
                    allocationFrames,
                );
                heapDelta[instance.name].push(allocation.heapDelta);
                totalAllocated[instance.name].push(allocation.totalAllocated);
            }
        }
        results.push({
            players,
            timedFrames,
            allocationFrames,
            repetitions,
            nsPerFrame: summarize(time, random),
            heapDeltaBytesPerFrame: summarize(heapDelta, random),
            totalAllocatedBytesPerFrame: summarize(totalAllocated, random),
        });
    }
    return results;
}

function format(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printMetric(title, unit, results, key) {
    console.log(`\n${title} (${unit}; median of ${results[0].repetitions} interleaved repetitions)`);
    console.log(
        "players | current | direct | reusedMap | control/current p05..p95 | direct gain (95% ratio interval) beyond-noise pass | reusedMap gain beyond-noise pass",
    );
    for (const result of results) {
        const metric = result[key];
        const direct = metric.comparison.direct;
        const reused = metric.comparison.reusedMap;
        console.log(
            [
                String(result.players).padStart(7),
                format(metric.median.current),
                format(metric.median.direct),
                format(metric.median.reusedMap),
                `${format(metric.control.p05, 3)}..${format(metric.control.p95, 3)}`,
                `${format(direct.improvement * 100)}% (${format(direct.ratioInterval95[0], 3)}..${format(direct.ratioInterval95[1], 3)}) ${format(direct.improvementBeyondNoise * 100)}% ${direct.passes ? "PASS" : "FAIL"}`,
                `${format(reused.improvement * 100)}% ${format(reused.improvementBeyondNoise * 100)}% ${reused.passes ? "PASS" : "FAIL"}`,
            ].join(" | "),
        );
    }
}

if (typeof globalThis.gc !== "function") {
    console.error("Run with --expose-gc");
    process.exit(2);
}

const repetitions = Number(process.env.BENCH_REPETITIONS ?? 30);
const equivalence = runEquivalence();
const consumerThrow = runConsumerThrowCheck();
const measurements = runMeasurements({ repetitions });

console.log(`node ${process.version} v8 ${process.versions.v8} ${process.platform}/${process.arch}`);
console.log(`\nEquivalence over deterministic trajectories: ${equivalence.allIdentical ? "IDENTICAL" : "MISMATCH"}`);
for (const row of equivalence.results) {
    console.log(
        `  players=${row.scenario.players} frames=${row.scenario.frames} seed=${row.scenario.seed} jittered=${row.scenario.jitteredFrames}` +
            ` moves=${row.script.moves} teleports=${row.script.teleports} stationary=${row.script.stationaryUpdates}` +
            ` directionChanges=${row.script.directionChanges} removals=${row.script.removals} silences=${row.script.silences}` +
            ` emitted=${row.emitted} emittedNotMoving=${row.emittedNotMoving} framesWithExpiry=${row.framesWhereMovementsExpired}` +
            ` sha256=${row.sha256.current.slice(0, 16)} direct=${row.sha256.direct === row.sha256.current ? "same" : `DIFF@${row.firstMismatchFrame.direct}`}` +
            ` reusedMap=${row.sha256.reusedMap === row.sha256.current ? "same" : `DIFF@${row.firstMismatchFrame.reusedMap}`}`,
    );
}
console.log(`\nConsumer throws on the first of 3 expired movements: ${JSON.stringify(consumerThrow)}`);

printMetric("Time per frame call", "ns", measurements, "nsPerFrame");
printMetric("Heap delta per frame call", "bytes, heapUsed after gc()", measurements, "heapDeltaBytesPerFrame");
printMetric("Allocated per frame call", "bytes, v8 total_allocated_bytes", measurements, "totalAllocatedBytesPerFrame");

console.log(`\nJSON ${JSON.stringify({ equivalence, consumerThrow, measurements })}`);

process.exit(equivalence.allIdentical ? 0 : 1);
