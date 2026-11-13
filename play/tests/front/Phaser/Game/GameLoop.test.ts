import * as Phaser from "phaser";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { Game } from "../../../../src/front/Phaser/Game/Game";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/svelte", () => ({ captureException }));

interface FakeEngine {
    events: { emit: Mock };
    scene: { update: Mock; render: Mock; isProcessing: boolean; scenes: unknown[] };
    renderer: { preRender: Mock; postRender: Mock };
}

// Phaser.Game boots a canvas and a renderer. Game.step only reads the fields below, so the base class is replaced at
// the module boundary and Game's own constructor and step run unchanged.
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

function createGame(sceneUpdate: (time: number, delta: number) => void) {
    const game = new Game({});
    const engine = game as unknown as FakeEngine;
    engine.scene.update.mockImplementation((time: number, delta: number) => {
        // Phaser's SceneManager.update sets this flag first, and its render() clears it.
        engine.scene.isProcessing = true;
        sceneUpdate(time, delta);
    });
    game.markDirty();
    return { game, engine };
}

/** Runs Phaser's frame loop with a fake requestAnimationFrame and returns the frames it scheduled. */
function startFrameLoop(game: Game): FrameRequestCallback[] {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
    });
    new Phaser.DOM.RequestAnimationFrame().start((time: number) => game.step(time, 16), false, 16);
    return frames;
}

describe("Game.step", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should update the scenes, then render a frame marked dirty", () => {
        const { game, engine } = createGame(() => {});

        game.step(1000, 16);

        expect(engine.scene.update).toHaveBeenCalledWith(1000, 16);
        expect(engine.renderer.preRender).toHaveBeenCalledTimes(1);
        expect(engine.scene.render).toHaveBeenCalledWith(engine.renderer);
        expect(engine.renderer.postRender).toHaveBeenCalledTimes(1);
    });

    it("should keep the frame loop going when a scene update throws, and report the error", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const error = new Error("boom");
        const { game, engine } = createGame(() => {
            throw error;
        });
        const frames = startFrameLoop(game);

        expect(() => frames[0](1000)).not.toThrow();

        expect(frames).toHaveLength(2);
        expect(engine.renderer.preRender).not.toHaveBeenCalled();
        expect(engine.scene.isProcessing).toBe(false);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining("failed frames since the last report: 1"),
            error,
        );
        expect(captureException).toHaveBeenCalledWith(error, { extra: { failedFramesSinceLastReport: 1 } });
    });

    it("should render the next frame after a failed one", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        let failing = true;
        const { game, engine } = createGame(() => {
            if (failing) throw new Error("boom");
        });

        game.step(1000, 16);
        failing = false;
        game.markDirty();
        game.step(1016, 16);

        expect(engine.scene.update).toHaveBeenCalledTimes(2);
        expect(engine.renderer.preRender).toHaveBeenCalledTimes(1);
        expect(engine.scene.render).toHaveBeenCalledTimes(1);
    });

    it("should report a frame error that repeats every frame at most once every 10 s, with the failed frame count", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        captureException.mockClear();
        const { game } = createGame(() => {
            throw new Error("boom");
        });

        for (let time = 1000; time < 11_000; time += 16) {
            game.step(time, 16);
        }
        expect(consoleError).toHaveBeenCalledTimes(1);

        game.step(11_000, 16);

        expect(consoleError).toHaveBeenCalledTimes(2);
        // The frame at 1000 ms is reported. The 624 frames up to 10_984 ms are only counted, and the frame at 11_000 ms
        // is reported with them.
        expect(captureException).toHaveBeenLastCalledWith(expect.any(Error), {
            extra: { failedFramesSinceLastReport: 625 },
        });
    });
});
