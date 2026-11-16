// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsClient } from "../../../src/front/Administration/AnalyticsClient";
import type { CoWebsite } from "../../../src/front/WebRtc/CoWebsite/CoWebsite";
import {
    canvasSize,
    coWebsiteRatio,
    coWebsites,
    coWebsitesSize,
    createCoWebsiteStore,
    fullScreenCowebsite,
} from "../../../src/front/Stores/CoWebsiteStore";

const makeSender = () => vi.fn();

function fakeCoWebsite(id: string, url = `https://${id}.example`): CoWebsite {
    return {
        getId: () => id,
        getUrl: () => new URL(url),
        getWidthPercent: () => undefined,
    } as unknown as CoWebsite;
}

function framesFrom(sendAdmin: ReturnType<typeof makeSender>) {
    const events = sendAdmin.mock.calls.flatMap(([message]) => message.events);
    return {
        opens: events.filter((event: { eventName: string }) => event.eventName === "timed_event.open"),
        closes: events.filter((event: { eventName: string }) => event.eventName === "timed_event.close"),
    };
}

/**
 * The interval that measures a cowebsite visit lives here now, next to the thing it
 * measures. These used to be written against the analytics client's own map of ids,
 * which meant they proved that map worked — not that opening and closing a cowebsite
 * produced one interval. They go through the store's real API now: add, remove,
 * keepOnly, empty.
 */
describe("CoWebsiteStore analytics intervals", () => {
    let sendAdmin: ReturnType<typeof makeSender>;

    beforeEach(() => {
        sendAdmin = makeSender();
        analyticsClient.setAdminAnalyticsSender(sendAdmin);
        window.capabilities = { "api/analytics/events-batch": "v1" };
    });

    afterEach(() => {
        analyticsClient.setAdminAnalyticsSender(undefined);
        window.capabilities = {};
        delete window.posthog;
        vi.restoreAllMocks();
    });

    it("opens one interval per cowebsite, carrying the context the caller gave", () => {
        const store = createCoWebsiteStore();

        store.add(fakeCoWebsite("cowebsite-1", "https://example.com/secured/file.pdf?token=secret#frag"), undefined, {
            targetUrl: "https://example.com/files/file.pdf?sas=otherSecret",
            triggerProperty: "openLink",
            areaId: "docs-zone",
            areaName: "Docs zone",
        });

        const { opens } = framesFrom(sendAdmin);
        expect(opens).toHaveLength(1);
        expect(opens[0].properties).toEqual(
            expect.objectContaining({
                eventName: "cowebsite.closed",
                properties: {
                    url: "https://example.com",
                    targetUrl: "https://example.com",
                    mediaKind: "pdf",
                    triggerProperty: "openLink",
                    fileName: "file.pdf",
                    fileExtension: "pdf",
                    areaId: "docs-zone",
                    areaName: "Docs zone",
                    schemaVersion: 1,
                },
            }),
        );
    });

    it("measures each cowebsite separately, so closing one leaves the others open", () => {
        const store = createCoWebsiteStore();
        const first = fakeCoWebsite("cowebsite-1");
        const second = fakeCoWebsite("cowebsite-2");

        store.add(first);
        store.add(second);
        store.remove(first);

        const { opens, closes } = framesFrom(sendAdmin);
        expect(opens).toHaveLength(2);
        expect(closes).toHaveLength(1);
        expect(closes[0].properties.handle).toBe(opens[0].properties.handle);
    });

    it("closes the visits that keepOnly drops, which is the case no caller could report", () => {
        // keepOnly takes a predicate: it does not know what it removed, and neither did
        // the code that used to have to tell the analytics client. Sixteen call sites
        // remove a cowebsite and exactly one used to report a close.
        const store = createCoWebsiteStore();
        store.add(fakeCoWebsite("keep-me"));
        store.add(fakeCoWebsite("drop-me"));

        store.keepOnly((coWebsite) => coWebsite.getId() === "keep-me");

        const { opens, closes } = framesFrom(sendAdmin);
        expect(closes).toHaveLength(1);
        expect(closes[0].properties.handle).toBe(opens[1].properties.handle);
    });

    it("closes every visit when the store is emptied", () => {
        const store = createCoWebsiteStore();
        store.add(fakeCoWebsite("cowebsite-1"));
        store.add(fakeCoWebsite("cowebsite-2"));

        store.empty();

        expect(framesFrom(sendAdmin).closes).toHaveLength(2);
    });

    it("ends the previous visit when the same id is opened twice", () => {
        // The close never arrived — end that visit here rather than stranding it until
        // the socket dies, which would date it to the end of the session.
        const store = createCoWebsiteStore();
        store.add(fakeCoWebsite("cowebsite-1"));
        store.add(fakeCoWebsite("cowebsite-1"));

        const { opens, closes } = framesFrom(sendAdmin);
        expect(opens).toHaveLength(2);
        expect(closes).toHaveLength(1);
        expect(closes[0].properties.handle).toBe(opens[0].properties.handle);
    });

    it("still opens the cowebsite when the admin sink is off", () => {
        // The store must not learn what a capability is: it gets a handle either way,
        // and the one it gets here simply measures nothing.
        window.capabilities = {};
        const store = createCoWebsiteStore();

        store.add(fakeCoWebsite("cowebsite-1"));
        store.empty();

        expect(sendAdmin).not.toHaveBeenCalled();
        expect(store.findById("cowebsite-1")).toBeUndefined();
    });
});

