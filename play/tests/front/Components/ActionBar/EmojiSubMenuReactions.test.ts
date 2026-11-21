// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import EmojiSubMenu from "../../../../src/front/Components/ActionBar/EmojiSubMenu.svelte";
import ExtensionStub from "./ReactionsExtensionStub.svelte";

// What the reactions menu does with the port an extension registers: with nothing registered it is upstream's menu,
// and with an extension it holds its section and takes the names it gives the favourite reactions.

const { port } = vi.hoisted(() => {
    const holder: { extension: unknown } = { extension: undefined };
    return { port: holder };
});

vi.mock("../../../../src/front/ExternalModule/ReactionsMenuPort", async () => {
    const { readable } = await import("svelte/store");
    return {
        reactionsMenuExtension: {
            subscribe: (run: (value: unknown) => void) => readable(port.extension).subscribe(run),
        },
    };
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
    const favourites = new Map([
        [1, { emoji: "👍", name: "thumbs up" }],
        [2, { emoji: "😀", name: "grinning face" }],
    ]);
    return {
        emoteDataStore: writable(favourites),
        emoteMenuStore: writable(false),
        emoteMenuSubCurrentEmojiSelectedStore: writable(1),
        displayEmote: vi.fn(),
        isEmoteIndex: () => true,
    };
});
vi.mock("../../../../src/front/Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { activeSecondaryZoneActionBarStore: writable("emote") };
});
vi.mock("../../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: vi.fn() },
}));
vi.mock("../../../../src/front/Utils/svelte-floatingui-show", () => ({ showFloatingUi: vi.fn() }));
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
vi.mock("@wa-icons", () => ({ IconPencil: () => undefined, IconXIcon: () => undefined }));

describe("the reactions menu", () => {
    let target: HTMLElement;
    let mounted: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        // The menu flies in with a transition, which jsdom cannot animate: it plays at once here.
        Object.defineProperty(Element.prototype, "animate", {
            configurable: true,
            value: () => ({ cancel() {}, finish() {}, currentTime: 0, onfinish: null }),
        });
    });

    afterEach(async () => {
        const component = mounted;
        mounted = undefined;
        if (component) await unmount(component);
        target.remove();
        port.extension = undefined;
        Reflect.deleteProperty(Element.prototype, "animate");
    });

    function show(): void {
        mounted = mount(EmojiSubMenu, { target, props: { arrowAction: () => ({}) } });
        flushSync();
    }

    const favourite = (name: string) => target.querySelector<HTMLButtonElement>(`[id="button-${name}"]`);
    const rules = () => target.querySelectorAll(".h-\\[1px\\]");

    describe("with no extension registered", () => {
        it("is upstream's menu: the favourites as they are, one rule, the bubbles", () => {
            show();

            expect(favourite("thumbs up")?.hasAttribute("title")).toBe(false);
            expect(favourite("thumbs up")?.hasAttribute("aria-label")).toBe(false);
            expect(favourite("grinning face")?.hasAttribute("aria-label")).toBe(false);
            expect(target.querySelector('[data-testid="extension-section"]')).toBeNull();
            expect(rules()).toHaveLength(1);
            expect(target.querySelector('[data-testid="say-bubble-button"]')).not.toBeNull();
        });
    });

    describe("with an extension registered", () => {
        beforeEach(() => {
            port.extension = {
                section: ExtensionStub,
                describeReaction: (name: string, key: number) =>
                    name === "thumbs up" ? `Like · key ${key}` : undefined,
            };
        });

        it("holds the section of the extension between the favourites and the bubbles, set apart by a rule", () => {
            show();

            const section = target.querySelector('[data-testid="extension-section"]');
            const say = target.querySelector('[data-testid="say-bubble-button"]');
            expect(section).not.toBeNull();
            expect(favourite("thumbs up")?.compareDocumentPosition(section as Node)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(section?.compareDocumentPosition(say as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            expect(rules()).toHaveLength(2);
        });

        it("names the favourite the extension names, as its tooltip and its accessible name", () => {
            show();

            expect(favourite("thumbs up")?.getAttribute("title")).toBe("Like · key 1");
            expect(favourite("thumbs up")?.getAttribute("aria-label")).toBe("Like · key 1");
        });

        it("leaves a favourite the extension does not name as it is", () => {
            show();

            expect(favourite("grinning face")?.hasAttribute("title")).toBe(false);
            expect(favourite("grinning face")?.hasAttribute("aria-label")).toBe(false);
        });
    });
});
