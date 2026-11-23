// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E2EHooks reaches the game through the game manager and the media stores, which pull in the whole front end.
const scene = vi.hoisted((): { current: unknown; wokaList: unknown } => ({ current: undefined, wokaList: undefined }));
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => scene.current,
        loadWokaData: () => Promise.resolve(scene.wokaList),
    },
}));
vi.mock("../../../src/front/Stores/MediaStore", () => ({
    rawLocalVideoTrackStore: {},
    backgroundProcessedLocalVideoTrackStore: {},
}));

import {
    E2E_BENCH_KEY,
    e2eHooks,
    FRAME_CAPTURE_TIMEOUT_MS,
    POST_FILTER_NODE,
    SHADED_POST_FILTER_NODE,
} from "../../../src/front/Utils/E2EHooks";
import {
    clearShadingBenchSource,
    setShadingBenchSource,
    type ShadingCounters,
} from "../../../src/front/Utils/FrameBench";
import { createFakeTimerGl } from "./fakeTimerGl";

const { PRE_STEP, POST_STEP, POST_RENDER } = Phaser.Core.Events;
const { UPDATE, POST_UPDATE } = Phaser.Scenes.Events;
const MS = 1_000_000;

type Listener = (...args: unknown[]) => void;

class Emitter {
    readonly listeners = new Map<string, Set<Listener>>();
    on(event: string, listener: Listener): this {
        this.listeners.set(event, (this.listeners.get(event) ?? new Set<Listener>()).add(listener));
        return this;
    }
    once(event: string, listener: Listener): this {
        const wrapper: Listener = (...args) => {
            this.off(event, wrapper);
            listener(...args);
        };
        return this.on(event, wrapper);
    }
    off(event: string, listener: Listener): this {
        this.listeners.get(event)?.delete(listener);
        return this;
    }
    emit(event: string, ...args: unknown[]): void {
        for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
    }
    count(event: string): number {
        return this.listeners.get(event)?.size ?? 0;
    }
    total(): number {
        return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    }
}

const WOKA_LIST = {
    body: { collections: [{ textures: [{ id: "b", url: "u/b" }] }] },
    eyes: { collections: [{ textures: [{ id: "e", url: "u/e" }] }] },
    hair: { collections: [{ textures: [{ id: "h", url: "u/h" }] }] },
    clothes: { collections: [{ textures: [{ id: "c", url: "u/c" }] }] },
};

const MANIFEST = {
    map: [2752, 1792],
    glassFaces: [[400, 700, 500]],
    staticLights: [{ kind: "lamp", at: [1000, 600] }],
    rooms: [{ key: "r", layer: "l", rect: [100, 100, 500, 400], floor: [110, 110, 480, 380] }],
};

function makeScene(gl?: unknown) {
    const gameEvents = new Emitter();
    const sceneEvents = new Emitter();
    const added: { userId: number; characterTextures: unknown[] }[] = [];
    const moved: number[] = [];
    const removed: number[] = [];
    const inScene = new Map<number, { isCulled(): boolean; getDetail(): string }>();
    const filters: { active: boolean; renderNode: string }[] = [];
    const camera = { startManualPan: vi.fn(), panBy: vi.fn(), resumePlayerFollow: vi.fn() };
    const value = {
        game: { events: gameEvents, renderer: gl === undefined ? undefined : { gl } },
        events: sceneEvents,
        cameras: { main: { filters: { internal: { list: filters } } } },
        Map: { widthInPixels: 2752, heightInPixels: 1792 },
        mapUrlFile: "http://maps.test/hq/map.json",
        MapPlayersByKey: inScene,
        textures: { exists: () => false },
        getCameraManager: () => camera,
        getRemotePlayersRepository: () => ({
            addPlayer: (message: { userId: number; characterTextures: unknown[] }) => {
                added.push(message);
            },
            movePlayer: (message: { userId: number }) => {
                moved.push(message.userId);
            },
            removePlayer: (userId: number) => {
                removed.push(userId);
            },
        }),
    };
    scene.current = value;
    /** The scene's update: applies the repository's joins and leaves, then POST_UPDATE. */
    const runUpdate = (time = 0) => {
        sceneEvents.emit(UPDATE, time);
        for (const message of added) {
            inScene.set(message.userId, { isCulled: () => false, getDetail: () => "sprite" });
        }
        for (const userId of removed) inScene.delete(userId);
        sceneEvents.emit(POST_UPDATE);
    };
    return { gameEvents, sceneEvents, added, moved, removed, inScene, camera, filters, runUpdate };
}

