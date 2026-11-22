// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import EmojiSubMenu from "../../../../src/front/Components/ActionBar/EmojiSubMenu.svelte";
import EmoteSection from "../../../../src/front/Konclui/Reactions/components/EmoteSection.svelte";

// The dock sizes its own controls (36 px squares). The menus its controls open are drawn inside .dock-controls too,
// and they size their own buttons: a dock rule that reached them squared the "Falar" and "Pensar" buttons and shrank
// the emotes. jsdom applies no stylesheet, so the selectors of the dock's rules are read from the component and
// matched against the DOM the dock and the reactions menu draw.

vi.mock("../../../../src/front/ExternalModule/ReactionsMenuPort", async () => {
    const { readable } = await import("svelte/store");
    const { default: section } = await import("../../../../src/front/Konclui/Reactions/components/EmoteSection.svelte");
    return { reactionsMenuExtension: readable({ section, describeReaction: () => undefined }) };
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
        emoteDataStore: writable(new Map([[1, { emoji: "👍", name: "thumbs up" }]])),
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
vi.mock("../../../../src/front/Konclui/Reactions/stores/emoteSender", () => ({ sendCustomEmote: vi.fn() }));
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
vi.mock("@wa-icons", () => ({ IconPencil: () => undefined, IconXIcon: () => undefined }));

const dock = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../src/front/Konclui/Shell/components/Dock.svelte"),
    "utf8",
);
const styles = dock.slice(dock.indexOf("<style>") + "<style>".length);

interface Rule {
    selectors: string[];
    declarations: string;
}

/** The style rules of the dock, with Svelte's `:global(...)` taken off the selectors so the DOM can match them. */
function dockRules(): Rule[] {
    const rules: Rule[] = [];
    for (const [, head = "", body = ""] of styles.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const plain = head.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, "$1");
        rules.push({ selectors: plain.split(",").map((selector) => selector.trim()), declarations: body });
    }
    return rules;
}

/** The rules of the dock that size or restyle a button, by what they set. */
const buttonRules = (): Rule[] =>
    dockRules().filter(
        (rule) =>
            /\b(width|height|min-width|padding)\s*:/.test(rule.declarations) &&
            rule.selectors.some((selector) => /\bbutton\b/.test(selector)),
    );

function matchedBy(element: Element, rules: Rule[]): string[] {
    return rules.flatMap((rule) =>
        rule.selectors.filter((selector) => {
            // The rule that is about a pseudo-element (the finger's area) is about its button.
            const plain = selector.replace(/::(?:before|after)$/, "").replace(/:hover$/, "");
            return element.matches(plain);
        }),
    );
}

describe("the dock's rules for its buttons", () => {
    let target: HTMLElement;
    let mounted: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        target.innerHTML = `
            <div class="dock-controls">
                <div class="dock-devices">
                    <div class="relative pointer-events-auto"><button data-testid="microphone-button"><svg></svg></button></div>
                    <button class="media-settings" data-testid="media-settings-toggle-button"></button>
                </div>
                <div class="relative pointer-events-auto" id="wrapper"><button data-testid="emoji-btn" class="bg-danger"><svg></svg></button></div>
                <div class="relative pointer-events-auto"><button data-testid="chat-btn"><svg></svg></button></div>
                <div class="absolute" id="menu"></div>
            </div>`;
        document.body.append(target);
        Object.defineProperty(Element.prototype, "animate", {
            configurable: true,
            value: () => ({ cancel() {}, finish() {}, currentTime: 0, onfinish: null }),
        });
        const menu = target.querySelector("#menu");
        if (menu === null) throw new Error("The test page has no menu");
        mounted = mount(EmojiSubMenu, { target: menu, props: { arrowAction: () => ({}) } });
        flushSync();
    });

    afterEach(async () => {
        const component = mounted;
        mounted = undefined;
        if (component) await unmount(component);
        target.remove();
        Reflect.deleteProperty(Element.prototype, "animate");
    });

    it("finds the rules it is about", () => {
        const rules = buttonRules();

        expect(rules.length).toBeGreaterThanOrEqual(2);
        expect(rules.flatMap((rule) => rule.selectors)).toContain(".media-settings");
    });

    it.each(["microphone-button", "emoji-btn", "chat-btn"])("sizes the dock's own button %s", (testId) => {
        const button = target.querySelector(`.dock-controls [data-testid="${testId}"]`);

        expect(button).not.toBeNull();
        expect(matchedBy(button as Element, buttonRules())).not.toHaveLength(0);
    });

    it("sizes the icon of its own buttons and restyles its own off buttons", () => {
        const icon = target.querySelector('[data-testid="chat-btn"] > svg');
        const off = target.querySelector('[data-testid="emoji-btn"].bg-danger');
        const everyRule = dockRules();

        expect(matchedBy(icon as Element, everyRule).length).toBeGreaterThan(0);
        expect(matchedBy(off as Element, everyRule).length).toBeGreaterThan(0);
    });

    it("leaves the buttons of the reactions menu to their own sizes: the bubbles, the emotes and the favourites", () => {
        const buttons = [...target.querySelectorAll("#menu button")];
        const testIds = buttons.map((button) => button.getAttribute("data-testid"));

        // The bubbles, the emotes and the favourites are all in the menu this test mounted.
        expect(testIds).toContain("say-bubble-button");
        expect(testIds).toContain("think-bubble-button");
        expect(testIds.some((testId) => testId?.startsWith("konclui-emote-"))).toBe(true);
        expect(target.querySelector('#menu [id="button-thumbs up"]')).not.toBeNull();
        for (const button of buttons) {
            expect(matchedBy(button, buttonRules()), button.outerHTML.slice(0, 80)).toEqual([]);
        }
    });

    it("leaves the icons and the off fill of a menu's buttons alone as well", () => {
        const icons = [...target.querySelectorAll("#menu button > svg")];
        const rules = dockRules().filter((rule) =>
            rule.selectors.some((selector) => /\bsvg\b|bg-danger/.test(selector)),
        );

        expect(rules.length).toBeGreaterThan(0);
        for (const element of [...target.querySelectorAll("#menu button"), ...icons]) {
            expect(matchedBy(element, rules)).toEqual([]);
        }
    });

    // The rule that squared the buttons is now `.dock-controls > div > button[data-testid]`. A selector for a menu that
    // would be wider again (a plain descendant) is the regression this test names.
    it("has no rule that reaches a button through a descendant of the controls", () => {
        const reachesAny = buttonRules()
            .flatMap((rule) => rule.selectors)
            .filter((selector) => /^\.dock-(controls|devices)\s+(?!>)\S*button/.test(selector));

        expect(reachesAny).toEqual([]);
    });

    it("renders EmoteSection in the menu, so the emotes were among the buttons checked", () => {
        expect(EmoteSection).toBeDefined();
        expect(target.querySelectorAll('#menu [data-testid^="konclui-emote-"]').length).toBeGreaterThan(0);
    });
});
