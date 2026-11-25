// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glide } from "./glide";

interface Box {
    top: number;
    left: number;
    width: number;
    height: number;
}

/** jsdom does no layout, so a row says where it would be: what `offsetTop` and the others would read in a browser. */
function placed(row: HTMLElement, { top, left, width, height }: Box): HTMLElement {
    Object.defineProperties(row, {
        offsetTop: { value: top },
        offsetLeft: { value: left },
        offsetWidth: { value: width },
        offsetHeight: { value: height },
    });
    return row;
}

const hover = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query === "(hover: hover)", media: query }));

describe("glide", () => {
    let container: HTMLElement;
    let rows: HTMLElement[];
    let title: HTMLElement;
    let disabled: HTMLElement;
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
        hover(true);
        container = document.createElement("div");
        container.className = "k-glide";
        rows = [0, 1, 2].map((index) => {
            const row = document.createElement("button");
            row.className = "row";
            row.textContent = `row ${index}`;
            container.append(row);
            return placed(row, { top: 50 * index, left: 6, width: 252, height: 44 });
        });
        // A title and a disabled row between the rows: the pill has nothing to follow there.
        title = document.createElement("span");
        title.className = "title";
        container.append(title);
        disabled = placed(document.createElement("button"), { top: 150, left: 6, width: 252, height: 44 });
        disabled.className = "row";
        disabled.setAttribute("aria-disabled", "true");
        container.append(disabled);
        document.body.append(container);
    });

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
        vi.unstubAllGlobals();
        document.body.replaceChildren();
    });

    const attach = () => {
        const result = glide({ item: ".row" })(container);
        cleanup = typeof result === "function" ? result : undefined;
    };
    const pill = () => container.querySelector<HTMLElement>(".k-glide-pill");
    const geometry = () => ["x", "y", "w", "h"].map((name) => pill()?.style.getPropertyValue(`--k-glide-${name}`));
    const over = (target: Element, init: PointerEventInit = {}) =>
        target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", ...init }));
    const keyboardFocus = (row: HTMLElement) => {
        // jsdom does not tell a key from a press: the row says it has the focus the way a keyboard gives it.
        row.matches = (selector: string) => selector === ":focus-visible";
        row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    };

    it("puts one pill in the container, hidden, out of the reading order, and marks the container", () => {
        attach();

        expect(container.querySelectorAll(".k-glide-pill")).toHaveLength(1);
        expect(pill()?.classList.contains("is-shown")).toBe(false);
        expect(pill()?.getAttribute("aria-hidden")).toBe("true");
        expect(container.classList.contains("k-glide-on")).toBe(true);
    });

    it("writes the row's place and size on the pill when the pointer comes over it", () => {
        attach();

        over(rows[1]);

        expect(geometry()).toEqual(["6px", "50px", "252px", "44px"]);
        expect(pill()?.classList.contains("is-shown")).toBe(true);
    });

    it("finds the row from what is inside it, as its icon or its label", () => {
        attach();
        const label = document.createElement("span");
        rows[2].append(label);

        over(label);

        expect(geometry()).toEqual(["6px", "100px", "252px", "44px"]);
    });

    it("moves to the next row, and stays shown while it does", () => {
        attach();
        over(rows[0]);

        over(rows[2]);

        expect(geometry()).toEqual(["6px", "100px", "252px", "44px"]);
        expect(pill()?.classList.contains("is-shown")).toBe(true);
    });

    it("takes the first place with the transition off and gives it back, so only the move between rows glides", () => {
        attach();
        const element = pill();
        if (element === null) throw new Error("no pill");
        // The one read between "off" and "on" is what makes the browser take the position before the transition.
        const flushed: { transition: string; y: string }[] = [];
        const flush = vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
            flushed.push({ transition: element.style.transition, y: element.style.getPropertyValue("--k-glide-y") });
            return new DOMRect();
        });

        over(rows[1]);
        expect(flushed).toEqual([{ transition: "none", y: "50px" }]);
        expect(element.style.transition).toBe("");

        over(rows[2]);
        expect(flush).toHaveBeenCalledOnce();

        container.dispatchEvent(new PointerEvent("pointerleave"));
        over(rows[0]);
        expect(flush).toHaveBeenCalledTimes(2);
    });

    it("hides when the pointer leaves the list", () => {
        attach();
        over(rows[0]);

        container.dispatchEvent(new PointerEvent("pointerleave"));

        expect(pill()?.classList.contains("is-shown")).toBe(false);
    });

    it("stays where it is while the pointer is over what is between the rows: a title, a gap, a divider", () => {
        attach();
        over(rows[0]);

        over(title);

        expect(pill()?.classList.contains("is-shown")).toBe(true);
        expect(geometry()).toEqual(["6px", "0px", "252px", "44px"]);
    });

    it("glides from a row to the next across what is between them, and does not fade out and in", () => {
        attach();
        const element = pill();
        if (element === null) throw new Error("no pill");
        // The one read of the layout that a first placement does is the snap; a glide has none.
        const flush = vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => new DOMRect());

        over(rows[0]);
        over(title);
        over(rows[2]);

        expect(flush).toHaveBeenCalledOnce();
        expect(element.classList.contains("is-shown")).toBe(true);
        expect(geometry()).toEqual(["6px", "100px", "252px", "44px"]);
    });

    it("does not follow a row that cannot act", () => {
        attach();
        over(rows[0]);

        over(disabled);

        expect(pill()?.classList.contains("is-shown")).toBe(false);
    });

    it("does not follow a touch, which is a tap and not a hover", () => {
        attach();

        over(rows[1], { pointerType: "touch" });

        expect(pill()?.classList.contains("is-shown")).toBe(false);
        expect(geometry()).toEqual(["", "", "", ""]);
    });

    it("follows the row that the keyboard focuses", () => {
        attach();

        keyboardFocus(rows[2]);

        expect(geometry()).toEqual(["6px", "100px", "252px", "44px"]);
        expect(pill()?.classList.contains("is-shown")).toBe(true);
    });

    it("does not show a row that was focused by a press or a script: that is not a hover", () => {
        attach();

        // jsdom answers `:focus-visible` as false for a focus it did not see a key press for.
        rows[1].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(pill()?.classList.contains("is-shown")).toBe(false);
    });

    it("hides when the focus leaves the list, and not when it moves from one row to another", () => {
        attach();
        keyboardFocus(rows[0]);

        rows[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: rows[1] }));
        expect(pill()?.classList.contains("is-shown")).toBe(true);

        rows[1].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
        expect(pill()?.classList.contains("is-shown")).toBe(false);

        keyboardFocus(rows[0]);
        rows[0].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
        expect(pill()?.classList.contains("is-shown")).toBe(false);
    });

    it("removes its listeners, its pill and its mark when it is cleaned up", () => {
        const add = vi.spyOn(container, "addEventListener");
        const remove = vi.spyOn(container, "removeEventListener");
        attach();
        const added = add.mock.calls.map(([type, listener]) => [type, listener]);

        cleanup?.();
        cleanup = undefined;

        expect(added.map(([type]) => type).sort()).toEqual(["focusin", "focusout", "pointerleave", "pointerover"]);
        expect(remove.mock.calls.map(([type, listener]) => [type, listener])).toEqual(expect.arrayContaining(added));
        expect(pill()).toBeNull();
        expect(container.classList.contains("k-glide-on")).toBe(false);
        expect(container.classList.contains("k-glide")).toBe(true);
        // What happens in the list after that moves nothing.
        over(rows[0]);
        expect(pill()).toBeNull();
    });

    it("does nothing on a device without hover: no pill, no listener, no mark", () => {
        hover(false);
        const add = vi.spyOn(container, "addEventListener");

        const result = glide({ item: ".row" })(container);

        expect(result).toBeUndefined();
        expect(pill()).toBeNull();
        expect(add).not.toHaveBeenCalled();
        expect(container.classList.contains("k-glide-on")).toBe(false);
    });

    it("does nothing where the browser cannot say whether there is a hover", () => {
        vi.stubGlobal("matchMedia", undefined);

        const result = glide({ item: ".row" })(container);

        expect(result).toBeUndefined();
        expect(pill()).toBeNull();
    });
});
