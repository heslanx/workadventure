// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Game } from "../../../../src/front/Phaser/Game/Game";
import { GAME_STEP_CAP_STORAGE_KEY } from "../../../../src/front/Phaser/Game/GameLoopFlags";
import { StepCap } from "../../../../src/front/Phaser/Game/GameStepCap";

vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));

interface FakeEngine {
    events: { emit: Mock };
    scene: { update: Mock; render: Mock; isProcessing: boolean; scenes: unknown[] };
    renderer: { preRender: Mock; postRender: Mock };
}

// Phaser.Game boots a canvas and a renderer. Game.step only reads the fields below, so the base class is replaced at
// the module boundary: Game's own constructor and step run unchanged, and the TimeStep, Clock and arcade World of
// Phaser that the tests drive are the real ones.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof Phaser>();
    class FakePhaserGame {
        events = { emit: vi.fn() };
        scene = { update: vi.fn(), render: vi.fn(), isProcessing: false, scenes: [] };
        renderer = { preRender: vi.fn(), postRender: vi.fn() };
        scale = { on: vi.fn() };
        isPaused = false;
        pendingDestroy = false;
    }
    return { ...actual, Game: FakePhaserGame };
});

const START = 5000;
const AVATAR_SPEED = 180; // px per second: WOKA_SPEED (9) * 20, what Player.moveBy gives the arcade body
const PHYSICS_STEP_PX = AVATAR_SPEED / 60;

/** The fps config of App.svelte, plus the limit a test may ask Phaser for. */
function appFps(limit = 0): Phaser.Types.Core.FPSConfig {
    return {
        min: 60,
        target: 60,
        forceSetTimeOut: false,
        deltaHistory: 120,
        panicMax: 20,
        smoothStep: false,
        ...(limit > 0 ? { limit } : {}),
    };
}

/** The timestamps of a display refreshing at `hz`, `jitterMs` of deterministic noise either way. */
function frameTimes(hz: number, durationMs: number, jitterMs = 0): number[] {
    const times: number[] = [];
    let seed = 7;
    const noise = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647 - 0.5;
    };
    for (let i = 1; i * (1000 / hz) <= durationMs; i++) {
        times.push(START + i * (1000 / hz) + 2 * jitterMs * noise());
    }
    return times;
}

/** The real arcade World and the real Clock of Phaser, driven the way a scene's update drives them. */
function createSimulation() {
    const events = { once: vi.fn(), on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    const scene = { sys: { events, settings: {}, scale: { width: 800, height: 600 } } } as unknown as Phaser.Scene;
    const world = new Phaser.Physics.Arcade.World(scene, { fps: 60 });
    const avatar = {
        x: 0,
        y: 0,
        displayWidth: 16,
        displayHeight: 16,
        displayOriginX: 8,
        displayOriginY: 8,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
    };
    const body = new Phaser.Physics.Arcade.Body(world, avatar as unknown as Phaser.GameObjects.GameObject);
    world.bodies.add(body);
    const clock = new Phaser.Time.Clock(scene);
    return { world, body, avatar, clock };
}

interface RunResult {
    /** The distance the avatar moved by the arcade body, in px. */
    walked: number;
    /** The real time (ms after the start) of the frame in which the 1000 ms timer fired, or undefined. */
    timerFiredAt: number | undefined;
    /** The sum of the deltas the scene was updated with. */
    deliveredMs: number;
    updates: number;
    renders: number;
    frames: number;
}

/**
 * Runs the real TimeStep, driven by fake requestAnimationFrame timestamps of a display at `hz`, into the real
 * Game.step, which updates a real arcade body (a key held down moves it at the avatar's speed) and a real Clock
 * (a 1000 ms delayed call).
 */
function run(options: { hz: number; heldMs: number; jitterMs?: number; phaserLimit?: number }): RunResult {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
    });
    vi.spyOn(window.performance, "now").mockReturnValue(START);

    const game = new Game({});
    const engine = game as unknown as FakeEngine;
    const { world, body, avatar, clock } = createSimulation();
    let timerFiredAt: number | undefined;
    let now = START;
    clock.addEvent({
        delay: 1000,
        callback: () => {
            timerFiredAt = now - START;
        },
    });
    clock.preUpdate();

    let delivered = 0;
    engine.scene.update.mockImplementation((time: number, delta: number) => {
        engine.scene.isProcessing = true;
        delivered += delta;
        clock.update(time, delta);
        game.markDirty();
        body.setVelocityX(time - START <= options.heldMs ? AVATAR_SPEED : 0);
        world.update(time, delta);
        world.postUpdate();
    });
    game.markDirty();

    const timeStep = new Phaser.Core.TimeStep(game, appFps(options.phaserLimit));
    timeStep.start((time: number, delta: number) => game.step(time, delta));

    const times = frameTimes(options.hz, options.heldMs + 400, options.jitterMs);
    for (const time of times) {
        now = time;
        const next = frames.shift();
        next?.(time);
    }
    return {
        walked: avatar.x,
        timerFiredAt,
        deliveredMs: delivered,
        updates: engine.scene.update.mock.calls.length,
        renders: engine.scene.render.mock.calls.length,
        frames: times.length,
    };
}

