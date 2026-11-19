// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { TRANSFORM_SCALE_VARIABLE, UsernameDomLayer } from "../../../../src/front/Phaser/Game/UsernameDomLayer";
import { waScaleManager, WaScaleManagerEvent } from "../../../../src/front/Phaser/Services/WaScaleManager";

const PROBE_SIZE = 100;

/** A scene that holds the layers it is given, like a scene that starts again and creates a new layer. */
function createScene() {
    const layerElements: HTMLElement[] = [];
    const domElement = {
        pointerEvents: "",
        setOrigin: () => domElement,
        setDepth: () => domElement,
        setVisible: () => {},
        destroy: () => {},
    };
    const scene = {
        events: new Phaser.Events.EventEmitter(),
        game: { events: new Phaser.Events.EventEmitter() },
        add: {
            dom: (_x: number, _y: number, element: HTMLElement) => {
                layerElements.push(element);
                return domElement;
            },
        },
        markDirty: vi.fn(),
    } as unknown as GameScene;
    return { scene, layerElements };
}

describe("UsernameDomLayer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(waScaleManager, "zoomModifier", "get").mockReturnValue(1);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("lays the names of each layer out with the scale its own layer is shown at, even when the scene holds another", () => {
        const { scene, layerElements } = createScene();
        // Each layer is shown at its own scale: the first at twice its size, the second at its size.
        const shownAt = new Map<Element | null, number>();
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            return { width: (shownAt.get(this.parentElement) ?? 0) * PROBE_SIZE } as DOMRect;
        });
        const first = new UsernameDomLayer(scene);
        const second = new UsernameDomLayer(scene);
        // The scene's layer is the second one, as after a restart.
        Object.assign(scene, { usernameDomLayer: second });
        shownAt.set(layerElements[0], 2);
        shownAt.set(layerElements[1], 1);

        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, 1);
        vi.runOnlyPendingTimers();
        scene.events.emit(Phaser.Scenes.Events.RENDER);

        // A layer that is shown at twice its size makes the names half their size, so that they are not enlarged.
        const transformScale = (element: HTMLElement) =>
            Number(element.style.getPropertyValue(TRANSFORM_SCALE_VARIABLE));
        expect(transformScale(layerElements[0])).toBeCloseTo(0.5);
        expect(transformScale(layerElements[1])).toBeCloseTo(1);
        first.destroy();
        second.destroy();
    });

    it("stops following the zoom when it is destroyed, and leaves the other layers following it", () => {
        const { scene } = createScene();
        const first = new UsernameDomLayer(scene);
        const second = new UsernameDomLayer(scene);

        first.destroy();

        expect(scene.game.events.listenerCount(WaScaleManagerEvent.ZoomChanged)).toBe(1);
        second.destroy();
        expect(scene.game.events.listenerCount(WaScaleManagerEvent.ZoomChanged)).toBe(0);
    });

    it("hides every name below the zoom it is given, as one write, and shows them again above it", () => {
        const { scene, layerElements } = createScene();
        const layer = new UsernameDomLayer(scene, 0.65);
        const [element] = layerElements;
        const shown = () => element.style.display !== "none";
        const atStart = shown();

        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, 0.64);
        const zoomedOut = shown();
        const mutations = new MutationObserver(() => {});
        mutations.observe(element, { attributes: true, attributeFilter: ["style"] });
        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, 0.3);
        // The zoom step writes its own scale variable; the display is not written again.
        const writesWhileHidden = mutations.takeRecords().length;
        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, 0.65);

        expect([atStart, zoomedOut, shown()]).toEqual([true, false, true]);
        expect(writesWhileHidden).toBe(1);
        mutations.disconnect();
        layer.destroy();
    });

    it("keeps the names at every zoom without a zoom to hide them below", () => {
        const { scene, layerElements } = createScene();
        const layer = new UsernameDomLayer(scene);

        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, 0.1);

        expect(layerElements[0].style.display).not.toBe("none");
        layer.destroy();
    });

    it("has no timer and no render listener left once it is destroyed in the middle of a zoom", () => {
        const { scene } = createScene();
        const layer = new UsernameDomLayer(scene);
        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, 2);

        layer.destroy();

        expect(vi.getTimerCount()).toBe(0);
        expect(scene.events.listenerCount(Phaser.Scenes.Events.RENDER)).toBe(0);
    });
});