beforeEach(() => {
    localStorage.clear();
    scene.wokaList = WOKA_LIST;
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(MANIFEST), { status: 200 }))),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { e2eHooks?: unknown }).e2eHooks;
    scene.current = undefined;
});

describe("e2eHooks synthetic crowd", () => {
    it("refuses to run in a session that has not opted in, and spawns nothing", async () => {
        const fake = makeScene();
        (window as { e2eHooks?: unknown }).e2eHooks = e2eHooks;

        await expect(e2eHooks.spawnSyntheticCrowd(5)).rejects.toThrow("bench session");

        expect(fake.added).toHaveLength(0);
    });

    it('refuses to run for any value of the key but "1", and spawns nothing', async () => {
        const fake = makeScene();
        (window as { e2eHooks?: unknown }).e2eHooks = e2eHooks;
        localStorage.setItem(E2E_BENCH_KEY, "true");

        await expect(e2eHooks.spawnSyntheticCrowd(5)).rejects.toThrow("bench session");

        expect(fake.added).toHaveLength(0);
    });

    it("spawns through the repository with multi-layer recipes once the session opted in, and clears them all", async () => {
        const fake = makeScene();
        (window as { e2eHooks?: unknown }).e2eHooks = e2eHooks;
        localStorage.setItem(E2E_BENCH_KEY, "1");

        const spawning = e2eHooks.spawnSyntheticCrowd(40);
        await vi.waitFor(() => expect(fake.added).toHaveLength(40));
        fake.runUpdate(1000);
        const report = await spawning;

        expect(report).toMatchObject({ requested: 40, inScene: 40, fallbackGroups: [] });
        expect(report.groups).toEqual({ glass: 10, lights: 10, borders: 10, spread: 10 });
        expect(fake.added.every((message) => message.characterTextures.length === 4)).toBe(true);
        // Manifest was read beside the map file
        expect(vi.mocked(fetch).mock.calls[0][0]).toEqual(new URL("http://maps.test/hq/fx/manifest.json"));
        expect(fake.sceneEvents.count(UPDATE)).toBe(1);

        const clearing = e2eHooks.clearSyntheticCrowd();
        fake.runUpdate(2000);

        await expect(clearing).resolves.toEqual({ removed: 40, remaining: 0 });
        expect(fake.sceneEvents.total()).toBe(0);
        expect(fake.inScene.size).toBe(0);
    });

    it("keeps the new scene's crowd when a previous scene finishes clearing", async () => {
        (window as { e2eHooks?: unknown }).e2eHooks = e2eHooks;
        localStorage.setItem(E2E_BENCH_KEY, "1");
        const first = makeScene();
        const joining = e2eHooks.spawnSyntheticCrowd(2);
        await vi.waitFor(() => expect(first.added).toHaveLength(2));
        first.runUpdate(0);
        await joining;
        const leaving = e2eHooks.clearSyntheticCrowd();
        await e2eHooks.clearSyntheticCrowd();

        const second = makeScene();
        const next = e2eHooks.spawnSyntheticCrowd(3);
        await vi.waitFor(() => expect(second.added).toHaveLength(3));
        second.runUpdate(0);
        await next;
        first.runUpdate(200);
        await leaving;

        const clearing = e2eHooks.clearSyntheticCrowd();
        second.runUpdate(200);
        await expect(clearing).resolves.toEqual({ removed: 3, remaining: 0 });
        expect(second.sceneEvents.total()).toBe(0);
    });

    it("does not reuse a crowd bound to the previous scene when the player changed room without clearing", async () => {
        (window as { e2eHooks?: unknown }).e2eHooks = e2eHooks;
        localStorage.setItem(E2E_BENCH_KEY, "1");
        const first = makeScene();
        const joining = e2eHooks.spawnSyntheticCrowd(2);
        await vi.waitFor(() => expect(first.added).toHaveLength(2));
        first.runUpdate(0);
        await joining;

        const second = makeScene();
        const next = e2eHooks.spawnSyntheticCrowd(3);
        await vi.waitFor(() => expect(second.added).toHaveLength(3));
        second.runUpdate(0);
        await expect(next).resolves.toMatchObject({ requested: 3, inScene: 3 });

        // The crowd of the first scene was not asked to walk or join anything in the second
        expect(first.added).toHaveLength(2);
        expect(second.sceneEvents.count(UPDATE)).toBe(1);
    });

    it("walks the bots from the scene's update, and nothing after the crowd is cleared", async () => {
        const fake = makeScene();
        (window as { e2eHooks?: unknown }).e2eHooks = e2eHooks;
        localStorage.setItem(E2E_BENCH_KEY, "1");
        const spawning = e2eHooks.spawnSyntheticCrowd(20);
        await vi.waitFor(() => expect(fake.added).toHaveLength(20));
        fake.runUpdate(0);
        await spawning;

        for (let frame = 1; frame < 60; frame++) fake.sceneEvents.emit(UPDATE, frame * 20);
        const movesWhileWalking = fake.moved.length;
        const clearing = e2eHooks.clearSyntheticCrowd();
        fake.runUpdate(2000);
        await clearing;
        fake.sceneEvents.emit(UPDATE, 3000);

        // 1.2 s of game time at 5 moves a second: 6 per bot, to within the phase each starts at
        expect(movesWhileWalking).toBeGreaterThanOrEqual(20 * 5);
        expect(movesWhileWalking).toBeLessThanOrEqual(20 * 6);
        expect(fake.moved).toHaveLength(movesWhileWalking);
    });

    it("does nothing when there is no crowd to clear", async () => {
        makeScene();

        await expect(e2eHooks.clearSyntheticCrowd()).resolves.toEqual({ removed: 0, remaining: 0 });
    });
});

