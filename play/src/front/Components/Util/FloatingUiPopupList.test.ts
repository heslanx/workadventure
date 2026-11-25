// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { stubWebAnimations, type WebAnimationsStub } from "../../Utils/webAnimationsStub";
import { floatingUiComponents, showFloatingUi } from "../../Utils/svelte-floatingui-show";
import FloatingUiPopupFixture from "./FloatingUiPopupFixture.svelte";
import FloatingUiPopupList from "./FloatingUiPopupList.svelte";

// jsdom has neither ResizeObserver nor IntersectionObserver, which autoUpdate() relies on. The stand-in places the popup
// once, as the real one does when it starts.
vi.mock("@floating-ui/dom", () => ({
    autoUpdate: (_reference: unknown, _floating: unknown, update: () => void) => {
        update();
        return () => {};
    },
    computePosition: () => Promise.resolve({ x: 12, y: 34, placement: "top-end", middlewareData: {} }),
    arrow: () => ({}),
    flip: () => ({}),
    shift: () => ({}),
    offset: () => ({}),
    limitShift: () => ({}),
}));

describe("the host of the floating popups", () => {
    let target: HTMLElement;
    let reference: HTMLElement;
    let host: ReturnType<typeof mount> | undefined;
    let animations: WebAnimationsStub;

    beforeEach(() => {
        animations = stubWebAnimations();
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
        target = document.createElement("div");
        reference = document.createElement("button");
        document.body.append(target, reference);
        host = mount(FloatingUiPopupList, { target });
        flushSync();
    });

    afterEach(async () => {
        floatingUiComponents.set(new Map());
        const mounted = host;
        host = undefined;
        if (mounted) await unmount(mounted, { outro: false });
        animations.restore();
        vi.unstubAllGlobals();
        document.body.replaceChildren();
    });

    /** The wrapper the host draws around a popup: the one that is positioned, and that an exit has to hold. */
    const wrappers = (): HTMLElement[] =>
        [...target.querySelectorAll<HTMLElement>('[data-testid="popup-content"]')].flatMap((content) =>
            content.parentElement === null ? [] : [content.parentElement],
        );
    const wrapperOf = (label: string): HTMLElement | undefined =>
        wrappers().find((wrapper) => wrapper.textContent?.includes(label));

    /** A menu or a picker the user opened (`motion`), as the profile menu and the pickers of the dock ask for it. */
    function openPopover(label = "popover"): () => void {
        return showFloatingUi(
            reference,
            FloatingUiPopupFixture,
            { label },
            { placement: "bottom" },
            8,
            true,
            false,
            undefined,
            3000,
            true,
        );
    }

    /** A hover tooltip, as the reaction tooltips of the chat open one: no `motion`. */
    function openTooltip(label = "tooltip"): () => void {
        return showFloatingUi(reference, FloatingUiPopupFixture, { label });
    }

    describe("a menu or a picker the user opened", () => {
        it("arrives on the surface spring, held at the origin the theme declares", async () => {
            openPopover();
            flushSync();
            await animations.settle();

            expect(wrapperOf("popover")).toBeDefined();
            expect(animations.moving().map((animation) => animation.options.duration)).toEqual([290]);
        });

        it("stays in the page for the length of its exit, out of reach, and is then taken away", async () => {
            const close = openPopover();
            flushSync();
            await animations.settle();
            await animations.finishMoving();
            const before = animations.animations.length;

            close();
            flushSync();
            await animations.settle();

            const wrapper = wrapperOf("popover");
            expect(wrapper).toBeDefined();
            expect(wrapper?.inert).toBe(true);
            expect(
                animations.animations.slice(before).filter((animation) => animation.options.duration > 0),
            ).toHaveLength(1);
            expect(animations.moving().map((animation) => animation.options.duration)).toEqual([200]);

            await animations.finishMoving();

            expect(wrapperOf("popover")).toBeUndefined();
            expect(wrappers()).toHaveLength(0);
        });

        it("keeps the content it had while it leaves", async () => {
            const close = openPopover("the profile menu");
            flushSync();
            await animations.settle();
            await animations.finishMoving();

            close();
            flushSync();
            await animations.settle();

            expect(wrapperOf("the profile menu")?.querySelector('[data-testid="popup-content"]')?.textContent).toBe(
                "the profile menu",
            );
        });

        it("is taken away in the same flush, with no animation, for a viewer who reduces motion", async () => {
            const close = openPopover();
            flushSync();
            await animations.settle();
            await animations.finishMoving();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
            const before = animations.animations.length;

            close();
            flushSync();

            expect(wrapperOf("popover")).toBeUndefined();
            expect(animations.animations.length).toBe(before);
        });

        it("appears at its final state, with no animation, for a viewer who reduces motion", async () => {
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));

            openPopover();
            flushSync();
            await animations.settle();

            expect(wrapperOf("popover")).toBeDefined();
            expect(animations.animations).toHaveLength(0);
        });

        it("grows from the side that faces its trigger, once Floating UI has placed it", async () => {
            openPopover();
            flushSync();
            await animations.settle();
            // The mock places it at `top-end`: the popup is above the trigger and aligned to its end.
            expect(wrapperOf("popover")?.style.transformOrigin).toBe("bottom right");
            expect(wrapperOf("popover")?.style.left).toBe("12px");
        });
    });

    describe("a hover tooltip", () => {
        it("gets no transition: nothing animates as it opens, and it is gone in the same flush as it closes", async () => {
            const close = openTooltip();
            flushSync();
            await animations.settle();
            expect(wrapperOf("tooltip")).toBeDefined();
            expect(animations.animations).toHaveLength(0);

            close();
            flushSync();

            expect(wrapperOf("tooltip")).toBeUndefined();
            expect(animations.animations).toHaveLength(0);
        });

        it("leaves the transform origin alone: it is not a surface that grows", async () => {
            openTooltip();
            flushSync();
            await animations.settle();

            expect(wrapperOf("tooltip")?.style.transformOrigin).toBe("");
        });

        it("goes at once while a popover that is open beside it keeps its own exit", async () => {
            openPopover();
            const closeTooltip = openTooltip();
            flushSync();
            await animations.settle();
            await animations.finishMoving();

            closeTooltip();
            flushSync();

            expect(wrapperOf("tooltip")).toBeUndefined();
            expect(wrapperOf("popover")).toBeDefined();
            expect(wrapperOf("popover")?.inert).not.toBe(true);
        });
    });
});
