// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { WorkAdventureComponent } from "../../types/component";
import { floatingUiComponents, showFloatingUi } from "./svelte-floatingui-show";

// The placement Floating UI settles on, which a test sets before it opens a popup.
const placed = vi.hoisted(() => ({ placement: "bottom" }));

// jsdom has neither ResizeObserver nor IntersectionObserver, which autoUpdate() relies on. The stand-in places the popup
// once, as the real one does when it starts.
vi.mock("@floating-ui/dom", () => ({
    autoUpdate: (_reference: unknown, _floating: unknown, update: () => void) => {
        update();
        return () => {};
    },
    computePosition: () => Promise.resolve({ x: 0, y: 0, placement: placed.placement, middlewareData: {} }),
    arrow: () => ({}),
    flip: () => ({}),
    shift: () => ({}),
    offset: () => ({}),
    limitShift: () => ({}),
}));

const TestComponent = (() => undefined) as unknown as WorkAdventureComponent;
const referenceNode = {} as Element;

afterEach(() => {
    floatingUiComponents.set(new Map());
});

describe("showFloatingUi", () => {
    it("uses the global floating layer by default", () => {
        const close = showFloatingUi(referenceNode, TestComponent, {});

        expect([...get(floatingUiComponents).values()][0]?.zIndex).toBe(3000);

        close();
    });

    it("allows a popup to override its layer", () => {
        const close = showFloatingUi(referenceNode, TestComponent, {}, undefined, 0, true, false, undefined, 1100);

        expect([...get(floatingUiComponents).values()][0]?.zIndex).toBe(1100);

        close();
    });
});

describe("showFloatingUi motion", () => {
    /** Opens a popup the way FloatingUiPopupList does, with a real content node the registered action is run on. */
    async function open(motion: boolean | undefined, placement: string) {
        placed.placement = placement;
        const reference = document.createElement("div");
        const content = document.createElement("div");
        document.body.append(reference, content);

        const close = showFloatingUi(reference, TestComponent, {}, undefined, 0, false, false, undefined, 3000, motion);
        const entry = [...get(floatingUiComponents).values()][0];
        if (entry === undefined) {
            throw new Error("No popup was registered");
        }
        entry.action(content);
        // Floating UI answers with a promise, and the popup is placed when it resolves.
        await Promise.resolve();
        await Promise.resolve();
        return { close, entry, content };
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it("is a tooltip by default: the entry asks for no motion", () => {
        const close = showFloatingUi(referenceNode, TestComponent, {});

        expect([...get(floatingUiComponents).values()][0]?.motion).toBe(false);

        close();
    });

    it("records the motion the caller asked for, on the entry the host reads", async () => {
        const { entry, close } = await open(true, "bottom");

        expect(entry.motion).toBe(true);

        close();
    });

    it("grows from the side that faces the trigger, as Floating UI placed it after it flipped", async () => {
        const { content } = await open(true, "top-start");

        expect(content.style.transformOrigin).toBe("bottom left");
        expect(content.style.left).toBe("0px");
    });

    it("grows from the other corner on a page that reads right to left", async () => {
        document.documentElement.style.direction = "rtl";
        try {
            const { content } = await open(true, "bottom-start");

            expect(content.style.transformOrigin).toBe("top right");
        } finally {
            document.documentElement.style.removeProperty("direction");
        }
    });

    it("leaves the transform origin alone for a tooltip", async () => {
        const { content } = await open(undefined, "top-start");

        expect(content.style.transformOrigin).toBe("");
        // It was placed all the same: only the origin is a matter of motion.
        expect(content.style.left).toBe("0px");
    });
});

describe("showFloatingUi closeOnClickOutside", () => {
    /**
     * Arm the click-outside listener the way FloatingUiPopupList does: mount the popup with a real
     * reference node, then run the registered content action against a real content node.
     */
    function open(onClose?: () => void) {
        const reference = document.createElement("div");
        const content = document.createElement("div");
        document.body.append(reference, content);

        showFloatingUi(reference, TestComponent, {}, undefined, 0, false, true, onClose);
        const entry = [...get(floatingUiComponents).values()][0];
        if (entry === undefined) {
            throw new Error("No popup was registered");
        }
        entry.action(content);
        return { reference, content };
    }

    // jsdom does not implement TouchEvent; the handler only reads e.target, so a generic Event of
    // type "touchstart" fires the same listener.
    const touchStart = () => new Event("touchstart", { bubbles: true });

    it("closes on a mousedown outside the reference and content", () => {
        open();

        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        expect(get(floatingUiComponents).size).toBe(0);
    });

    it("closes on a touchstart outside (mobile, where the canvas swallows mousedown)", () => {
        open();

        document.body.dispatchEvent(touchStart());

        expect(get(floatingUiComponents).size).toBe(0);
    });

    it("does not close when the reference or the content is touched", () => {
        const { reference, content } = open();

        reference.dispatchEvent(touchStart());
        content.dispatchEvent(touchStart());

        expect(get(floatingUiComponents).size).toBe(1);
    });

    it("calls onClose once when a tap fires touchstart then a compatibility mousedown", () => {
        const onClose = vi.fn();
        open(onClose);

        // A single tap on most mobile browsers emits touchstart followed by a mousedown.
        document.body.dispatchEvent(touchStart());
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        expect(get(floatingUiComponents).size).toBe(0);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