describe("e2eHooks frame bench", () => {
    beforeEach(() => localStorage.setItem(E2E_BENCH_KEY, "1"));

    function benchGl(gpuMs: number[]) {
        const timer = createFakeTimerGl({ flavor: "webgl1", elapsedNs: gpuMs.map((ms) => ms * MS) });
        const texImage2D = vi.fn();
        const gl = Object.assign(timer.gl, { texImage2D, texSubImage2D: vi.fn() });
        return { timer, gl, texImage2D };
    }

    it("captures exactly 300 complete frames and restores the game hooks", async () => {
        const { gl } = benchGl(Array(300).fill(4));
        const draw = vi.fn();
        const context = Object.assign(gl, { drawArrays: draw });
        const fake = makeScene(context);
        const result = e2eHooks.captureFrameBench();
        for (let i = 0; i < 300; i++) {
            fake.gameEvents.emit(PRE_STEP, i * 16);
            fake.gameEvents.emit(POST_STEP);
            fake.gameEvents.emit(Phaser.Core.Events.PRE_RENDER);
            context.drawArrays();
            fake.gameEvents.emit(POST_RENDER);
        }
        fake.gameEvents.emit(PRE_STEP, 4800);
        const measured = await result;
        expect(measured).toMatchObject({
            frames: 300,
            gpuSamples: 300,
            drawCalls: { avg: 1, max: 1 },
            gpuMs: { avg: 4, p99: 4, max: 4 },
            frameMs: { avg: 16, p99: 16, max: 16 },
        });
        expect(context.drawArrays).toBe(draw);
        expect(fake.gameEvents.total()).toBe(0);
    });

    it("reads the last frames of the game while it runs, with the avatar counts of the moment", () => {
        const { gl, timer } = benchGl([4, 6, 8, 10]);
        const fake = makeScene(gl);
        fake.inScene.set(1, { isCulled: () => true, getDetail: () => "sprite" });
        fake.inScene.set(2, { isCulled: () => false, getDetail: () => "dot" });
        fake.inScene.set(3, { isCulled: () => false, getDetail: () => "dot" });
        fake.inScene.set(4, { isCulled: () => false, getDetail: () => "sprite" });

        e2eHooks.startFrameBench();
        for (let frame = 0; frame < 5; frame++) {
            fake.gameEvents.emit(PRE_STEP, frame * 16);
            fake.gameEvents.emit(POST_STEP);
            fake.gameEvents.emit(Phaser.Core.Events.PRE_RENDER);
            fake.gameEvents.emit(POST_RENDER);
        }
        const reading = e2eHooks.getFrameBench();
        e2eHooks.stopFrameBench();

        expect(Object.keys(reading).sort()).toEqual(
            [
                "drawCalls",
                "workMs",
                "frameMs",
                "gpuMs",
                "avgGpuMs",
                "p95GpuMs",
                "p99GpuMs",
                "maxGpuMs",
                "avgFrameMs",
                "p99FrameMs",
                "maxFrameMs",
                "mirrorUploadBytesPerSec",
                "activeFullAvatars",
                "activeDotAvatars",
                "culledAvatars",
                "bakedAvatarTextures",
                "frames",
                "gpuTimer",
                "fullMapUploads",
                "largeUploads",
                "largestUploadBytes",
                "allocations",
                "renderedFrames",
                "postFilterFrames",
                "postFilterShare",
                "shading",
                "shadingSinceNight",
                "gpuSamples",
                "gpuDroppedFrames",
            ].sort(),
        );
        expect(reading).toMatchObject({
            frames: 4,
            gpuTimer: "webgl1-ext",
            avgFrameMs: 16,
            maxFrameMs: 16,
            activeFullAvatars: 1,
            activeDotAvatars: 2,
            culledAvatars: 1,
            bakedAvatarTextures: 0,
            fullMapUploads: 0,
        });
        // Four of the five queries have resolved when the reading is taken
        expect(reading.gpuSamples).toBeGreaterThan(0);
        expect(timer.liveQueries()).toBe(0);
    });

    it("reads the post pass from the camera's filter list at each rendered frame, active ones only", () => {
        const { gl } = benchGl([]);
        const fake = makeScene(gl);
        const post = { active: true, renderNode: "KfxPost" };
        fake.filters.push({ active: true, renderNode: "Blur" }, post);

        e2eHooks.startFrameBench();
        const render = (frame: number) => {
            fake.gameEvents.emit(PRE_STEP, frame * 16);
            fake.gameEvents.emit(Phaser.Core.Events.PRE_RENDER);
        };
        render(0);
        render(1);
        // The pass is switched off for the next two frames (a plain day with nobody mirrored), and another filter on
        post.active = false;
        render(2);
        render(3);
        const reading = e2eHooks.stopFrameBench();

        expect(reading).toMatchObject({ renderedFrames: 4, postFilterFrames: 2, postFilterShare: 0.5 });
    });

    it("says KfxPost for the pass, as the Koncluí post filter names itself", () => {
        const source = readFileSync(
            resolve(__dirname, "../../../src/front/Konclui/Ambience/phaser/postFilter.ts"),
            "utf8",
        );

        expect(/const POST_NODE = "([^"]+)";/.exec(source)?.[1]).toBe(POST_FILTER_NODE);
        expect(/const SHADED_POST_NODE = "([^"]+)";/.exec(source)?.[1]).toBe(SHADED_POST_FILTER_NODE);
    });

    it("counts a frame drawn by the shaded program as a frame with the post pass", () => {
        const { gl } = benchGl([]);
        const fake = makeScene(gl);
        fake.filters.push({ active: true, renderNode: "KfxPostShaded" });

        e2eHooks.startFrameBench();
        for (let frame = 0; frame < 3; frame++) {
            fake.gameEvents.emit(PRE_STEP, frame * 16);
            fake.gameEvents.emit(Phaser.Core.Events.PRE_RENDER);
        }
        const reading = e2eHooks.stopFrameBench();

        expect(reading).toMatchObject({ renderedFrames: 3, postFilterFrames: 3, postFilterShare: 1 });
    });

    it("rejects a capture that the game never completes, stops the bench and puts everything back", async () => {
        vi.useFakeTimers();
        try {
            const { gl } = benchGl([]);
            const draw = vi.fn();
            const context = Object.assign(gl, { drawArrays: draw });
            const fake = makeScene(context);
            const original = gl.texImage2D;

            const result = e2eHooks.captureFrameBench();
            const rejection = expect(result).rejects.toThrow("is the tab visible?");
            // A hidden tab: only a few steps run
            for (let i = 0; i < 5; i++) fake.gameEvents.emit(PRE_STEP, i * 16);
            await vi.advanceTimersByTimeAsync(FRAME_CAPTURE_TIMEOUT_MS);
            await rejection;

            await expect(result).rejects.toThrow("4 of the 300 steps");
            expect(fake.gameEvents.total()).toBe(0);
            expect(context.drawArrays).toBe(draw);
            expect(gl.texImage2D).toBe(original);
            // The bench is gone: a new one can start, and nothing is left running
            expect(() => e2eHooks.getFrameBench()).toThrow("No frame bench is running");
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("counts the upload of the whole map on the game's context and puts the method back when it stops", () => {
        const { gl, texImage2D } = benchGl([]);
        const fake = makeScene(gl);
        const original = gl.texImage2D;

        e2eHooks.startFrameBench();
        fake.gameEvents.emit(PRE_STEP, 0);
        gl.texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, { width: 2752, height: 1792 });
        fake.gameEvents.emit(PRE_STEP, 16);
        const reading = e2eHooks.getFrameBench();
        e2eHooks.stopFrameBench();

        expect(reading.fullMapUploads).toBe(1);
        expect(reading.mirrorUploadBytesPerSec).toBeCloseTo(19_726_336 / 0.016, 3);
        expect(texImage2D).toHaveBeenCalledTimes(1);
        expect(gl.texImage2D).toBe(original);
        expect(fake.gameEvents.total()).toBe(0);
    });

    it("says gpuTimer none, with null GPU figures, when the game's context has no timer", () => {
        const fake = makeScene(createFakeTimerGl({ flavor: "none" }).gl);

        e2eHooks.startFrameBench();
        for (let frame = 0; frame < 3; frame++) {
            fake.gameEvents.emit(PRE_STEP, frame * 16);
            fake.gameEvents.emit(POST_STEP);
            fake.gameEvents.emit(Phaser.Core.Events.PRE_RENDER);
            fake.gameEvents.emit(POST_RENDER);
        }
        const reading = e2eHooks.stopFrameBench();

        expect(reading.gpuTimer).toBe("none");
        expect(reading.avgGpuMs).toBeNull();
        expect(reading.maxGpuMs).toBeNull();
    });

    it("refuses a second bench, a read or a stop without one, and a bench beside a frame recording", () => {
        const fake = makeScene(createFakeTimerGl({ flavor: "webgl2" }).gl);

        expect(() => e2eHooks.getFrameBench()).toThrow("No frame bench is running");
        expect(() => e2eHooks.stopFrameBench()).toThrow("No frame bench is running");

        e2eHooks.startFrameBench();
        expect(() => e2eHooks.startFrameBench()).toThrow("already running");
        expect(() => e2eHooks.startFrameRecording()).toThrow("A frame bench is running");
        e2eHooks.stopFrameBench();

        e2eHooks.startFrameRecording();
        expect(() => e2eHooks.startFrameBench()).toThrow("A frame recording is running");
        e2eHooks.stopFrameRecording();
        expect(fake.gameEvents.total()).toBe(0);
    });
});

