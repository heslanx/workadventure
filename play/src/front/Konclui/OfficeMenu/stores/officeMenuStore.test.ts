// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
    closeOfficeMenu,
    isOfficeMenuOpener,
    officeMenuOpenStore,
    openOfficeMenu,
    toggleOfficeMenu,
} from "./officeMenuStore";

describe("officeMenuStore", () => {
    afterEach(() => {
        closeOfficeMenu({ returnFocus: false });
        document.body.replaceChildren();
    });

    function logo(): HTMLButtonElement {
        const button = document.createElement("button");
        document.body.append(button);
        return button;
    }

    it("is closed until something opens it, and a press on its logo opens and closes it", () => {
        const from = logo();
        expect(get(officeMenuOpenStore)).toBe(false);

        toggleOfficeMenu(from);
        expect(get(officeMenuOpenStore)).toBe(true);

        toggleOfficeMenu(from);
        expect(get(officeMenuOpenStore)).toBe(false);
    });

    it("gives the focus back to the logo that opened it, which Safari does not focus on click", () => {
        const from = logo();
        openOfficeMenu(from);
        expect(document.activeElement).toBe(document.body);

        closeOfficeMenu({ returnFocus: true });

        expect(document.activeElement).toBe(from);
    });

    it("leaves the focus where a press somewhere else put it", () => {
        const from = logo();
        const elsewhere = logo();
        openOfficeMenu(from);
        elsewhere.focus();

        closeOfficeMenu({ returnFocus: false });

        expect(get(officeMenuOpenStore)).toBe(false);
        expect(document.activeElement).toBe(elsewhere);
    });

    it("keeps the first logo as the one to return to when it is opened again while open", () => {
        const first = logo();
        const second = logo();
        openOfficeMenu(first);
        openOfficeMenu(second);

        expect(closeOfficeMenu({ returnFocus: true })).toBe(first);
        expect(document.activeElement).toBe(first);
    });

    it("tells a press on the logo that opened it from a press outside", () => {
        const from = logo();
        const inside = document.createElement("span");
        from.append(inside);
        const outside = logo();
        openOfficeMenu(from);

        expect(isOfficeMenuOpener(from)).toBe(true);
        expect(isOfficeMenuOpener(inside)).toBe(true);
        expect(isOfficeMenuOpener(outside)).toBe(false);
    });

    it("does not touch the focus when it is not open", () => {
        const elsewhere = logo();
        elsewhere.focus();

        expect(closeOfficeMenu({ returnFocus: true })).toBeUndefined();
        expect(document.activeElement).toBe(elsewhere);
    });
});
