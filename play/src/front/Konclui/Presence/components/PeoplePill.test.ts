// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import { peoplePillStore, type PeoplePill as PeoplePillState } from "../stores/peoplePillStore";
import PeoplePill from "./PeoplePill.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every key reads as its own path followed by its arguments, so a test finds a text by the key and the values it
    // was given. The words themselves are checked against the real locales in presenceTexts.test.ts.
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../stores/peoplePillStore", async () => {
    const { writable } = await import("svelte/store");
    return { peoplePillStore: writable({ summary: { kind: "unknown" }, nearest: [] }) };
});

const pillStore = peoplePillStore as unknown as Writable<PeoplePillState>;

describe("PeoplePill", () => {
    const target = document.createElement("div");
    let pill: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = pill;
        pill = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        pillStore.set({ summary: { kind: "unknown" }, nearest: [] });
    });

    function show(state: PeoplePillState, props: { expanded?: boolean; onclick?: () => void } = {}) {
        pillStore.set(state);
        document.body.append(target);
        pill = mount(PeoplePill, {
            target,
            props: { expanded: false, controls: "konclui-side-panel", onclick: vi.fn(), ...props },
        });
        flushSync();
    }

    const button = () => {
        const element = target.querySelector("button");
        if (!element) throw new Error("no pill");
        return element;
    };
    const lines = () => [...button().querySelectorAll(".text > *")].map((line) => line.textContent);

    it("says only People, with no number, before the world has synchronised", () => {
        show({ summary: { kind: "unknown" }, nearest: [] });

        expect(lines()).toEqual(["konclui.people"]);
        expect(button().textContent).not.toMatch(/\d/);
    });

    it("says the current user is alone", () => {
        show({ summary: { kind: "alone" }, nearest: [] });

        expect(lines()).toEqual(["konclui.pill.alone"]);
    });

    it("shows how many people are online and how many are near", () => {
        show({ summary: { kind: "others", online: 12, nearCount: 3 }, nearest: [] });

        expect(lines()).toEqual(['konclui.pill.online{"count":12}', 'konclui.nearby{"count":3}']);
    });

    it("says nobody is near when the scene has read and found no one", () => {
        show({ summary: { kind: "others", online: 12, nearCount: 0 }, nearest: [] });

        expect(lines()).toEqual(['konclui.pill.online{"count":12}', "konclui.pill.nobodyNearby"]);
    });

    it("shows no near line before the scene has read its surroundings", () => {
        show({ summary: { kind: "others", online: 12, nearCount: undefined }, nearest: [] });

        expect(lines()).toEqual(['konclui.pill.online{"count":12}']);
    });

    it("stacks the nearest people as initials, and keeps the stack from assistive technology", () => {
        show({
            summary: { kind: "others", online: 5, nearCount: 4 },
            nearest: [
                { id: 1, name: "Ana Ribeiro" },
                { id: 2, name: "Erick" },
                { id: 3, name: "maria da silva" },
            ],
        });

        const stack = button().querySelector(".stack");
        expect(stack?.getAttribute("aria-hidden")).toBe("true");
        expect([...(stack?.children ?? [])].map((avatar) => avatar.textContent)).toEqual(["AR", "E", "MD"]);
        expect([...(stack?.children ?? [])].map((avatar) => avatar.getAttribute("data-tone"))).toEqual(["5", "3", "1"]);
    });

    it("draws no stack when nobody is near", () => {
        show({ summary: { kind: "others", online: 5, nearCount: 0 }, nearest: [] });

        expect(button().querySelector(".stack")).toBeNull();
    });

    it("is a button named by its text, that says whether the panel it controls is open", () => {
        show({ summary: { kind: "others", online: 5, nearCount: 1 }, nearest: [] }, { expanded: true });

        expect(button().type).toBe("button");
        expect(button().getAttribute("aria-expanded")).toBe("true");
        expect(button().getAttribute("aria-controls")).toBe("konclui-side-panel");
        expect(button().hasAttribute("aria-label")).toBe(false);
        expect(button().textContent).toContain('konclui.pill.online{"count":5}');
    });

    it("reports a closed panel", () => {
        show({ summary: { kind: "alone" }, nearest: [] }, { expanded: false });

        expect(button().getAttribute("aria-expanded")).toBe("false");
    });

    it("asks to open the panel when pressed", () => {
        const onclick = vi.fn();
        show({ summary: { kind: "alone" }, nearest: [] }, { onclick });

        button().click();

        expect(onclick).toHaveBeenCalledTimes(1);
    });

    it("hands its button to the frame, which gives it the focus back when the panel closes", () => {
        let bound: HTMLButtonElement | undefined;
        pillStore.set({ summary: { kind: "alone" }, nearest: [] });
        document.body.append(target);
        pill = mount(PeoplePill, {
            target,
            props: {
                expanded: false,
                controls: "konclui-side-panel",
                onclick: vi.fn(),
                // What `bind:button` compiles to.
                get button() {
                    return bound;
                },
                set button(element: HTMLButtonElement | undefined) {
                    bound = element;
                },
            },
        });
        flushSync();

        expect(bound).toBe(button());
    });

    it("follows the headcount as it changes", () => {
        show({ summary: { kind: "others", online: 5, nearCount: 1 }, nearest: [] });

        pillStore.set({ summary: { kind: "others", online: 6, nearCount: 1 }, nearest: [] });
        flushSync();

        expect(lines()[0]).toBe('konclui.pill.online{"count":6}');
    });
});
