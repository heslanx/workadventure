// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { CameraManager } from "../../../../src/front/Phaser/Game/CameraManager";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import type { Player } from "../../../../src/front/Phaser/Player/Player";
import type { WaScaleManager } from "../../../../src/front/Phaser/Services/WaScaleManager";
import { cameraDetachedStore } from "../../../../src/front/Stores/CameraStore";
import { mapEditorModeStore } from "../../../../src/front/Stores/MapEditorStore";
import { gameViewportCoveredStart } from "../../../../src/front/ExternalModule/ClientExtensionPoints";
import { Easing } from "../../../../src/front/types";
import { SPRING_SURFACE, SPRING_SURFACE_MS, cubicBezier, springEasing } from "../../../../src/front/Utils/spring";
import { SURFACE_EXIT_MS, SURFACE_SHEET_CURVE } from "../../../../src/front/Utils/surfaceTransition";
import type { ActiveEventList } from "../../../../src/front/Phaser/UserInput/UserInputManager";
import { UserInputEvent } from "../../../../src/front/Phaser/UserInput/UserInputManager";

vi.mock("../../../../src/front/Phaser/Player/Player", () => ({ hasMovedEventName: "hasMoved" }));
vi.mock("../../../../src/front/Phaser/Services/WaScaleManager", () => ({
    WaScaleManagerEvent: { RefreshFocusOnTarget: "refreshFocus", ZoomChanged: "zoomChanged" },
}));
vi.mock("../../../../src/front/Phaser/UserInput/UserInputManager", () => ({
    UserInputEvent: { MoveLeft: 1, MoveUp: 2, MoveRight: 3, MoveDown: 4 },
}));

