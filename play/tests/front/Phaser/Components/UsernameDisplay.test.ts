// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsernameDisplay } from "../../../../src/front/Phaser/Components/UsernameDisplay";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { UsernameDomLayer } from "../../../../src/front/Phaser/Game/UsernameDomLayer";
import { waScaleManager, WaScaleManagerEvent } from "../../../../src/front/Phaser/Services/WaScaleManager";

// The scale the layer shares with every name tag, and the one the tags' own transform follows.
const DOM_SCALE = "--username-dom-scale";
const TRANSFORM_SCALE = "--username-transform-scale";

// The width of the probe the layer measures its scale with, in layout pixels.
const PROBE_SIZE = 100;
// One wheel notch: the zoom tween runs for about this many frames.
const NOTCH_FRAMES = 15;
// Zooming in or out must cost a handful of style writes, however many name tags there are.
const MAX_STYLE_WRITES_PER_NOTCH = 20;
const TAG_COUNT = 1000;
// Zooming out below MIN_NAME_ZOOM is the costly case: the name's size changes on every frame of the tween.
const START_ZOOM = 0.6;
const END_ZOOM = 0.3;
// Below this zoom the name stops shrinking with the map (see CORRECTION_RATE in UsernameDisplay).
const MIN_NAME_ZOOM = 0.65;

/** Counts the writes made through any element's `style` until `stop()` is called. */
function countStyleWrites(): { count: () => number; stop: () => void } {
    let writes = 0;
    let depth = 0;
    const restore: Array<() => void> = [];

    // A write may be implemented through another one (`style.height = x` calls `setProperty`): count the outer one.
    const counted = (write: (this: unknown, ...args: unknown[]) => unknown) =>
        function (this: unknown, ...args: unknown[]): unknown {
            if (depth++ === 0) writes++;
            try {
                return write.apply(this, args);
            } finally {
                depth--;
            }
        };

    let proto: object | null = Object.getPrototypeOf(document.createElement("div").style) as object;
    while (proto !== null && proto !== Object.prototype) {
        const owner = proto;
        for (const key of Reflect.ownKeys(owner)) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, key);
            if (descriptor === undefined || key === "constructor") continue;
            if (descriptor.set !== undefined) {
                // The setter is wrapped, and the wrapper calls it with the `this` it is given.
                // eslint-disable-next-line @typescript-eslint/unbound-method
                Object.defineProperty(owner, key, { ...descriptor, set: counted(descriptor.set) });
                restore.push(() => Object.defineProperty(owner, key, descriptor));
            } else if (key === "setProperty" || key === "removeProperty") {
                Object.defineProperty(owner, key, { ...descriptor, value: counted(descriptor.value) });
                restore.push(() => Object.defineProperty(owner, key, descriptor));
            }
        }
        proto = Object.getPrototypeOf(owner) as object | null;
    }

    return { count: () => writes, stop: () => restore.forEach((undo) => undo()) };
}

function setup(tagCount: number, startZoom = 1) {
    let zoom = startZoom;
    vi.spyOn(waScaleManager, "zoomModifier", "get").mockImplementation(() => zoom);

    let layerElement!: HTMLElement;
    const domElement = {
        pointerEvents: "",
        setOrigin: () => domElement,
        setDepth: () => domElement,
        setVisible: () => {},
        destroy: () => {},
    };
    const markDirty = vi.fn();
    const scene = {
        events: new Phaser.Events.EventEmitter(),
        game: { events: new Phaser.Events.EventEmitter() },
        add: {
            dom: (_x: number, _y: number, element: HTMLElement) => {
                layerElement = element;
                return domElement;
            },
        },
        markDirty,
    } as unknown as GameScene;
    // Like the browser: the layer measures the on-screen width of its probe, which is the camera zoom. It is laid out
    // at the zoom the camera has when the layer asks, as the real one is once per frame.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const width = this === layerElement.firstElementChild ? zoom * PROBE_SIZE : 0;
        return { width } as DOMRect;
    });
    const usernameDomLayer = new UsernameDomLayer(scene);
    Object.assign(scene, { usernameDomLayer });

    const render = () => scene.events.emit(Phaser.Scenes.Events.RENDER);
    const createTag = (index: number) =>
        new UsernameDisplay(scene, index * 10, index * 5, `player ${index}`, undefined);
    const tags = Array.from({ length: tagCount }, (_, index) => createTag(index));
    // The first frame of the scene: the layer scale is measured once Phaser has rendered.
    render();

    const zoomFrame = (nextZoom: number) => {
        zoom = nextZoom;
        scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, nextZoom);
        render();
    };
    /** The quiet after a zoom: the camera has stopped, and the next frame is rendered. */
    const settle = () => {
        vi.runOnlyPendingTimers();
        render();
    };
    /** A zoom tween (one frame per step), then the quiet that follows it. */
    const zoomNotch = (to: number) => {
        const from = zoom;
        for (let frame = 1; frame <= NOTCH_FRAMES; frame++) zoomFrame(from + ((to - from) * frame) / NOTCH_FRAMES);
        settle();
    };
    const layerVariable = (name: string) => Number(layerElement.style.getPropertyValue(name));
    /** How large the name appears on screen, relative to its size in the map at a zoom of 1. */
    const renderedScale = () => layerVariable(DOM_SCALE) * layerVariable(TRANSFORM_SCALE) * zoom;

    return {
        scene,
        usernameDomLayer,
        markDirty,
        tags,
        layerElement,
        zoomFrame,
        zoomNotch,
        settle,
        layerVariable,
        renderedScale,
        createTag,
        render,
    };
}