describe("StepCap", () => {
    it("skips no step on a 60 Hz screen, jitter included, and hands each step its own delta", () => {
        const cap = new StepCap();
        let previous = START;
        for (const time of frameTimes(60, 10_000, 0.5)) {
            expect(cap.admit(time, time - previous)).toBeCloseTo(time - previous, 9);
            previous = time;
        }
    });

    it("skips no step at the 16 ms tick of BackgroundBootPump", () => {
        const cap = new StepCap();
        for (let time = START; time < START + 10_000; time += 16) {
            expect(cap.admit(time, 16)).toBe(16);
        }
    });

    it("steps every second frame of a 120 Hz screen, with the whole time that passed", () => {
        const cap = new StepCap();
        const deltas: (number | undefined)[] = [];
        let previous = START;
        for (const time of frameTimes(120, 1000)) {
            deltas.push(cap.admit(time, time - previous));
            previous = time;
        }

        const stepped = deltas.filter((delta) => delta !== undefined);
        expect(stepped.length).toBeGreaterThanOrEqual(59);
        expect(stepped.length).toBeLessThanOrEqual(61);
        for (const delta of stepped.slice(1)) {
            expect(delta).toBeCloseTo(1000 / 60, 5);
        }
    });

    it.each([75, 90, 100, 120, 144, 165, 240])(
        "steps %i Hz screens 60 times per second and never loses or repeats time",
        (hz) => {
            const cap = new StepCap();
            let previous = START;
            let delivered = 0;
            let steps = 0;
            const times = frameTimes(hz, 10_000, 0.2);
            for (const time of times) {
                const delta = cap.admit(time, time - previous);
                previous = time;
                if (delta !== undefined) {
                    steps++;
                    delivered += delta;
                }
            }

            expect(steps / 10).toBeGreaterThan(57);
            expect(steps / 10).toBeLessThanOrEqual(60.2);
            // What was delivered is the real time up to the last step: the remainder is still waiting, none is lost.
            expect(delivered).toBeLessThanOrEqual(previous - START + 1e-6);
            expect(previous - START - delivered).toBeLessThan(1000 / 60 + 1);
        },
    );

    it("starts a new schedule after a stall instead of stepping a burst", () => {
        const cap = new StepCap();
        cap.admit(START, 6);
        cap.admit(START + 20, 20);

        expect(cap.admit(START + 2000, 1980)).toBe(1980);
        expect(cap.admit(START + 2007, 7)).toBeUndefined();
        expect(cap.admit(START + 2014, 7)).toBeUndefined();
        expect(cap.admit(START + 2021, 7)).toBe(21);
    });
});

