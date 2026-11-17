import { describe, expect, it } from "vitest";
import { DEFAULT_PANE, indexAfter, paneAfter, paneFrom, PANE_IDS } from "./panes";

describe("paneFrom", () => {
    it("opens a section by its id", () => {
        expect(paneFrom("shortcuts")).toBe("shortcuts");
        expect(paneFrom("profile")).toBe("profile");
    });

    it("maps upstream menu keys and devices to their section", () => {
        expect(paneFrom("settings")).toBe("general");
        expect(paneFrom("credit")).toBe("general");
        expect(paneFrom("microphone")).toBe("media");
        expect(paneFrom("pip")).toBe("mini");
        expect(paneFrom("fx")).toBe("performance");
    });

    it("opens the first section without a name or with an unknown one", () => {
        expect(paneFrom(undefined)).toBe(DEFAULT_PANE);
        expect(paneFrom("pets")).toBe(DEFAULT_PANE);
        expect(paneFrom("toString")).toBe(DEFAULT_PANE);
    });
});

describe("indexAfter", () => {
    it("moves with both arrow axes and wraps at both ends", () => {
        expect(indexAfter(0, "ArrowDown", 3)).toBe(1);
        expect(indexAfter(0, "ArrowRight", 3)).toBe(1);
        expect(indexAfter(2, "ArrowDown", 3)).toBe(0);
        expect(indexAfter(0, "ArrowUp", 3)).toBe(2);
        expect(indexAfter(1, "ArrowLeft", 3)).toBe(0);
    });

    it("jumps to the ends with Home and End", () => {
        expect(indexAfter(1, "Home", 3)).toBe(0);
        expect(indexAfter(1, "End", 3)).toBe(2);
    });

    it("ignores other keys and empty lists", () => {
        expect(indexAfter(1, "Enter", 3)).toBeUndefined();
        expect(indexAfter(0, "ArrowDown", 0)).toBeUndefined();
    });
});

describe("paneAfter", () => {
    it("walks the section list in order, Perfil last", () => {
        expect(paneAfter("general", "ArrowDown")).toBe("media");
        expect(paneAfter("shortcuts", "ArrowDown")).toBe("profile");
        expect(paneAfter("profile", "ArrowDown")).toBe("general");
        expect(paneAfter("general", "End")).toBe(PANE_IDS[PANE_IDS.length - 1]);
        expect(paneAfter("general", "Tab")).toBeUndefined();
    });
});
