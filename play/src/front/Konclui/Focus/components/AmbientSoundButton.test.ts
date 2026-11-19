// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { i18nObject, locales } from "../../../../i18n/i18n-util";
import { loadAllLocales } from "../../../../i18n/i18n-util.sync";
import { blockMapAudio } from "../../Preferences/stores/soundSettings";
import AmbientSoundButton from "./AmbientSoundButton.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { helpTextDisabledStore: writable(false) };
});
vi.mock("../../../Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));
// The setting's owner is upstream's local user store; its own behavior is covered with the sounds pane.
vi.mock("../../Preferences/stores/soundSettings", async () => {
    const { savedSetting } = await import("../../Preferences/stores/savedSetting");
    let blocked = false;
    return {
        blockMapAudio: savedSetting(
            () => blocked,
            (on: boolean) => {
                blocked = on;
            },
        ),
    };
});

loadAllLocales();

describe("AmbientSoundButton", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        blockMapAudio.set(false);
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
    });

    function show(): HTMLButtonElement {
        document.body.append(target);
        component = mount(AmbientSoundButton, { target });
        flushSync();
        const button = target.querySelector<HTMLButtonElement>('[data-testid="ambient-sound-button"]');
        if (button === null) throw new Error("no ambient sound button");
        return button;
    }

    it("is named, pressed while the map's sound plays, and a click mutes it", () => {
        const button = show();

        expect(button.getAttribute("aria-label")).toBe("konclui.ambientSound");
        expect(button.getAttribute("aria-pressed")).toBe("true");

        button.click();
        flushSync();

        expect(get(blockMapAudio)).toBe(true);
        expect(button.getAttribute("aria-pressed")).toBe("false");
    });

    it("unmutes on the next click, and is never disabled or red while it is off", () => {
        blockMapAudio.set(true);
        const button = show();

        expect(button.getAttribute("aria-pressed")).toBe("false");
        expect(button.disabled).toBe(false);
        expect(button.hasAttribute("aria-disabled")).toBe(false);
        expect(button.className).not.toContain("bg-danger");

        button.click();
        flushSync();

        expect(get(blockMapAudio)).toBe(false);
        expect(button.getAttribute("aria-pressed")).toBe("true");
    });

    it.each(locales)("has its name in %s", (locale) => {
        expect(i18nObject(locale).konclui.ambientSound().trim()).not.toBe("");
    });
});
