// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import type { Conversation } from "../domain/conversation";
import type { Place } from "../domain/place";
import type { PresenceReading } from "../domain/presence";
import { stubWebAnimations, type WebAnimationsStub } from "../../../Utils/webAnimationsStub";
import { callChipStore } from "../stores/conversationStore";
import { placeStore } from "../stores/placeStore";
import { presenceStore } from "../stores/presenceStore";
import PlaceChip from "./PlaceChip.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../stores/placeStore", async () => {
    const { writable } = await import("svelte/store");
    return { placeStore: writable(undefined) };
});
vi.mock("../stores/presenceStore", async () => {
    const { writable } = await import("svelte/store");
    return { presenceStore: writable(undefined) };
});
vi.mock("../stores/conversationStore", async () => {
    const { writable } = await import("svelte/store");
    return { callChipStore: writable(undefined) };
});

const place = placeStore as unknown as Writable<Place | undefined>;
const presence = presenceStore as unknown as Writable<PresenceReading | undefined>;
const call = callChipStore as unknown as Writable<Conversation | undefined>;

describe("PlaceChip", () => {
    const target = document.createElement("div");
    let chip: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = chip;
        chip = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        place.set(undefined);
        presence.set(undefined);
        call.set(undefined);
    });

    function show() {
        document.body.append(target);
        chip = mount(PlaceChip, { target });
        flushSync();
    }

    function read(nearCount: number): PresenceReading {
        return { nearest: [], nearCount, place: undefined };
    }

    const status = () => target.querySelector('[role="status"]');

    it("shows nothing while the map names no place", () => {
        show();

        expect(target.textContent).toBe("");
    });

    it("names the area the player stands in, in a polite status", () => {
        place.set({ kind: "area", name: "Sala 01" });
        show();

        expect(status()?.getAttribute("aria-live")).toBe("polite");
        expect(status()?.getAttribute("aria-atomic")).toBe("true");
        expect(status()?.textContent).toContain("Sala 01");
    });

    it("tells a screen reader where the name leads, without showing it", () => {
        place.set({ kind: "area", name: "Sala 01" });
        show();

        expect(status()?.textContent).toBe("konclui.place.here Sala 01");
        expect(status()?.querySelector(".visually-hidden")?.textContent).toBe("konclui.place.here ");
    });

    it.each([
        [{ kind: "entrance" }, "konclui.place.entrance"],
        [{ kind: "hall" }, "konclui.place.hall"],
        [{ kind: "outside" }, "konclui.place.outside"],
    ] as const)("names %j through the locale", (kind, key) => {
        place.set(kind);
        show();

        expect(status()?.textContent).toContain(key);
    });

    it("keeps the near count out of the live region, so people walking by are not read out", () => {
        place.set({ kind: "area", name: "Sala 01" });
        presence.set(read(3));
        show();

        expect(target.textContent).toContain('konclui.nearby{"count":3}');
        expect(status()?.textContent).not.toContain("konclui.nearby");
    });

    it("shows no near count when nobody is near", () => {
        place.set({ kind: "hall" });
        presence.set(read(0));
        show();

        expect(target.textContent).not.toContain("konclui.nearby");
    });

    it("changes the text of the same status element when the place changes, which is what makes it announce", () => {
        place.set({ kind: "hall" });
        show();
        const before = status();

        place.set({ kind: "area", name: "Sala 02" });
        flushSync();

        expect(status()).toBe(before);
        expect(status()?.textContent).toContain("Sala 02");
    });

    it("steps aside while the user is in a conversation, which says where it is", () => {
        place.set({ kind: "area", name: "Sala 01" });
        call.set({ kind: "room", count: 2, placeName: "Sala 01" });
        show();

        expect(target.textContent).toBe("");

        call.set(undefined);
        flushSync();

        expect(status()?.textContent).toContain("Sala 01");
    });

    it("lets a click through to the map: it has nothing to press", () => {
        place.set({ kind: "hall" });
        show();

        expect(target.querySelector("button, a, input, [tabindex]")).toBeNull();
    });

    describe("its entrance and its exit", () => {
        let animations: WebAnimationsStub;

        beforeEach(() => {
            animations = stubWebAnimations();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
        });

        afterEach(() => {
            animations.restore();
            vi.unstubAllGlobals();
        });

        const element = () => target.querySelector<HTMLElement>(".place");
        const durations = () => animations.moving().map((animation) => animation.options.duration);

        it("stays in the page for the length of its exit when a conversation takes its place, and is then taken away", async () => {
            place.set({ kind: "area", name: "Sala 01" });
            show();
            await animations.settle();
            await animations.finishMoving();

            call.set({ kind: "bubble", count: 2 });
            flushSync();
            await animations.settle();

            expect(element()).not.toBeNull();
            expect(element()?.inert).toBe(true);
            expect(durations()).toEqual([200]);

            await animations.finishMoving();

            expect(element()).toBeNull();
        });

        it("goes in the same flush, with nothing to hold, for a viewer who reduces motion", async () => {
            place.set({ kind: "area", name: "Sala 01" });
            show();
            await animations.settle();
            await animations.finishMoving();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
            const before = animations.animations.length;

            call.set({ kind: "bubble", count: 2 });
            flushSync();

            expect(element()).toBeNull();
            expect(animations.animations.length).toBe(before);
        });
    });
});