/**
 * The sizes the game canvas and the co-website panel take, observed through the exported stores. The
 * geometry itself is covered in CoWebsiteLayout.test.ts; these cases pin how the store feeds it: which
 * window it measures, when the window counts as portrait, and what fullscreen does to each size.
 */
describe("CoWebsiteStore viewport sizes", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    let unsubscribe: Array<() => void> = [];

    function observe<T>(store: { subscribe: (run: (value: T) => void) => () => void }): () => T {
        let latest: T | undefined;
        unsubscribe.push(
            store.subscribe((value) => {
                latest = value;
            }),
        );
        return () => latest as T;
    }

    function setWindowSize(width: number, height: number, notify: boolean) {
        Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
        Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
        if (notify) {
            window.dispatchEvent(new Event("resize"));
        }
    }

    beforeEach(() => {
        window.capabilities = {};
    });

    afterEach(() => {
        unsubscribe.forEach((stop) => stop());
        unsubscribe = [];
        coWebsites.removeAll();
        fullScreenCowebsite.set(false);
        coWebsiteRatio.set(0.5);
        setWindowSize(originalWidth, originalHeight, false);
    });

    it("gives the game the live window and the panel nothing when no cowebsite is open", () => {
        const canvas = observe(canvasSize);
        const panel = observe(coWebsitesSize);

        // No resize event: windowSize still holds the size it had when it was created.
        setWindowSize(640, 480, false);
        coWebsiteRatio.set(0.3);

        expect(canvas()).toEqual({ width: 640, height: 480 });
        expect(panel()).toEqual({ width: 0, height: 0 });
    });

    it("splits the window width in a landscape window", () => {
        const canvas = observe(canvasSize);
        const panel = observe(coWebsitesSize);
        setWindowSize(1000, 800, true);

        coWebsites.add(fakeCoWebsite("cowebsite-1"));
        coWebsiteRatio.set(0.25);

        expect(canvas()).toEqual({ width: 750, height: 800 });
        expect(panel()).toEqual({ width: 250, height: 800 });
    });

    it("splits the window height in a portrait window, and a square window is portrait", () => {
        const canvas = observe(canvasSize);
        const panel = observe(coWebsitesSize);
        coWebsites.add(fakeCoWebsite("cowebsite-1"));

        setWindowSize(600, 900, true);
        expect(canvas()).toEqual({ width: 600, height: 450 });
        expect(panel()).toEqual({ width: 600, height: 450 });

        setWindowSize(800, 800, true);
        expect(canvas()).toEqual({ width: 800, height: 400 });
        expect(panel()).toEqual({ width: 800, height: 400 });
    });

    it("hides the game in fullscreen and leaves the panel size alone", () => {
        const canvas = observe(canvasSize);
        const panel = observe(coWebsitesSize);
        setWindowSize(1000, 800, true);
        coWebsites.add(fakeCoWebsite("cowebsite-1"));
        const panelBefore = panel();

        fullScreenCowebsite.set(true);

        expect(canvas()).toEqual({ width: 0, height: 0 });
        expect(panel()).toEqual(panelBefore);
        expect(panel()).toEqual({ width: 500, height: 800 });
    });
});
