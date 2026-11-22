// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import EmojiMenuItem from "../../../../src/front/Components/ActionBar/MenuIcons/EmojiMenuItem.svelte";
import { activeSecondaryZoneActionBarStore } from "../../../../src/front/Stores/MenuStore";

// Where the focus goes when the reactions menu closes. The menu is opened by the dock's emoji button and holds the
// favourite reactions and the bubbles; when the keyboard closes it the focused element leaves with it, so the focus
// must go back to the button that opened it. A click outside closes it too, and that one must leave the focus to
// whatever was clicked.

vi.mock("../../../../src/front/ExternalModule/ReactionsMenuPort", async () => {
    const { readable } = await import("svelte/store");
    return { reactionsMenuExtension: readable(undefined) };
});
vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), default: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../../src/front/Stores/EmoteStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        emoteDataStore: writable(
            new Map([
                [1, { emoji: "👍", name: "thumbs up" }],
                [2, { emoji: "😀", name: "grinning face" }],
            ]),
        ),
        emoteMenuStore: writable(false),
        emoteMenuSubCurrentEmojiSelectedStore: writable(1),
        displayEmote: vi.fn(),
        isEmoteIndex: () => true,
    };
});
vi.mock("../../../../src/front/Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        activeSecondaryZoneActionBarStore: writable<string | undefined>(undefined),
        helpTextDisabledStore: writable(false),
        openedMenuStore: { closeAll: vi.fn() },
    };
});
vi.mock("../../../../src/front/Utils/svelte-floatingui", () => ({
    createFloatingUiActions: () => [() => ({}), () => ({}), () => ({})],
}));
vi.mock("../../../../src/front/Utils/svelte-floatingui-show", () => ({ showFloatingUi: vi.fn() }));
vi.mock("../../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: vi.fn() },
}));
vi.mock("../../../../src/front/Connection/ConnectionManager", () => ({
    connectionManager: { currentRoom: { isSayEnabled: true } },
}));
vi.mock("../../../../src/front/Stores/PopupStore", () => ({ popupStore: { addPopup: vi.fn() } }));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ userInputManager: { isControlsEnabled: true } }) },
}));
vi.mock("../../../../src/front/Components/EmoteMenu/LazyEmote.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/PopUp/SayPopUp.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/UI/Button.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/Icons/EmojiIcon.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/Icons", () => ({ IconCheck: () => undefined }));
vi.mock("@wa-icons", () => ({ IconPencil: () => undefined, IconXIcon: () => undefined }));

describe("the focus of the reactions menu", () => {
    let target: HTMLElement;
    let outside: HTMLButtonElement;
    let mounted: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        outside = document.createElement("button");
        outside.type = "button";
        document.body.append(target, outside);
        activeSecondaryZoneActionBarStore.set(undefined);
        // The menu flies in with a transition, which jsdom cannot animate: it plays at once here.
        Object.defineProperty(Element.prototype, "animate", {
            configurable: true,
            value: () => ({ cancel() {}, finish() {}, currentTime: 0, onfinish: null }),
        });
        mounted = mount(EmojiMenuItem, { target });
        flushSync();
    });

    afterEach(async () => {
        const component = mounted;
        mounted = undefined;
        if (component) await unmount(component);
        target.remove();
        outside.remove();
        Reflect.deleteProperty(Element.prototype, "animate");
    });

    const opener = (): HTMLButtonElement => {
        const button = target.querySelector<HTMLButtonElement>('[data-testid="emoji-btn"]');
        if (button === null) throw new Error("The emoji button is not drawn");
        return button;
    };
    const firstFavourite = (): HTMLButtonElement => {
        const button = target.querySelector<HTMLButtonElement>('[id="button-thumbs up"]');
        if (button === null) throw new Error("The menu is not open");
        return button;
    };
    const pressEscape = (): void => {
        // Dispatched on the focused element, as the browser does: it bubbles up to the window.
        (document.activeElement ?? document.body).dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        flushSync();
    };

    it("goes back to the emoji button when Escape closes the menu with the focus inside it", () => {
        opener().click();
        flushSync();
        firstFavourite().focus();
        expect(document.activeElement).toBe(firstFavourite());

        pressEscape();

        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        expect(document.activeElement).toBe(opener());
    });

    it("goes back to the emoji button when Escape closes a menu whose focus was already lost", () => {
        opener().click();
        flushSync();
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);

        pressEscape();

        expect(document.activeElement).toBe(opener());
    });

    it("leaves the focus where it is when it is on neither the menu nor the page", () => {
        opener().click();
        flushSync();
        outside.focus();

        pressEscape();

        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        expect(document.activeElement).toBe(outside);
    });

    it("does not take the focus from what was clicked when a click outside closes the menu", () => {
        opener().click();
        flushSync();
        firstFavourite().focus();

        // A real click focuses its target before the click event reaches the document.
        outside.focus();
        outside.click();
        flushSync();

        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        expect(document.activeElement).toBe(outside);
    });

    it("keeps the focus on the button when the button itself closes the menu", () => {
        opener().click();
        flushSync();
        opener().focus();

        opener().click();
        flushSync();

        expect(get(activeSecondaryZoneActionBarStore)).toBeUndefined();
        expect(document.activeElement).toBe(opener());
    });

    // jsdom does no layout: what is pinned here is the classes that keep the menu inside the screen. That it stays in
    // a 320 to 375 px viewport, with its 8 px gutter, is for a browser to confirm.
    describe("the width of the menu", () => {
        it("is sized by its content and held to the screen less the gutter, not by the room left of its anchor", () => {
            opener().click();
            flushSync();

            const wrapper = firstFavourite().closest(".absolute");
            expect(wrapper).not.toBeNull();
            const classes = [...(wrapper as Element).classList];
            // The floating position keeps 5 px from the edge: 10 px off the width, and 3 px of padding on a phone,
            // make the menu's own edge 8 px from the screen.
            expect(classes).toContain("w-max");
            expect(classes).toContain("max-w-[calc(100vw-10px)]");
            expect(classes).toContain("max-sm:px-[3px]");
        });

        it("lets the favourites and the edit button wrap, and takes less padding from each favourite on a phone", () => {
            opener().click();
            flushSync();

            const favourites = firstFavourite().parentElement?.parentElement;
            const row = favourites?.parentElement;
            expect([...(favourites?.classList ?? [])]).toContain("flex-wrap");
            expect([...(row?.classList ?? [])]).toContain("flex-wrap");
            expect([...firstFavourite().classList]).toContain("max-sm:px-1");
        });
    });
});