describe("e2eHooks bench-only hooks without the key", () => {
    it("refuses the frame bench and the capture, and wraps nothing on the game's context", async () => {
        const timer = createFakeTimerGl({ flavor: "webgl2" });
        const gl = Object.assign(timer.gl, { texImage2D: vi.fn(), texSubImage2D: vi.fn() });
        const original = gl.texImage2D;
        const fake = makeScene(gl);

        expect(() => e2eHooks.startFrameBench()).toThrow("bench session");
        await expect(e2eHooks.captureFrameBench()).rejects.toThrow("bench session");

        expect(gl.texImage2D).toBe(original);
        expect(fake.gameEvents.total()).toBe(0);
    });

    it("refuses to fix the hour, and writes nothing to the storage", () => {
        makeScene();

        expect(() => e2eHooks.setBenchNight(0.85)).toThrow("bench session");

        expect(localStorage.getItem("konclui.fx.hour")).toBeNull();
    });

    it("refuses to pan the camera, and takes no hold of it", () => {
        const fake = makeScene();

        expect(() => e2eHooks.panCamera(300, 0, 1000)).toThrow("bench session");

        expect(fake.camera.startManualPan).not.toHaveBeenCalled();
        expect(fake.sceneEvents.count(UPDATE)).toBe(0);
    });
});

