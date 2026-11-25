// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import type { Conversation } from "../domain/conversation";
import { stubWebAnimations, type WebAnimationsStub } from "../../../Utils/webAnimationsStub";
import { callChipStore } from "../stores/conversationStore";
import CallIndicator from "./CallIndicator.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../stores/conversationStore", async () => {
    const { writable } = await import("svelte/store");
    return { callChipStore: writable(undefined) };
});

const call = callChipStore as unknown as Writable<Conversation | undefined>;

describe("CallIndicator", () => {
    const target = document.createElement("div");
    let indicator: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = indicator;
        indicator = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        call.set(undefined);
    });

    function show() {
        document.body.append(target);
        indicator = mount(CallIndicator, { target });
        flushSync();
    }

    const region = () => {
        const element = target.querySelector('[role="status"]');
        if (!element) throw new Error("no status region");
        return element;
    };

    it("keeps a polite status region mounted and empty while nobody talks, so the first words are announced", () => {
        show();

        expect(region().getAttribute("aria-live")).toBe("polite");
        expect(region().getAttribute("aria-atomic")).toBe("true");
        expect(region().textContent).toBe("");
    });

    it("says the user is in a conversation with a bubble of people, and how to leave it", () => {
        call.set({ kind: "bubble", count: 2 });
        show();

        expect(region().textContent).toContain('konclui.call.conversation{"count":2}');
        expect(region().textContent).toContain("konclui.call.stepAway");
        expect(region().textContent).not.toContain("konclui.call.leaveRoom");
    });

    it("names the room of a meeting area, and says to leave the room to end it", () => {
        call.set({ kind: "room", count: 3, placeName: "Sala 01" });
        show();

        expect(region().textContent).toContain('konclui.call.conversationIn{"place":"Sala 01","count":3}');
        expect(region().textContent).toContain(" · konclui.call.leaveRoom");
    });

    it("leaves the name out of a room the map did not name", () => {
        call.set({ kind: "room", count: 3, placeName: "" });
        show();

        expect(region().textContent).toContain('konclui.call.conversation{"count":3}');
        expect(region().textContent).not.toContain("conversationIn");
    });

    it("fills the region that was already there when a conversation starts, and empties it when it ends", () => {
        show();
        const before = region();

        call.set({ kind: "bubble", count: 1 });
        flushSync();
        expect(region()).toBe(before);
        expect(region().textContent).toContain("konclui.call.conversation");

        call.set(undefined);
        flushSync();
        expect(region()).toBe(before);
        expect(region().textContent).toBe("");
    });

    it("hides its icon from assistive technology and has nothing to press, so a click goes through to the map", () => {
        call.set({ kind: "bubble", count: 1 });
        show();

        expect(region().querySelector(".icon")?.getAttribute("aria-hidden")).toBe("true");
        expect(region().querySelector("button, a, input, [tabindex]")).toBeNull();
    });
});

describe("CallIndicator motion", () => {
    const target = document.createElement("div");
    let indicator: ReturnType<typeof mount> | undefined;
    let animations: WebAnimationsStub;

    beforeEach(() => {
        animations = stubWebAnimations();
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    });

    afterEach(async () => {
        const mounted = indicator;
        indicator = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        call.set(undefined);
        animations.restore();
        vi.unstubAllGlobals();
    });

    function show() {
        document.body.append(target);
        indicator = mount(CallIndicator, { target });
        flushSync();
    }

    const chip = () => target.querySelector<HTMLElement>(".chip");
    const region = () => target.querySelector<HTMLElement>('[role="status"]');
    const durations = () => animations.moving().map((animation) => animation.options.duration);

    it("rises in on the surface transition when a conversation starts", async () => {
        show();

        call.set({ kind: "bubble", count: 2 });
        flushSync();
        await animations.settle();

        expect(chip()).not.toBeNull();
        expect(durations()).toEqual([290]);
    });

    it("stays in the page for the length of its exit, inert and with the sentence it had, and is then taken away", async () => {
        call.set({ kind: "bubble", count: 2 });
        show();
        await animations.settle();
        await animations.finishMoving();

        call.set(undefined);
        flushSync();
        await animations.settle();

        expect(chip()).not.toBeNull();
        expect(chip()?.inert).toBe(true);
        expect(chip()?.textContent).toContain('konclui.call.conversation{"count":2}');
        expect(durations()).toEqual([200]);
        // The region around it never leaves, so the next conversation is announced when it fills.
        expect(region()).not.toBeNull();

        await animations.finishMoving();

        expect(chip()).toBeNull();
        expect(region()).not.toBeNull();
    });

    it("leaves in the same flush, with nothing to hold, for a viewer who reduces motion", async () => {
        call.set({ kind: "bubble", count: 2 });
        show();
        await animations.settle();
        await animations.finishMoving();
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
        const before = animations.animations.length;

        call.set(undefined);
        flushSync();

        expect(chip()).toBeNull();
        expect(animations.animations.length).toBe(before);
    });

    it("has no keyframes of its own", () => {
        const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "CallIndicator.svelte"), "utf8");

        expect(source).not.toContain("@keyframes");
        expect(source).not.toMatch(/animation:/);
        expect(source).toMatch(
            /\{#if conversation !== undefined\}\s*<div\s[^>]*class="chip k-chrome"[^>]*\btransition:surface\b/,
        );
    });
});

// jsdom resolves neither calc() nor the cascade of a compiled Svelte style, so the geometry is checked on the source.
// The chip is centred in the dock stack, which has 8 px of padding on each side. The upstream map zoom column stands
// 8 px in from the right edge and is 56 px wide, so it reaches 64 px in; the chip must stop 8 px short of it.
describe("CallIndicator layout", () => {
    const zoomColumnReach = 8 + 56;
    const air = 8;
    const stackPadding = 2 * 8;
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "CallIndicator.svelte"), "utf8");

    function chipRule(): string {
        const match = /\.chip\s*\{([^}]*)\}/.exec(source);
        if (!match) throw new Error("the .chip rule is missing from CallIndicator.svelte");
        return match[1];
    }

    it("keeps the chip clear of the map zoom column on the narrowest phone", () => {
        const cap = /(?<![-\w])max-width:\s*calc\(\s*100%\s*-\s*(\d+)px\s*\)/.exec(chipRule());

        expect(cap, "the chip has no max-width of the form calc(100% - Npx)").not.toBeNull();
        const reserved = Number(cap?.[1]);
        // Right edge of the centred chip, on a 375 px screen: the zoom column begins at 375 - 64.
        const screen = 375;
        const chipWidth = screen - stackPadding - reserved;
        expect(screen / 2 + chipWidth / 2).toBeLessThanOrEqual(screen - zoomColumnReach - air);
    });

    it("wraps a place name without a space inside the cap instead of running past it", () => {
        expect(/\.text\s*\{[^}]*overflow-wrap:\s*anywhere/.test(source)).toBe(true);
    });
});