const managers: CameraManager[] = [];
afterEach(() => {
    managers.splice(0).forEach((manager) => manager.destroy());
    mapEditorModeStore.set(false);
    gameViewportCoveredStart.set(0);
    document.documentElement.removeAttribute("dir");
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function setup(zoom = 1, animate = false, resizeAtEnd = false) {
    // Use the real Phaser camera and preRender so assertions concern the rendered viewport, not just callbacks.
    const camera = new Phaser.Cameras.Scene2D.Camera(0, 0, 800, 600);
    Object.defineProperty(camera, "scaleManager", { value: { zoom: 1, width: 800, height: 600 } });
    Object.defineProperty(camera, "sceneManager", { value: { customViewports: 0 } });
    camera.setZoom(zoom);
    const player = {
        x: 1200,
        y: 1000,
        path: [] as { x: number; y: number }[],
        getPathAhead: () => player.path,
    };
    const sendViewportToServer = vi.fn();
    type TweenConfig = {
        duration: number;
        from: number;
        to: number;
        onUpdate?: (tween: { getValue: () => number }) => void;
        onComplete?: () => void;
    };
    let activeTween: TweenConfig | undefined;
    const advanceTween = (progress: number) => {
        const tween = activeTween;
        if (!tween) return;
        tween.onUpdate?.({ getValue: () => tween.from + (tween.to - tween.from) * progress });
        if (progress === 1) {
            tween.onComplete?.();
        }
    };
    const addCounter = vi.fn((config: TweenConfig) => {
        activeTween = config;
        const tween = { getValue: () => 1, stop: vi.fn(), destroy: vi.fn() };
        if (!animate) {
            advanceTween(1);
        }
        return tween;
    });
    const scene = {
        cameras: { main: camera },
        game: { events: new Phaser.Events.EventEmitter() },
        events: new Phaser.Events.EventEmitter(),
        scale: { zoom: 1 },
        CurrentPlayer: player,
        markDirty: vi.fn(),
        reposition: vi.fn(),
        sendViewportToServer,
        tweens: { addCounter },
    } as unknown as GameScene;
    let modifier = zoom;
    const saveZoom = vi.fn();
    const limits = { minZoomReached: false, focusTarget: undefined as { x: number; y: number } | undefined };
    const scale = {
        getTargetZoomModifierFor: () => 1,
        getFocusTarget: () => limits.focusTarget,
        setFocusTarget: vi.fn(),
        saveZoom,
        get zoomModifier() {
            return modifier;
        },
        get isMaximumZoomOutReached() {
            return limits.minZoomReached;
        },
        setZoomModifier: (value: number, cam: Phaser.Cameras.Scene2D.Camera, animating: boolean) => {
            modifier = value;
            if (resizeAtEnd && !animating) {
                cam.setSize(400, 300);
                cam.setZoom(value / 2);
            } else cam.setZoom(value);
        },
    } as unknown as WaScaleManager;
    const manager = new CameraManager(scene, { width: 4000, height: 3000 }, scale);
    managers.push(manager);
    camera.startFollow(player, true);
    camera.preRender();
    return { camera, manager, player, scene, saveZoom, sendViewportToServer, advanceTween, addCounter, limits };
}

describe("walk framing", () => {
    const frames = (scene: GameScene, count: number) => {
        for (let frame = 0; frame < count; frame++) scene.events.emit(Phaser.Scenes.Events.UPDATE, 0, 16);
    };
    const view = (camera: Phaser.Cameras.Scene2D.Camera) => {
        camera.preRender();
        return { x: camera.midPoint.x, y: camera.midPoint.y, zoom: camera.zoom };
    };

    it("centres between the avatar and its destination, zoomed out just enough, then closes in on arrival", () => {
        const { camera, manager, player, scene, advanceTween } = setup(1, true);
        const destination = { x: player.x + 2000, y: player.y + 600 };
        const walk = manager.startWalkFraming(destination);
        player.path = [destination];
        frames(scene, 100);
        // The view is 800x600: half of it (400x300 map pixels at zoom 1) must hold half the distance plus 64 px.
        expect(view(camera)).toEqual({
            x: player.x + 1000,
            y: player.y + 300,
            zoom: expect.closeTo(400 / 1064, 3) as number,
        });

        // A short walk centres between the two without zooming in past the zoom the walk started from.
        player.path = [{ x: player.x + 300, y: player.y }];
        frames(scene, 1);
        expect(view(camera)).toEqual({ x: player.x + 150, y: player.y, zoom: 1 });

        // On arrival the view is on the avatar at the starting zoom, and follows it again.
        player.x += 300;
        player.path = [];
        manager.endWalkFraming(walk);
        frames(scene, 100);
        advanceTween(1);
        player.x += 50;
        expect(view(camera)).toEqual({ x: player.x, y: player.y, zoom: 1 });
    });

    it("moves the view and the zoom on the same blend, over longer for a longer move", () => {
        const { camera, manager, player, scene } = setup(1, true);
        const destination = { x: player.x + 2000, y: player.y + 600 };
        manager.startWalkFraming(destination);
        player.path = [destination];
        const target = { x: player.x + 1000, y: player.y + 300, zoom: 400 / 1064 };
        frames(scene, 30);
        const during = view(camera);
        const moved = (during.x - player.x) / (target.x - player.x);
        expect(moved).toBeGreaterThan(0.1);
        expect(moved).toBeLessThan(0.9);
        expect((during.y - player.y) / (target.y - player.y)).toBeCloseTo(moved, 5);
        expect(Math.log(during.zoom) / Math.log(target.zoom)).toBeCloseTo(moved, 5);

        // About 1 000 screen pixels to travel: the blend takes the longest, 1.5 s.
        frames(scene, 62);
        expect(view(camera).x).toBeLessThan(target.x);
        frames(scene, 2);
        expect(view(camera).x).toBe(target.x);
    });

    it("blends from a dragged view, without jumping", () => {
        const { camera, manager, player, scene } = setup(1, true);
        manager.startManualPan();
        manager.panBy(1500, 0);
        const dragged = view(camera);
        const destination = { x: dragged.x + 100, y: dragged.y };
        manager.startWalkFraming(destination);
        player.path = [destination];
        expect(get(cameraDetachedStore)).toBe(false);
        frames(scene, 1);
        expect(view(camera).x).toBeCloseTo(dragged.x, 0);
        frames(scene, 100);
        expect(view(camera).x).toBeCloseTo((player.x + destination.x) / 2, 5);
    });

    it("keeps the first walk's zoom across taps, lets the user take over, and leaves a held camera alone", () => {
        const { camera, manager, player, scene, saveZoom, limits } = setup(1, true);
        const first = manager.startWalkFraming({ x: player.x + 2000, y: player.y });
        player.path = [{ x: player.x + 2000, y: player.y }];
        frames(scene, 100);

        // A new tap while zoomed out: entering a focus zone still saves the zoom from before the first walk.
        const second = manager.startWalkFraming({ x: player.x + 100, y: player.y });
        manager.endWalkFraming(first);
        expect(view(camera).zoom).toBeLessThan(1);
        manager.enterFocusMode({ x: 0, y: 0, width: 100, height: 100 });
        expect(saveZoom).toHaveBeenCalledWith(1);

        // Zooming during a walk frees the view where it is, as a drag does, even when the walk ends.
        const third = manager.startWalkFraming({ x: player.x + 2000, y: player.y });
        player.path = [{ x: player.x + 2000, y: player.y }];
        frames(scene, 20);
        const whenZoomed = view(camera);
        manager.zoomByFactorAtPointer(1, 0, { x: 400, y: 300 });
        expect(get(cameraDetachedStore)).toBe(true);
        frames(scene, 100);
        manager.endWalkFraming(second);
        manager.endWalkFraming(third);
        frames(scene, 100);
        expect(view(camera)).toEqual(whenZoomed);

        // A focus zone (or a script) holds the camera: no framing.
        limits.focusTarget = { x: 0, y: 0 };
        expect(manager.startWalkFraming({ x: 0, y: 0 })).toBeUndefined();
    });
});

describe("manual camera pan", () => {
    it.each([false, true])(
        "keeps the cursor's world point fixed throughout zoom, including canvas resize=%s",
        (resizeAtEnd) => {
            const { camera, manager, advanceTween } = setup(1, true, resizeAtEnd);
            manager.startManualPan();
            const before = camera.getWorldPoint(600, 150);
            manager.zoomByFactorAtPointer(2, 250, { x: 600, y: 150 });
            advanceTween(0.5);
            camera.preRender();
            const middle = camera.getWorldPoint(camera.width * 0.75, camera.height * 0.25);
            expect(middle.x).toBeCloseTo(before.x);
            expect(middle.y).toBeCloseTo(before.y);
            manager.zoomByFactorAtPointer(1.2, 250, { x: camera.width * 0.75, y: camera.height * 0.25 });
            advanceTween(1);
            camera.preRender();
            const after = camera.getWorldPoint(camera.width * 0.75, camera.height * 0.25);
            expect(after.x).toBeCloseTo(before.x);
            expect(after.y).toBeCloseTo(before.y);
            expect(get(cameraDetachedStore)).toBe(true);
        },
    );

    it("keeps regular zoom centred on the player and recentres after cursor zoom", () => {
        const { camera, manager, player, advanceTween } = setup(1, true);
        manager.zoomByFactor(2, 250);
        advanceTween(1);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(get(cameraDetachedStore)).toBe(false);
        manager.startManualPan();
        manager.zoomByFactorAtPointer(2, 250, { x: 600, y: 150 });
        advanceTween(1);
        manager.resumePlayerFollow();
        advanceTween(1);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(camera.midPoint.y).toBe(player.y);
        expect(get(cameraDetachedStore)).toBe(false);
    });

    it.each([0.5, 2])("zooms by %s on the avatar while following, and on the cursor once detached", (factor) => {
        const { camera, manager, player, advanceTween } = setup(2, true);
        manager.zoomByFactorAtPointer(factor, 250, { x: 600, y: 150 });
        advanceTween(1);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(camera.midPoint.y).toBe(player.y);
        expect(get(cameraDetachedStore)).toBe(false);

        manager.startManualPan();
        const before = camera.getWorldPoint(600, 150);
        manager.zoomByFactorAtPointer(factor, 250, { x: 600, y: 150 });
        advanceTween(1);
        camera.preRender();
        const after = camera.getWorldPoint(600, 150);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
    });

    it("zooms on the cursor in the map editor, even after hovering an explorer list item, without detaching", () => {
        const { camera, manager, advanceTween } = setup(1, true);
        mapEditorModeStore.set(true);
        // Hovering an explorer list item makes the camera follow that item.
        manager.centerCameraOn({ x: 1500, y: 1200 });
        advanceTween(1);
        camera.preRender();
        const before = camera.getWorldPoint(600, 150);
        manager.zoomByFactorAtPointer(2, 250, { x: 600, y: 150 });
        advanceTween(1);
        camera.preRender();
        const after = camera.getWorldPoint(600, 150);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
        expect(get(cameraDetachedStore)).toBe(false);
    });

    it("keeps scrolling the view after centring on a point, as the explorer list does on hover", () => {
        const { camera, manager, advanceTween } = setup(1, true);
        manager.centerCameraOn({ x: 1500, y: 1200 });
        advanceTween(1);
        camera.preRender();
        expect(camera.midPoint.x).toBe(1500);
        manager.scrollCamera(100, 0);
        camera.preRender();
        expect(camera.midPoint.x).toBe(1600);
    });

    it("scrolls the map editor's view with the move keys, then recentres on the avatar when it closes", () => {
        const { camera, manager, player, advanceTween } = setup(2, true);
        mapEditorModeStore.set(true);
        const right = {
            get: (event: UserInputEvent) => event === UserInputEvent.MoveRight,
        } as unknown as ActiveEventList;
        manager.move(right, 100);
        camera.preRender();
        // 0.6 world units per ms at zoom 1, halved at zoom 2 so the map moves as fast on screen.
        expect(camera.midPoint.x).toBeCloseTo(player.x + 30);
        expect(camera.midPoint.y).toBe(player.y);
        mapEditorModeStore.set(false);
        advanceTween(1);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(camera.midPoint.y).toBe(player.y);
    });

    it("opens the map editor on the avatar, even when a small map held the game view elsewhere", () => {
        const { camera, manager, player } = setup(1);
        player.x = 100;
        player.y = 100;
        manager.startFollowPlayer(player as unknown as Player, 0);
        camera.preRender();
        // In game mode the camera stays inside the map, so it can't centre on an avatar near the corner.
        expect(camera.midPoint.x).toBe(400);
        mapEditorModeStore.set(true);
        camera.preRender();
        expect(camera.midPoint.x).toBe(100);
        expect(camera.midPoint.y).toBe(100);
    });

    it("ends on the avatar when the editor reopens while the view glides back to it", () => {
        const { camera, manager, player, advanceTween } = setup(1, true);
        mapEditorModeStore.set(true);
        manager.scrollCamera(500, 0);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x + 500);
        mapEditorModeStore.set(false);
        advanceTween(0.5);
        camera.preRender();
        expect(camera.midPoint.x).toBeGreaterThan(player.x);
        mapEditorModeStore.set(true);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(camera.midPoint.y).toBe(player.y);
    });

    it("centres the map in game mode on an axis where it is smaller than the view", () => {
        const { camera, scene, player } = setup(0.1);
        camera.preRender();
        expect(camera.midPoint.x).toBeCloseTo(2000);
        expect(camera.midPoint.y).toBeCloseTo(1500);

        // Centred in the area the follow offset leaves visible (a side panel, say).
        camera.setFollowOffset(100, 0);
        scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
        camera.preRender();
        expect(camera.midPoint.x).toBeCloseTo(1900);

        camera.setFollowOffset(0, 0);
        camera.setZoom(1);
        scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(camera.midPoint.y).toBe(player.y);
    });

    it("ignores cursor zoom-out at minimum zoom", () => {
        const { manager, addCounter, limits } = setup(1, true);
        manager.startManualPan();
        limits.minZoomReached = true;
        const tweens = addCounter.mock.calls.length;
        manager.zoomByFactorAtPointer(0.5, 250, { x: 600, y: 150 });
        expect(addCounter.mock.calls.length).toBe(tweens);
    });

    it.each([0.5, 1, 2])("scales release inertia to the current zoom %s and slows it down", (zoom) => {
        const { camera, manager, scene } = setup(zoom);
        manager.startManualPan();
        manager.releaseManualPan({ x: -8, y: 0 });
        camera.preRender();
        const origin = camera.midPoint.x;
        scene.events.emit(Phaser.Scenes.Events.UPDATE, 0, 20);
        camera.preRender();
        const firstStep = camera.midPoint.x - origin;
        expect(firstStep * zoom).toBeCloseTo(4);
        scene.events.emit(Phaser.Scenes.Events.UPDATE, 20, 20);
        camera.preRender();
        expect(camera.midPoint.x - origin - firstStep).toBeLessThan(firstStep);
    });

    it("gives a fast release more momentum and a stopped pointer none", () => {
        const measure = (velocity: number) => {
            const { manager, scene, camera } = setup();
            manager.startManualPan();
            manager.releaseManualPan({ x: velocity, y: 0 });
            camera.preRender();
            const origin = camera.midPoint.x;
            scene.events.emit(Phaser.Scenes.Events.UPDATE, 0, 20);
            camera.preRender();
            return Math.abs(camera.midPoint.x - origin);
        };
        expect(measure(-8)).toBeGreaterThan(measure(-2));
        expect(measure(0)).toBe(0);
    });

    it("cancels inertia on another drag, resuming player follow, and teardown", () => {
        const { manager, scene } = setup();
        manager.startManualPan();
        manager.releaseManualPan({ x: -8, y: 0 });
        expect(scene.events.listenerCount(Phaser.Scenes.Events.UPDATE)).toBe(1);
        manager.stopManualPanInertia();
        expect(scene.events.listenerCount(Phaser.Scenes.Events.UPDATE)).toBe(0);
        manager.releaseManualPan({ x: -8, y: 0 });
        manager.resumePlayerFollow();
        expect(scene.events.listenerCount(Phaser.Scenes.Events.UPDATE)).toBe(0);
        manager.startManualPan();
        manager.releaseManualPan({ x: -8, y: 0 });
        manager.destroy();
        managers.splice(managers.indexOf(manager), 1);
        expect(scene.events.listenerCount(Phaser.Scenes.Events.UPDATE)).toBe(0);
    });

    it("recenters progressively towards the moving player without restarting on each movement tick", () => {
        const { camera, manager, player, advanceTween, addCounter } = setup(1, true);
        manager.startManualPan();
        manager.panBy(400, 0);
        camera.preRender();
        const originX = camera.midPoint.x;

        manager.resumePlayerFollow();
        camera.preRender();
        expect(camera.midPoint.x).toBe(originX);
        expect(addCounter.mock.calls[0][0].duration).toBe(500);

        player.x += 40;
        advanceTween(0.5);
        camera.preRender();
        expect(camera.midPoint.x).toBe((originX + player.x) / 2);
        manager.resumePlayerFollow();
        expect(addCounter).toHaveBeenCalledTimes(1);

        player.x += 40;
        advanceTween(1);
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        player.x += 20;
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
    });

    it.each([0.5, 1, 2])("preserves the initial view and follows pointer distance at zoom %s", (zoom) => {
        const { camera, manager, player, sendViewportToServer } = setup(zoom);
        const before = { x: camera.worldView.x, y: camera.worldView.y };
        manager.startManualPan();
        camera.preRender();
        expect(camera.worldView.x).toBeCloseTo(before.x);
        expect(camera.worldView.y).toBeCloseTo(before.y);
        manager.panBy(-80, 40);
        camera.preRender();
        expect(camera.worldView.x).toBeCloseTo(before.x - 80 / zoom);
        expect(camera.worldView.y).toBeCloseTo(before.y + 40 / zoom);
        expect({ x: player.x, y: player.y }).toEqual({ x: 1200, y: 1000 });
        expect(get(cameraDetachedStore)).toBe(true);
        expect(sendViewportToServer).toHaveBeenCalled();
    });

    it("resumes following the player and clears the recenter state", () => {
        const { camera, manager, player } = setup();
        manager.startManualPan();
        manager.panBy(200, 100);
        camera.preRender();
        manager.resumePlayerFollow();
        player.x += 60;
        camera.preRender();
        expect(camera.midPoint.x).toBe(player.x);
        expect(camera.midPoint.y).toBe(player.y);
        expect(get(cameraDetachedStore)).toBe(false);
    });

    it("keeps layout offsets out of a detached view and restores them when recentering", () => {
        const game = document.createElement("div");
        game.id = "game";
        Object.defineProperties(game, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } });
        document.body.append(game);
        const { camera, manager, player } = setup();
        manager.startManualPan();
        manager.updateCameraOffset({ xStart: 200, xEnd: 800, yStart: 0, yEnd: 600 }, true);
        expect(camera.followOffset.x).toBe(0);
        manager.resumePlayerFollow();
        camera.preRender();
        expect(camera.followOffset.x).toBe(100);
        expect(camera.midPoint.x).toBe(player.x - 100);
    });

    it("clamps the rendered view to the map and clears state on scene teardown", () => {
        const { camera, manager } = setup();
        manager.startManualPan();
        manager.panBy(-10000, -10000);
        camera.preRender();
        expect(camera.worldView.x).toBeGreaterThanOrEqual(0);
        expect(camera.worldView.y).toBeGreaterThanOrEqual(0);
        manager.panBy(20000, 20000);
        camera.preRender();
        expect(camera.worldView.right).toBeLessThanOrEqual(4000);
        expect(camera.worldView.bottom).toBeLessThanOrEqual(3000);
        manager.setExplorationMode();
        expect(get(cameraDetachedStore)).toBe(false);
    });
});