describe("e2eHooks night and camera", () => {
    beforeEach(() => localStorage.setItem(E2E_BENCH_KEY, "1"));

    it("fixes the hour through the effects' QA key for a night level and gives it back", () => {
        makeScene();

        const result = e2eHooks.setBenchNight(0.85);

        expect(localStorage.getItem("konclui.fx.hour")).toBe(result.hour?.toFixed(4));
        expect(result.level).toBe(0.85);
        // 0.85 is the dusk look: the night-only lights are not on, which the caller can see in the result
        expect(result.nightOn).toBe(false);
        expect(e2eHooks.setBenchNight(1).nightOn).toBe(true);
        e2eHooks.setBenchNight(null);
        expect(localStorage.getItem("konclui.fx.hour")).toBeNull();
    });

    it("marks the shading's counters when the night is set, so that what the new hour uploads is counted from there", () => {
        makeScene();
        let uploads = 3;
        const published = (): ShadingCounters => ({
            bakes: uploads,
            slices: 0,
            uploads,
            uploadedBytes: uploads * 19_726_336,
            levelChanges: 0,
            level: 2,
            marked: 0,
        });
        setShadingBenchSource(published);
        try {
            e2eHooks.startFrameBench();
            e2eHooks.setBenchNight(1);
            uploads = 4; // the bake the night asks for, put on the GPU
            const reading = e2eHooks.stopFrameBench();

            expect(reading.shadingSinceNight).toMatchObject({ uploads: 1, uploadedBytes: 19_726_336 });
            expect(reading.shading).toMatchObject({ uploads: 1 });
        } finally {
            clearShadingBenchSource(published);
        }
    });

    it("pans the camera from the scene's update and releases it", async () => {
        const fake = makeScene();

        const done = e2eHooks.panCamera(300, 0, 1000);
        fake.sceneEvents.emit(UPDATE, 0);
        fake.sceneEvents.emit(UPDATE, 500);
        fake.sceneEvents.emit(UPDATE, 1000);

        await expect(done).resolves.toBe(true);
        expect(fake.camera.startManualPan).toHaveBeenCalledTimes(1);
        const moved = fake.camera.panBy.mock.calls.reduce((sum, [x]) => sum + (x as number), 0);
        expect(moved).toBe(300);
        expect(fake.sceneEvents.count(UPDATE)).toBe(0);
        e2eHooks.releaseCameraPan();
        expect(fake.camera.resumePlayerFollow).toHaveBeenCalledTimes(1);
    });
});
