import * as Phaser from "phaser";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { Game } from "../../../../src/front/Phaser/Game/Game";

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

    it("GS-03 (pinned): stops the frame loop for good when a scene update throws", () => {
        const { game, engine } = createGame(() => {
            throw new Error("boom");
        });
        const frames = startFrameLoop(game);
        expect(frames).toHaveLength(1);

        expect(() => frames[0](1000)).toThrow("boom");

        expect(engine.renderer.preRender).not.toHaveBeenCalled();
        // Phaser schedules the next frame only after the callback returns, so the canvas freezes.
        expect(frames).toHaveLength(1);
    });
});
