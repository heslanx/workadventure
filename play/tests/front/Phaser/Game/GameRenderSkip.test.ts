// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Game } from "../../../../src/front/Phaser/Game/Game";
import {
    GAME_RENDER_SKIP_COVERED_STORAGE_KEY,
    GAME_STEP_CAP_STORAGE_KEY,
} from "../../../../src/front/Phaser/Game/GameLoopFlags";
import {
    FULL_SCREEN_MEETING_COVER_OPACITY,
    isMapFullyCovered,
    mapCovers,
} from "../../../../src/front/Phaser/Game/GameRenderSkip";

vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));

interface FakeEngine {
    events: { emit: Mock };
    scene: { update: Mock; render: Mock; isProcessing: boolean; scenes: unknown[] };
    renderer: { preRender: Mock; postRender: Mock };
}

// See GameLoop.test.ts: Game.step only reads these fields of Phaser.Game.
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

const SRC = resolve(__dirname, "../../../../src/front");

describe("which covers hide the map", () => {
    it("is covered by a full-screen co-website, which hides the game container", () => {
        expect(isMapFullyCovered(mapCovers({ fullScreenCowebsite: true, fullScreenMeeting: false }))).toBe(true);
    });

    it("is not covered by a full-screen meeting: it is translucent and the map shows through it", () => {
        expect(isMapFullyCovered(mapCovers({ fullScreenCowebsite: false, fullScreenMeeting: true }))).toBe(false);
    });

    it("is not covered by nothing at all, nor by a cover that lets the map through", () => {
        expect(isMapFullyCovered(mapCovers({ fullScreenCowebsite: false, fullScreenMeeting: false }))).toBe(false);
        expect(isMapFullyCovered([{ opacity: 0.99 }])).toBe(false);
        expect(isMapFullyCovered([])).toBe(false);
    });

    it("is covered when any one cover is opaque", () => {
        expect(isMapFullyCovered(mapCovers({ fullScreenCowebsite: true, fullScreenMeeting: true }))).toBe(true);
    });

    it("keeps the meeting opacity in line with the background VideoMediaBox draws", () => {
        const videoMediaBox = readFileSync(resolve(SRC, "Components/Video/VideoMediaBox.svelte"), "utf8");

        // The full-screen branch of the box: bg-contrast/80 backdrop-blur. When it changes, revisit the constant.
        expect(videoMediaBox).toContain(`"bg-contrast/${FULL_SCREEN_MEETING_COVER_OPACITY * 100} backdrop-blur"`);
    });

    it("is fed to the game by App.svelte from the co-website and meeting stores", () => {
        const app = readFileSync(resolve(SRC, "Components/App.svelte"), "utf8");

        expect(app).toContain("fullScreenCowebsite: $fullScreenCowebsite,");
        expect(app).toContain("fullScreenMeeting: $highlightFullScreen && $highlightedEmbedScreen !== undefined,");
        expect(app).toContain("game?.setCoveredByUi(");
    });
});

describe("Game.setCoveredByUi", () => {
    beforeEach(() => {
        localStorage.clear();
        // Frames 20 ms apart: the step cap, on by default, must not be what these tests see
        localStorage.setItem(GAME_STEP_CAP_STORAGE_KEY, "0");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    function createGame(flag: "1" | "0" | undefined) {
        if (flag !== undefined) {
            localStorage.setItem(GAME_RENDER_SKIP_COVERED_STORAGE_KEY, flag);
        }
        const game = new Game({});
        const engine = game as unknown as FakeEngine;
        engine.scene.update.mockImplementation(() => {
            // Phaser's SceneManager.update sets this flag first, and its render() clears it.
            engine.scene.isProcessing = true;
        });
        return { game, engine };
    }

    it("does not render a step while covered, but updates the scenes and frees the scene manager", () => {
        const { game, engine } = createGame("1");
        game.markDirty();
        game.setCoveredByUi(true);

        game.step(1000, 20);

        expect(engine.scene.update).toHaveBeenCalledWith(1000, 20);
        expect(engine.events.emit).toHaveBeenCalledWith(Phaser.Core.Events.POST_STEP, 1000, 20);
        expect(engine.renderer.preRender).not.toHaveBeenCalled();
        expect(engine.scene.render).not.toHaveBeenCalled();
        expect(engine.scene.isProcessing).toBe(false);
    });

    it("keeps stepping every frame while covered", () => {
        const { game, engine } = createGame("1");
        game.setCoveredByUi(true);

        for (let time = 1000; time < 2000; time += 20) {
            game.markDirty();
            game.step(time, 20);
        }

        expect(engine.scene.update).toHaveBeenCalledTimes(50);
        expect(engine.scene.render).not.toHaveBeenCalled();
    });

    it("renders at once on the first step after the cover goes away, even though nothing is dirty, and once", () => {
        const { game, engine } = createGame("1");
        game.markDirty();
        game.step(1000, 20);
        expect(engine.scene.render).toHaveBeenCalledTimes(1);
        game.step(1020, 20);
        // Nothing moved: no render without a cover either
        expect(engine.scene.render).toHaveBeenCalledTimes(1);

        game.setCoveredByUi(true);
        game.step(1040, 20);
        game.step(1060, 20);
        expect(engine.scene.render).toHaveBeenCalledTimes(1);

        game.setCoveredByUi(false);
        game.step(1080, 20);
        expect(engine.scene.render).toHaveBeenCalledTimes(2);
        expect(engine.renderer.preRender).toHaveBeenCalledTimes(2);
        game.step(1100, 20);
        expect(engine.scene.render).toHaveBeenCalledTimes(2);
    });

    it("renders what was marked dirty under the cover once it is gone", () => {
        const { game, engine } = createGame("1");
        game.setCoveredByUi(true);
        game.markDirty();
        game.step(1000, 20);

        game.setCoveredByUi(false);
        game.step(1020, 20);

        expect(engine.scene.render).toHaveBeenCalledTimes(1);
    });

    it("renders as usual when it is told nothing covers the map", () => {
        const { game, engine } = createGame("1");
        game.setCoveredByUi(false);
        game.markDirty();

        game.step(1000, 20);

        expect(engine.scene.render).toHaveBeenCalledTimes(1);
    });

    it("renders while covered when the flag is off, which is the default", () => {
        for (const flag of [undefined, "0" as const]) {
            localStorage.clear();
            localStorage.setItem(GAME_STEP_CAP_STORAGE_KEY, "0");
            const { game, engine } = createGame(flag);
            game.setCoveredByUi(true);
            game.markDirty();

            game.step(1000, 20);

            expect(engine.scene.render).toHaveBeenCalledTimes(1);
        }
    });
});