describe("name tags while the camera zooms", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("costs a handful of style writes per zoom notch, however many name tags there are", { timeout: 60_000 }, () => {
        const writesPerNotch = (tagCount: number): number => {
            const { zoomNotch } = setup(tagCount, START_ZOOM);
            const counter = countStyleWrites();
            try {
                zoomNotch(END_ZOOM);
                return counter.count();
            } finally {
                counter.stop();
            }
        };

        const withFewTags = writesPerNotch(10);
        const withManyTags = writesPerNotch(TAG_COUNT);

        console.info(
            `style writes per zoom notch: ${withFewTags} with 10 name tags, ${withManyTags} with ${TAG_COUNT}`,
        );
        expect(withManyTags).toBeLessThanOrEqual(MAX_STYLE_WRITES_PER_NOTCH);
        expect(withManyTags).toBe(withFewTags);
    });

    it("keeps the name at the size of the map zoom, down to the zoom where it stops shrinking", () => {
        const { zoomFrame, renderedScale } = setup(3, 2);

        for (const zoom of [1.6, 1, 0.8, 0.65, 0.5, 0.3, 0.5, 1.2, 2]) {
            zoomFrame(zoom);
            // The layer keeps the layout it had when the zoom last settled; the tags' transform makes up the difference.
            expect(renderedScale()).toBeCloseTo(Math.max(zoom, MIN_NAME_ZOOM));
        }
    });

    it("lays the names out again at their final size once the zoom has settled", () => {
        const { markDirty, zoomFrame, zoomNotch, settle, layerVariable } = setup(3, 1);
        expect(layerVariable(DOM_SCALE)).toBe(1);
        expect(layerVariable(TRANSFORM_SCALE)).toBe(1);

        // The layout waits for the zoom to stop...
        zoomFrame(1.5);
        zoomFrame(2);
        expect(layerVariable(DOM_SCALE)).toBe(1);
        expect(markDirty).not.toHaveBeenCalled();

        // ... then the pills are laid out at the size they are shown at, and the transform undoes the layer's magnification.
        // The game loop does not render an idle scene, so the settle has to ask for the frame that applies it.
        settle();
        expect(markDirty).toHaveBeenCalledTimes(1);
        expect(layerVariable(DOM_SCALE)).toBeCloseTo(2);
        expect(layerVariable(TRANSFORM_SCALE)).toBeCloseTo(0.5);

        // Zoomed out, the layer minifies by itself: the transform stays at 1 and the layout absorbs the correction.
        zoomNotch(0.5);
        expect(layerVariable(TRANSFORM_SCALE)).toBe(1);
        expect(layerVariable(DOM_SCALE)).toBeCloseTo(MIN_NAME_ZOOM / 0.5);
    });

    it("leaves every name tag where it is while the zoom changes", () => {
        const { tags, layerElement, zoomNotch, render } = setup(3);
        tags[1].setPosition(120, 40);
        render();
        // The first child of the layer is the probe that measures its scale.
        const transformOf = (index: number) =>
            (layerElement.children[index + 1] as HTMLElement).style.getPropertyValue("transform");
        const before = transformOf(1);
        expect(before).toContain("translate3d(120px, 40px, 0)");

        zoomNotch(2);

        expect(transformOf(1)).toBe(before);
    });

    it("sizes a name tag created mid-zoom from the layer, like the others", () => {
        const { zoomFrame, createTag, layerElement } = setup(2);
        zoomFrame(1.5);

        createTag(7);

        // A scale of its own would shadow the layer's: the tag would stay at the size it was created at.
        const tag = layerElement.lastElementChild as HTMLElement;
        expect(tag.style.getPropertyValue(DOM_SCALE)).toBe("");
        expect(tag.style.getPropertyValue(TRANSFORM_SCALE)).toBe("");
    });

    it("keeps following the zoom while the layer exists, and stops when it is destroyed", () => {
        const { scene, usernameDomLayer, tags, zoomFrame, zoomNotch, layerVariable } = setup(2);

        tags[0].destroy();
        tags[1].destroy();
        zoomNotch(2);
        expect(layerVariable(DOM_SCALE)).toBeCloseTo(2);

        zoomFrame(3);
        usernameDomLayer.destroy();

        expect(scene.game.events.listenerCount(WaScaleManagerEvent.ZoomChanged)).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
