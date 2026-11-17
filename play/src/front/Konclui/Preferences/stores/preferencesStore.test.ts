// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { closePreferences, openPreferences, preferencesStore, showPane } from "./preferencesStore";

describe("preferencesStore", () => {
    afterEach(() => {
        closePreferences();
        document.body.replaceChildren();
    });

    it("opens on the section a caller names, by id or alias", () => {
        openPreferences("microphone");

        expect(get(preferencesStore)).toEqual({ open: true, pane: "media" });
    });

    it("switches the open dialog to another section instead of closing it", () => {
        openPreferences();
        openPreferences("shortcuts");

        expect(get(preferencesStore)).toEqual({ open: true, pane: "shortcuts" });
        showPane("profile");
        expect(get(preferencesStore).pane).toBe("profile");
    });

    it("gives the focus back to the button a caller names, which Safari does not focus on click", () => {
        const gear = document.createElement("button");
        document.body.append(gear);
        openPreferences(undefined, gear);
        expect(document.activeElement).toBe(document.body);

        closePreferences();

        expect(document.activeElement).toBe(gear);
    });

    it("gives the focus back to the control that opened it", () => {
        const gear = document.createElement("button");
        document.body.append(gear);
        gear.focus();
        openPreferences();
        const inside = document.createElement("button");
        document.body.append(inside);
        inside.focus();

        closePreferences();

        expect(get(preferencesStore).open).toBe(false);
        expect(document.activeElement).toBe(gear);
    });
});
