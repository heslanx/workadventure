// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import { SPRING_SURFACE, SPRING_SURFACE_MS, cubicBezier, springEasing } from "./spring";
import {
    SURFACE_EXIT_MS,
    SURFACE_EXIT_TRAVEL,
    SURFACE_ORIGIN_DEFAULT,
    SURFACE_SHEET_CURVE,
    surface,
} from "./surfaceTransition";
import SurfaceTransitionFixture from "./SurfaceTransitionFixture.svelte";

/** What `Element.animate` returns in a browser, as far as Svelte's transition reads it. */
class FakeAnimation {
    currentTime = 0;
    onfinish: (() => void) | null = null;
    cancelled = false;
    effect: unknown = {};

    constructor(
        readonly keyframes: Record<string, string>[],
        readonly options: { duration: number },
    ) {}

    cancel(): void {
        this.cancelled = true;
    }

    finish(): void {
        this.onfinish?.();
    }
}

const root = document.documentElement;
const entranceVariables = { "--k-enter-x": "-24px", "--k-enter-y": "0px" };

describe("surface", () => {
    let animations: FakeAnimation[];
    let node: HTMLElement;

    beforeEach(() => {
        animations = [];
        // jsdom has no Web Animations: the transition would find nothing to run, so each test lends it this one.
        Object.defineProperty(Element.prototype, "animate", {
            configurable: true,
            writable: true,
            value(keyframes: Record<string, string>[], options: { duration: number }) {
                const animation = new FakeAnimation(keyframes, options);
                animations.push(animation);
                // Svelte starts every run with a dummy animation as long as the delay (0) and waits for it to end.
                if (!options.duration) setTimeout(() => !animation.cancelled && animation.finish(), 0);
                return animation;
            },
        });
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
        for (const [name, value] of Object.entries(entranceVariables)) root.style.setProperty(name, value);
        node = document.createElement("div");
        document.body.append(node);
    });

    afterEach(() => {
        Reflect.deleteProperty(Element.prototype, "animate");
        vi.unstubAllGlobals();
        root.removeAttribute("style");
        document.body.replaceChildren();
    });

    /** The animation of a run that moves something: not the dummy one, and not one that was cancelled. */
    const running = () => animations.filter((animation) => animation.options.duration > 0 && !animation.cancelled);

    describe("the run it gives Svelte", () => {
        it("enters on the surface spring over 290 ms, from the origin the element declares", () => {
            const run = surface(node)({ direction: "in" });

            expect(run.duration).toBe(SPRING_SURFACE_MS);
            expect(run.easing?.(0.5)).toBeCloseTo(springEasing(SPRING_SURFACE, SPRING_SURFACE_MS)(0.5), 10);
            expect(run.css?.(0, 1)).toBe("opacity: 0; transform: translate(-24px, 0px) scale(0.98)");
            expect(run.css?.(1, 0)).toBe("opacity: 1; transform: translate(0px, 0px) scale(1)");
        });

        it("leaves over 200 ms on the sheet curve, and only half as far as it came", () => {
            const run = surface(node)({ direction: "out" });

            expect(run.duration).toBe(SURFACE_EXIT_MS);
            expect(run.easing?.(0.3)).toBeCloseTo(cubicBezier(...SURFACE_SHEET_CURVE)(0.3), 10);
            expect(run.css?.(1, 0)).toBe("opacity: 1; transform: translate(0px, 0px) scale(1)");
            expect(run.css?.(0, 1)).toBe(
                `opacity: 0; transform: translate(${-24 * SURFACE_EXIT_TRAVEL}px, 0px) scale(0.99)`,
            );
        });

        it("moves only opacity and transform, so the map is not re-fitted frame by frame", () => {
            const run = surface(node)({ direction: "in" });

            for (const t of [0, 0.25, 0.5, 1]) {
                const properties = (run.css?.(t, 1 - t) ?? "").split(";").map((part) => part.split(":")[0].trim());
                expect(properties).toEqual(["opacity", "transform"]);
            }
        });

        it("reads the defaults of .k-enter when the element declares nothing: 6 px below, 2 % small", () => {
            root.removeAttribute("style");

            const run = surface(node)({ direction: "in" });

            expect(SURFACE_ORIGIN_DEFAULT).toEqual({ x: 0, y: 6, scale: 0.98 });
            expect(run.css?.(0, 1)).toBe("opacity: 0; transform: translate(0px, 6px) scale(0.98)");
        });

        it("reads --k-enter-scale, and takes a number with or without px", () => {
            root.style.setProperty("--k-enter-scale", "0.9");
            root.style.setProperty("--k-enter-x", "12");

            expect(surface(node)({ direction: "in" }).css?.(0, 1)).toBe(
                "opacity: 0; transform: translate(12px, 0px) scale(0.9)",
            );
        });

        it("keeps the default for a value it cannot read in pixels, as a rem or a calc()", () => {
            root.style.setProperty("--k-enter-x", "2rem");
            root.style.setProperty("--k-enter-y", "calc(1px + 2px)");

            expect(surface(node)({ direction: "in" }).css?.(0, 1)).toBe(
                "opacity: 0; transform: translate(0px, 6px) scale(0.98)",
            );
        });

        it("takes the origin from its parameters over the element's", () => {
            const run = surface(node, { x: 10, y: -4, scale: 0.9 })({ direction: "in" });

            expect(run.css?.(0, 1)).toBe("opacity: 0; transform: translate(10px, -4px) scale(0.9)");
        });

        it("comes from the right on a page that reads right to left", () => {
            root.style.direction = "rtl";

            const run = surface(node)({ direction: "in" });
            const out = surface(node)({ direction: "out" });

            expect(run.css?.(0, 1)).toBe("opacity: 0; transform: translate(24px, 0px) scale(0.98)");
            expect(out.css?.(0, 1)).toBe("opacity: 0; transform: translate(12px, 0px) scale(0.99)");
        });

        it("keeps opacity in 0..1 where progress is sampled past an end, as a spring may be", () => {
            const run = surface(node)({ direction: "in" });

            expect(run.css?.(1.08, -0.08)).toMatch(/^opacity: 1;/);
            expect(run.css?.(-0.02, 1.02)).toMatch(/^opacity: 0;/);
        });

        it("ends at the opacity the element rests at, so a half-drawn control does not arrive brighter than it is", () => {
            node.style.opacity = "0.5";
            const transition = surface(node);
            const run = transition({ direction: "in" });
            const out = transition({ direction: "out" });

            expect(run.css?.(1, 0)).toMatch(/^opacity: 0\.5;/);
            expect(run.css?.(0.5, 0.5)).toMatch(/^opacity: 0\.25;/);
            expect(run.css?.(0, 1)).toMatch(/^opacity: 0;/);
            expect(out.css?.(1, 0)).toMatch(/^opacity: 0\.5;/);
        });

        it("multiplies both durations by --k-motion-scale, and is instant at 0", () => {
            root.style.setProperty("--k-motion-scale", "10");
            const slow = surface(node);

            expect(slow({ direction: "in" }).duration).toBe(SPRING_SURFACE_MS * 10);
            expect(slow({ direction: "out" }).duration).toBe(SURFACE_EXIT_MS * 10);

            root.style.setProperty("--k-motion-scale", "0");
            expect(surface(node)({ direction: "in" }).duration).toBe(0);
        });

        it("ignores a --k-motion-scale that is not a number or is negative", () => {
            root.style.setProperty("--k-motion-scale", "slow");
            expect(surface(node)({ direction: "in" }).duration).toBe(SPRING_SURFACE_MS);

            root.style.setProperty("--k-motion-scale", "-3");
            expect(surface(node)({ direction: "in" }).duration).toBe(0);
        });

        it("is instant for a viewer who reduces motion, read as each run starts", () => {
            const run = surface(node);
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));

            expect(run({ direction: "in" })).toEqual({ duration: 0 });
            expect(run({ direction: "out" })).toEqual({ duration: 0 });

            vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
            expect(run({ direction: "in" }).duration).toBe(SPRING_SURFACE_MS);
        });

        it("is instant where Element.animate is missing", () => {
            Reflect.deleteProperty(Element.prototype, "animate");

            expect(surface(node)({ direction: "in" })).toEqual({ duration: 0 });
        });

        it("enters when Svelte does not say which way it goes", () => {
            expect(surface(node)().duration).toBe(SPRING_SURFACE_MS);
        });
    });

    describe("a run that follows one that was cut short", () => {
        const transformAt = (run: ReturnType<ReturnType<typeof surface>>, t: number) => run.css?.(t, 1 - t);

        it("starts an entrance where the exit it reverses had got to, not where an entrance would have been", () => {
            const play = surface(node);
            const out = play({ direction: "out" });
            // The exit is sampled from rest down to where it is reversed.
            for (const t of [1, 0.9, 0.8, 0.7, 0.6]) transformAt(out, t);
            const painted = transformAt(out, 0.6);

            const back = play({ direction: "in" });

            // First sample of the entrance is at the progress it was reversed at.
            expect(transformAt(back, 0.6)).toBe(painted);
            // And it arrives at rest.
            expect(transformAt(back, 1)).toBe("opacity: 1; transform: translate(0px, 0px) scale(1)");
        });

        it("starts an exit where the entrance it cuts short had got to", () => {
            const play = surface(node);
            const enter = play({ direction: "in" });
            for (const t of [0, 0.1, 0.2, 0.3]) transformAt(enter, t);
            const painted = transformAt(enter, 0.3);

            const out = play({ direction: "out" });

            expect(transformAt(out, 0.3)).toBe(painted);
            expect(transformAt(out, 0)).toBe(
                `opacity: 0; transform: translate(${-24 * SURFACE_EXIT_TRAVEL}px, 0px) scale(0.99)`,
            );
        });

        it("holds across several reversals, and the opacity is the progress throughout", () => {
            const play = surface(node);
            const first = play({ direction: "out" });
            transformAt(first, 1);
            transformAt(first, 0.7);
            const second = play({ direction: "in" });
            transformAt(second, 0.7);
            transformAt(second, 0.85);
            const third = play({ direction: "out" });

            expect(transformAt(third, 0.85)).toBe(transformAt(second, 0.85));
            expect(transformAt(third, 0.85)).toMatch(/^opacity: 0.85;/);
        });
    });

    describe("in a Svelte block", () => {
        type Fixture = {
            setShell: (value: boolean) => void;
            setOpen: (value: boolean) => void;
            setInner: (value: boolean) => void;
        };
        let target: HTMLElement;
        let fixture: ReturnType<typeof mount> & Fixture;

        const surfaceElement = () => target.querySelector<HTMLElement>('[data-testid="surface"]');
        /** Lets Svelte's microtasks and the dummy animation's end run: a transition starts a tick after the flush. */
        const settle = async () => {
            await tick();
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
            await tick();
        };
        const finishRunning = async () => {
            for (const animation of running()) animation.finish();
            await settle();
        };

        beforeEach(async () => {
            target = document.createElement("div");
            document.body.append(target);
            fixture = mount(SurfaceTransitionFixture, { target }) as ReturnType<typeof mount> & Fixture;
            flushSync();
            await settle();
        });

        afterEach(async () => {
            await unmount(fixture);
        });

        const open = async () => {
            fixture.setOpen(true);
            flushSync();
            await settle();
        };
        const close = async () => {
            fixture.setOpen(false);
            flushSync();
            await settle();
        };

        it("plays the entrance over 290 ms when the block opens", async () => {
            await open();

            expect(surfaceElement()).not.toBeNull();
            expect(running().map((animation) => animation.options.duration)).toEqual([SPRING_SURFACE_MS]);
            await finishRunning();
            expect(surfaceElement()).not.toBeNull();
        });

        it("holds the element during the exit, and removes it once the exit has played", async () => {
            await open();
            await finishRunning();
            animations.length = 0;

            await close();

            expect(surfaceElement()).not.toBeNull();
            expect(running().map((animation) => animation.options.duration)).toEqual([SURFACE_EXIT_MS]);
            await finishRunning();
            expect(surfaceElement()).toBeNull();
        });

        it("holds the content as it was while the element leaves, though the block inside switched", async () => {
            await open();
            await finishRunning();

            fixture.setInner(false);
            fixture.setOpen(false);
            flushSync();
            await settle();

            expect(surfaceElement()?.querySelector('[data-testid="first"]')).not.toBeNull();
            expect(surfaceElement()?.querySelector('[data-testid="second"]')).toBeNull();
        });

        it("takes the element out of reach for the exit, so a press on it falls through", async () => {
            await open();
            await finishRunning();

            await close();

            // jsdom has no `inert`, but Svelte sets the property: it is what a browser hit-tests with.
            expect(surfaceElement()?.inert).toBe(true);
        });

        it("keeps the same element when it is reopened half way, and plays the rest of an entrance from there", async () => {
            await open();
            await finishRunning();
            const element = surfaceElement();
            animations.length = 0;
            await close();
            const exit = running()[0];
            exit.currentTime = SURFACE_EXIT_MS * 0.1;

            await open();

            expect(surfaceElement()).toBe(element);
            expect(exit.cancelled).toBe(true);
            // jsdom has no `inert`, so what Svelte restores is the `undefined` it found.
            expect(surfaceElement()?.inert).toBeFalsy();
            const entrance = running().at(-1);
            // Where the exit was at 10 % of its time on the sheet curve: 40 % of the way, so 60 % is still shown.
            const shown = 1 - cubicBezier(...SURFACE_SHEET_CURVE)(0.1);
            expect(entrance?.options.duration).toBeCloseTo(SPRING_SURFACE_MS * (1 - shown), 5);
            expect(entrance?.keyframes[0]?.opacity).toBe(String(Math.round(shown * 10_000) / 10_000));
            // And from the pose the exit had there (half as far as the entrance came, and 1 % small at the end), not
            // from the one an entrance would have had at that progress.
            const round = (value: number) => Math.round(value * 10_000) / 10_000;
            expect(entrance?.keyframes[0]?.transform).toBe(
                `translate(${round(-24 * SURFACE_EXIT_TRAVEL * (1 - shown))}px, 0px) scale(${round(1 - 0.01 * (1 - shown))})`,
            );
            expect(entrance?.keyframes.at(-1)).toMatchObject({
                opacity: "1",
                transform: "translate(0px, 0px) scale(1)",
            });
        });

        it("removes the element in the same flush for a viewer who reduces motion, with no animation and no event", async () => {
            await open();
            await finishRunning();
            animations.length = 0;
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));

            fixture.setOpen(false);
            flushSync();

            expect(surfaceElement()).toBeNull();
            expect(animations).toHaveLength(0);
        });

        it("shows the element at once, with no animation, for a viewer who reduces motion", () => {
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));

            fixture.setOpen(true);
            flushSync();

            expect(surfaceElement()).not.toBeNull();
            expect(animations).toHaveLength(0);
        });

        it("removes the element in the same flush where the browser has no Element.animate", () => {
            Reflect.deleteProperty(Element.prototype, "animate");
            fixture.setOpen(true);
            flushSync();
            expect(surfaceElement()).not.toBeNull();

            fixture.setOpen(false);
            flushSync();

            expect(surfaceElement()).toBeNull();
        });

        it("is local: nothing springs in when the shell around an open surface appears, and nothing holds it when the shell goes", async () => {
            fixture.setShell(false);
            fixture.setOpen(true);
            flushSync();
            await settle();
            expect(surfaceElement()).toBeNull();
            animations.length = 0;

            fixture.setShell(true);
            flushSync();
            await settle();

            expect(surfaceElement()).not.toBeNull();
            expect(animations).toHaveLength(0);

            fixture.setShell(false);
            flushSync();

            expect(surfaceElement()).toBeNull();
            expect(animations).toHaveLength(0);
        });
    });
});
