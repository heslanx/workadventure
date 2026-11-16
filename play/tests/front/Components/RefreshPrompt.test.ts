// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import RefreshPrompt from "../../../src/front/Components/RefreshPrompt.svelte";
import { liveAnnouncementStore } from "../../../src/front/Stores/LiveAnnouncementStore";
import { refreshPromptStore } from "../../../src/front/Stores/RefreshPromptStore";

vi.mock("../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        LL: readable({
            mapEditor: { map: { refreshPrompt: () => "New version of map detected. Refresh needed" } },
            refreshPrompt: {
                refresh: () => "Refresh",
                notNow: () => "Not now",
                reason: () => "The map was updated.",
                countdown: ({ seconds }: { seconds: number }) => `Refreshing in ${seconds}`,
                postponedMessage: () => "The map was updated. Refresh when you are ready.",
            },
        }),
    };
});

describe("RefreshPrompt", () => {
    const target = document.createElement("div");
    const reload = vi.fn();
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        reload.mockClear();
        vi.stubGlobal("location", { reload });
        // jsdom does no layout: without a rect, the focus trap sees nothing visible to focus.
        vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
            new DOMRect(0, 0, 10, 10),
        ] as unknown as DOMRectList);
        document.body.appendChild(target);
        refreshPromptStore.set({ timeToRefresh: 30 });
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        target.replaceChildren();
        target.remove();
        refreshPromptStore.set(undefined);
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("explains the refresh, counts down outside any live region and puts the focus on Not now", () => {
        component = mount(RefreshPrompt, { target, intro: false });
        flushSync();

        const dialog = target.querySelector("[role='alertdialog']");
        expect(dialog).not.toBeNull();
        const countdown = target.querySelector("[data-testid='refresh-prompt-countdown']");
        expect(countdown?.textContent?.trim()).toBe("Refreshing in 30");
        expect(countdown?.getAttribute("aria-live")).toBe("off");
        expect(document.activeElement).toBe(target.querySelector("[data-testid='refresh-prompt-not-now']"));

        vi.advanceTimersByTime(3000);
        flushSync();
        expect(countdown?.textContent?.trim()).toBe("Refreshing in 27");
    });

    it("turns into a banner on Not now and never reloads the page by itself afterwards", () => {
        component = mount(RefreshPrompt, { target, intro: false });
        flushSync();

        target.querySelector<HTMLButtonElement>("[data-testid='refresh-prompt-not-now']")?.click();
        flushSync();

        expect(target.querySelector("[role='alertdialog']")).toBeNull();
        expect(target.querySelector("[data-testid='refresh-prompt-banner']")).not.toBeNull();
        expect(get(liveAnnouncementStore)?.text).toBe("The map was updated. Refresh when you are ready.");

        vi.advanceTimersByTime(120_000);
        expect(reload).not.toHaveBeenCalled();
    });

    it("treats Escape as Not now", () => {
        component = mount(RefreshPrompt, { target, intro: false });
        flushSync();

        target
            .querySelector("[role='alertdialog']")
            ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        flushSync();

        expect(target.querySelector("[data-testid='refresh-prompt-banner']")).not.toBeNull();
    });

    it("reloads the page when the countdown reaches zero", () => {
        component = mount(RefreshPrompt, { target, intro: false });
        flushSync();

        vi.advanceTimersByTime(31_000);

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("stops its countdown when it is removed", async () => {
        component = mount(RefreshPrompt, { target, intro: false });
        flushSync();

        const mountedComponent = component;
        component = undefined;
        await unmount(mountedComponent, { outro: false });

        vi.advanceTimersByTime(120_000);
        expect(reload).not.toHaveBeenCalled();
    });
});