// A panel floats over the start edge of the game area (the side panel of the office shell) and the canvas does not shrink
// for it: the avatar stands in the part that stays visible, and the map must be able to scroll until its own edge clears the
// panel, or the left strip of a large map could never be reached and the avatar at the edge would stand under the panel.
describe("a panel floating over the start edge of the game", () => {
    const STRIP = 296;
    // The area the panel leaves visible, in the 800x600 game element, which is what the blocker store would report.
    const visible = { xStart: STRIP, xEnd: 800, yStart: 0, yEnd: 600 };
    const whole = { xStart: 0, xEnd: 800, yStart: 0, yEnd: 600 };
    const gameElement = () => {
        const game = document.createElement("div");
        game.id = "game";
        Object.defineProperties(game, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } });
        document.body.append(game);
    };
    const frame = (scene: GameScene, camera: Phaser.Cameras.Scene2D.Camera) => {
        scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
        camera.preRender();
    };
    const screenX = (camera: Phaser.Cameras.Scene2D.Camera, worldX: number) =>
        (worldX - camera.worldView.x) * camera.zoom;

    it("scrolls the map until its edge clears the panel, so the avatar at the edge stands beside it", () => {
        gameElement();
        const { camera, manager, player, scene } = setup();
        player.x = 100;
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        frame(scene, camera);

        expect(camera.worldView.x).toBeCloseTo(-STRIP);
        expect(screenX(camera, 0)).toBeCloseTo(STRIP);
        expect(screenX(camera, player.x)).toBeGreaterThanOrEqual(STRIP);
    });

    it("leaves the avatar under the panel without the extension: the strip of the map is unreachable", () => {
        gameElement();
        const { camera, manager, player, scene } = setup();
        player.x = 100;
        manager.updateCameraOffset(visible);
        frame(scene, camera);

        expect(camera.worldView.x).toBe(0);
        expect(screenX(camera, player.x)).toBeLessThan(STRIP);
    });

    it("keeps the bounds of the map exactly when nothing floats over the game", () => {
        gameElement();
        const { camera, scene } = setup();
        frame(scene, camera);

        expect(camera.getBounds().x).toBe(0);
        expect(camera.getBounds().width).toBe(4000);
    });

    it("counts the strip in map pixels, at the zoom the camera has", () => {
        gameElement();
        const { camera, manager, player, scene } = setup(2);
        player.x = 50;
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        frame(scene, camera);

        expect(camera.getBounds().x).toBeCloseTo(-STRIP / 2);
        expect(screenX(camera, 0)).toBeCloseTo(STRIP);
        expect(screenX(camera, player.x)).toBeGreaterThanOrEqual(STRIP);
    });

    it("grows the bounds at the right edge in right-to-left, where the panel is", () => {
        document.documentElement.dir = "rtl";
        gameElement();
        const { camera, manager, player, scene } = setup();
        player.x = 3900;
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset({ xStart: 0, xEnd: 800 - STRIP, yStart: 0, yEnd: 600 });
        frame(scene, camera);

        expect(camera.getBounds().x).toBe(0);
        expect(camera.worldView.right).toBeCloseTo(4000 + STRIP);
        expect(screenX(camera, 4000)).toBeCloseTo(800 - STRIP);
        expect(screenX(camera, player.x)).toBeLessThanOrEqual(800 - STRIP);
    });

    it("gives the room at once when the panel opens, before the camera has glided", () => {
        const { camera, scene } = setup();

        gameViewportCoveredStart.set(STRIP);
        frame(scene, camera);

        expect(camera.getBounds().x).toBeCloseTo(-STRIP);
        expect(camera.getBounds().width).toBeCloseTo(4000 + STRIP);
    });

    it("does not touch a map that is smaller than the view: it stays centred in what the offset leaves visible", () => {
        const { camera, scene } = setup(0.1);
        gameViewportCoveredStart.set(STRIP);
        frame(scene, camera);

        expect(camera.getBounds().width).toBe(8000);
        expect(camera.midPoint.x).toBeCloseTo(2000);
    });

    // A map narrower than the window can still be wider than what the panel leaves visible. Centring it is then wrong:
    // the view could not scroll, the map's edge would stay under the panel and the avatar at that edge with it. Before
    // the panel floated, it shrank the game's cell and such a map was the larger one, so it scrolled.
    it("scrolls a map that is narrower than the window but wider than the part the panel leaves", () => {
        gameElement();
        // 4000 world px at 0.18 is 720 screen px of the 800: 80 px of window to spare, and the panel covers 296.
        const { camera, manager, player, scene } = setup(0.18);
        player.x = 50;
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        frame(scene, camera);

        expect(screenX(camera, 0)).toBeGreaterThanOrEqual(STRIP - 0.001);
        expect(screenX(camera, player.x)).toBeGreaterThanOrEqual(STRIP - 0.001);
    });

    it("still centres a map that fits beside the panel, in what the offset leaves visible", () => {
        gameElement();
        // 4000 world px at 0.1 is 400 screen px: it fits in the 504 that are left of the 800.
        const { camera, manager, scene } = setup(0.1);
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        frame(scene, camera);

        expect(camera.getBounds().width).toBe(8000);
        expect(screenX(camera, 0)).toBeGreaterThanOrEqual(STRIP);
        expect(screenX(camera, 4000)).toBeLessThanOrEqual(800);
    });

    it("keeps the map of that width in step with the glide when the panel closes: the view does not jump", () => {
        gameElement();
        const { camera, manager, player, scene, advanceTween } = setup(0.18, true);
        player.x = 50;
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        advanceTween(1);
        frame(scene, camera);

        gameViewportCoveredStart.set(0);
        manager.updateCameraOffset(whole);
        const edges: number[] = [];
        for (let step = 0; step <= 20; step += 1) {
            advanceTween(step / 20);
            frame(scene, camera);
            edges.push(screenX(camera, 0));
        }
        // The map's edge goes from the panel's edge to the window's own, in small steps (296 px over 20 frames).
        expect(edges[0]).toBeCloseTo(STRIP, 0);
        for (let step = 1; step < edges.length; step += 1) {
            expect(Math.abs(edges[step] - edges[step - 1])).toBeLessThan(40);
        }
    });

    // The camera glides its follow offset for 500 ms (QuadEaseOut) when the free area changes. The room the map was given
    // goes the same way: taking it back at once would pull the view by the width of the strip in one frame.
    it("takes the room back with the glide, so the view does not jump when the panel closes", () => {
        gameElement();
        const { camera, manager, player, scene, advanceTween } = setup(1, true);
        player.x = 100;
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        advanceTween(1);
        frame(scene, camera);
        expect(camera.worldView.x).toBeCloseTo(-STRIP);

        gameViewportCoveredStart.set(0);
        frame(scene, camera);
        expect(camera.worldView.x).toBeCloseTo(-STRIP);

        manager.updateCameraOffset(whole);
        const lefts: number[] = [];
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
            advanceTween(progress);
            frame(scene, camera);
            lefts.push(camera.worldView.x);
        }
        expect(lefts[0]).toBeCloseTo(-STRIP);
        expect(lefts[2]).toBeCloseTo(-STRIP / 2);
        expect(lefts[4]).toBe(0);
        expect([...lefts].sort((first, second) => second - first)).toEqual(lefts.slice().reverse());
        expect(camera.getBounds().x).toBe(0);
    });

    // The card that floats over the strip leaves in 200 ms (`--k-dur-normal`, on `--k-ease-sheet`) and arrives in 290 ms
    // (the surface spring). The camera is what shows the map under it, so its glide has the card's own length and curve
    // when the strip is what changes: a 500 ms glide left about 107 px of void for 300 ms with the card already gone.
    // Any other blocker (a video box) keeps the 500 ms glide that was there.
    describe("the glide of the camera", () => {
        const lastTween = (addCounter: ReturnType<typeof setup>["addCounter"]) =>
            addCounter.mock.calls[addCounter.mock.calls.length - 1][0] as unknown as {
                duration: number;
                ease: string | ((progress: number) => number);
            };

        it("takes the length and the curve of the card's exit when the strip goes", () => {
            gameElement();
            const { manager, addCounter } = setup();
            gameViewportCoveredStart.set(STRIP);
            manager.updateCameraOffset(visible);

            gameViewportCoveredStart.set(0);
            manager.updateCameraOffset(whole);

            const { duration, ease } = lastTween(addCounter);
            expect(duration).toBe(SURFACE_EXIT_MS);
            expect(typeof ease).toBe("function");
            const sheet = cubicBezier(...SURFACE_SHEET_CURVE);
            for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
                expect((ease as (progress: number) => number)(progress)).toBeCloseTo(sheet(progress), 6);
            }
        });

        it("takes the length and the spring of the card's entrance when the strip comes, though the room is given at once", () => {
            gameElement();
            const { camera, manager, scene, addCounter } = setup();
            gameViewportCoveredStart.set(STRIP);
            frame(scene, camera);
            manager.updateCameraOffset(visible);

            const { duration, ease } = lastTween(addCounter);
            expect(duration).toBe(SPRING_SURFACE_MS);
            expect(typeof ease).toBe("function");
            const spring = springEasing(SPRING_SURFACE, SPRING_SURFACE_MS);
            for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
                expect((ease as (progress: number) => number)(progress)).toBeCloseTo(spring(progress), 6);
            }
        });

        it("keeps 500 ms and the quad curve when the strip does not change", () => {
            gameElement();
            const { manager, addCounter } = setup();
            gameViewportCoveredStart.set(STRIP);
            manager.updateCameraOffset(visible);
            manager.updateCameraOffset({ xStart: STRIP, xEnd: 800, yStart: 0, yEnd: 400 });

            expect(lastTween(addCounter).duration).toBe(500);
            expect(lastTween(addCounter).ease).toBe(Easing.QuadEaseOut);
        });

        it("takes the card's length once, for the glide the strip started and not for the next one", () => {
            gameElement();
            const { manager, addCounter } = setup();
            gameViewportCoveredStart.set(STRIP);
            manager.updateCameraOffset(visible);
            manager.updateCameraOffset(whole);

            expect(lastTween(addCounter).duration).toBe(500);
        });

        it("does not take the card's length for a glide that comes after the strip was applied at once", () => {
            gameElement();
            const { manager, scene, addCounter } = setup();
            gameViewportCoveredStart.set(STRIP);
            // A zoom change applies the offset and the strip without a glide.
            scene.game.events.emit("zoomChanged");
            manager.updateCameraOffset(visible);

            expect(lastTween(addCounter).duration).toBe(500);
        });

        it("follows the card when it comes back while it was leaving", () => {
            gameElement();
            const { manager, addCounter, advanceTween } = setup(1, true);
            gameViewportCoveredStart.set(STRIP);
            manager.updateCameraOffset(visible);
            advanceTween(1);
            gameViewportCoveredStart.set(0);
            manager.updateCameraOffset(whole);
            advanceTween(0.3);
            gameViewportCoveredStart.set(STRIP);
            manager.updateCameraOffset(visible);

            expect(lastTween(addCounter).duration).toBe(SPRING_SURFACE_MS);
        });

        it("is instant under reduced motion", () => {
            gameElement();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
            const { manager, addCounter } = setup();
            gameViewportCoveredStart.set(STRIP);
            manager.updateCameraOffset(visible);
            gameViewportCoveredStart.set(0);
            manager.updateCameraOffset(whole);

            expect(lastTween(addCounter).duration).toBe(0);
        });
    });

    it("takes the room back at once when the view is free, which has no glide to follow", () => {
        gameElement();
        const { camera, manager, scene } = setup();
        gameViewportCoveredStart.set(STRIP);
        manager.updateCameraOffset(visible);
        manager.startManualPan();

        gameViewportCoveredStart.set(0);
        manager.updateCameraOffset(whole);
        frame(scene, camera);

        expect(camera.getBounds().x).toBe(0);
    });

    it("stops listening to the panel when the scene is gone", () => {
        const { manager, scene } = setup();
        const markDirty = vi.fn();
        scene.markDirty = markDirty;
        manager.destroy();

        gameViewportCoveredStart.set(STRIP);

        expect(markDirty).not.toHaveBeenCalled();
    });
});