describe("the game step cap, with the real Phaser TimeStep, Clock and arcade World", () => {
    const STEP_MS = 1000 / 60;

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    /** What the game does today on a 60 Hz screen, which is what every screen must walk and time like. */
    function reference(): RunResult {
        localStorage.setItem(GAME_STEP_CAP_STORAGE_KEY, "0");
        const result = run({ hz: 60, heldMs: 800 });
        vi.restoreAllMocks();
        localStorage.clear();
        return result;
    }

    it("moves a key held for 800 ms as far at 120 and 144 Hz as at 60 Hz", () => {
        const sixty = reference();

        for (const hz of [60, 120, 144]) {
            const result = run({ hz, heldMs: 800 });
            vi.restoreAllMocks();

            // The arcade world steps at 60 Hz, so the distance is a whole number of 3 px steps: one step of slack
            expect(Math.abs(result.walked - sixty.walked)).toBeLessThanOrEqual(PHYSICS_STEP_PX);
            expect(result.walked).toBeGreaterThan(144 - 2 * PHYSICS_STEP_PX);
            expect(result.walked).toBeLessThanOrEqual(144);
        }
    });

    it("fires a 1000 ms timer at 1000 ms at 60, 120 and 144 Hz", () => {
        for (const hz of [60, 120, 144]) {
            const result = run({ hz, heldMs: 800 });
            vi.restoreAllMocks();

            // Simulated frame time, not the clock: the timer fires in the first step at or after 1000 ms
            expect(result.timerFiredAt).toBeGreaterThanOrEqual(1000);
            expect(result.timerFiredAt).toBeLessThanOrEqual(1000 + STEP_MS + 1);
        }
    });

    it("gives the scenes exactly the real time that passed: none lost, none counted twice", () => {
        for (const hz of [60, 120, 144]) {
            const result = run({ hz, heldMs: 800 });
            vi.restoreAllMocks();

            const elapsed = (result.frames * 1000) / hz;
            expect(result.deliveredMs).toBeLessThanOrEqual(elapsed + 1e-6);
            expect(elapsed - result.deliveredMs).toBeLessThan(STEP_MS + 1);
        }
    });

    it("steps and renders every frame of a 60 Hz screen, jitter included", () => {
        const result = run({ hz: 60, heldMs: 800, jitterMs: 0.5 });

        expect(result.updates).toBe(result.frames);
        expect(result.renders).toBe(result.frames);
    });

    it("steps and renders 60 times per second on a 120 and a 144 Hz screen", () => {
        for (const hz of [120, 144]) {
            const result = run({ hz, heldMs: 800 });
            vi.restoreAllMocks();

            const seconds = result.frames / hz;
            expect(result.updates / seconds).toBeGreaterThan(58);
            expect(result.updates / seconds).toBeLessThanOrEqual(61);
            expect(result.renders).toBe(result.updates);
        }
    });

    it("steps every frame of a 120 Hz screen when the flag is off", () => {
        localStorage.setItem(GAME_STEP_CAP_STORAGE_KEY, "0");

        const result = run({ hz: 120, heldMs: 800 });

        expect(result.updates).toBe(result.frames);
    });

    it("is why Phaser's own fps.limit is not used: it delivers the remainder twice", () => {
        localStorage.setItem(GAME_STEP_CAP_STORAGE_KEY, "0");
        for (const hz of [60, 120, 144]) {
            const result = run({ hz, heldMs: 800, phaserLimit: 60 });
            vi.restoreAllMocks();

            // Phaser pull request 7395: the avatar runs 20 to 30% too far, and the 1000 ms timer fires 150 to 250 ms early
            expect(result.walked).toBeGreaterThan(144 + 3 * PHYSICS_STEP_PX);
            expect(result.timerFiredAt).toBeLessThan(900);
        }
    });
});
