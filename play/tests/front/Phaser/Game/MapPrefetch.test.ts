// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    MAP_PREFETCH_ENABLED,
    MAP_PREFETCH_MAX_AGE_MS,
    MapPrefetch,
    isMapPrefetchEnabled,
    resetMapPrefetchStorageWarningForTests,
} from "../../../../src/front/Phaser/Game/MapPrefetch";

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

const WAM_URL = "https://maps.test/~/office/office.wam";
const TMJ_URL = "https://maps.test/~/office/map-abc.tmj";

/** A map server: every request is kept so the test decides when and how each one ends. */
function harness(options: { enabled?: boolean } = {}) {
    const requests: { url: string; resolve: (data: unknown) => void; reject: (error: Error) => void }[] = [];
    let now = 1000;
    const prefetch = new MapPrefetch({
        fetchFile: (url) =>
            new Promise((resolve, reject) => {
                requests.push({ url, resolve, reject });
            }),
        mapUrlOfWam: (wamData) => (wamData as { mapUrl?: string }).mapUrl,
        now: () => now,
        enabled: () => options.enabled ?? true,
        baseUrl: () => "https://play.test/_/global/maps.test/office.wam",
    });
    const urls = () => requests.map((request) => request.url);
    return {
        prefetch,
        requests,
        urls,
        advance: (ms: number) => {
            now += ms;
        },
    };
}

const normally = (data: unknown) => vi.fn(() => Promise.resolve(data));

describe("the map prefetch flag", () => {
    it('is off only when the storage of the browser says "0"', () => {
        expect(isMapPrefetchEnabled()).toBe(MAP_PREFETCH_ENABLED);
        localStorage.setItem("mapPrefetch", "0");
        expect(isMapPrefetchEnabled()).toBe(false);
        localStorage.setItem("mapPrefetch", "1");
        expect(isMapPrefetchEnabled()).toBe(true);
    });

    it("ships on, as an upstream mechanism that falls back on the normal request", () => {
        expect(MAP_PREFETCH_ENABLED).toBe(true);
    });

    it("keeps the default, without throwing, when the storage cannot be read, and says so once", () => {
        resetMapPrefetchStorageWarningForTests();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const blocked = {
            getItem: () => {
                throw new Error("blocked");
            },
        };

        expect([isMapPrefetchEnabled(blocked), isMapPrefetchEnabled(blocked)]).toEqual([
            MAP_PREFETCH_ENABLED,
            MAP_PREFETCH_ENABLED,
        ]);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("the map prefetch", () => {
    it("asks for the WAM at once, and for the TMJ it points at as soon as the WAM arrives", async () => {
        const { prefetch, requests, urls } = harness();

        prefetch.start({ wamUrl: WAM_URL });
        expect(urls()).toEqual([WAM_URL]);

        requests[0].resolve({ mapUrl: TMJ_URL });
        await Promise.resolve();

        expect(urls()).toEqual([WAM_URL, TMJ_URL]);
    });

    it("hands the scene the WAM that is in flight, without a second request, and the TMJ once the scene claims it", async () => {
        const { prefetch, requests, urls } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        const fetchWam = normally("normal");

        const wam = prefetch.takeWam(WAM_URL, fetchWam);
        requests[0].resolve({ mapUrl: TMJ_URL });
        // What the scene does with the WAM: it asks for the TMJ it names.
        let tmj: Promise<unknown> | undefined;
        await wam.then(() => {
            tmj = prefetch.takeTmj(TMJ_URL);
        });
        requests[1].resolve({ layers: [] });

        await expect(wam).resolves.toEqual({ mapUrl: TMJ_URL });
        expect(tmj).toBeDefined();
        await expect(tmj).resolves.toEqual({ layers: [] });
        expect(fetchWam).not.toHaveBeenCalled();
        expect(urls()).toEqual([WAM_URL, TMJ_URL]);
    });

    it("prefetches the TMJ of a plain map straight away", () => {
        const { prefetch, urls } = harness();

        prefetch.start({ mapUrl: TMJ_URL });

        expect(urls()).toEqual([TMJ_URL]);
    });

    it("resolves a relative map URL against the page, as the scene does", () => {
        const { prefetch, urls } = harness();

        prefetch.start({ wamUrl: "/office.wam" });

        expect(urls()).toEqual(["https://play.test/office.wam"]);
    });

    it("does not download a file twice when the room is asked for twice", () => {
        const { prefetch, urls } = harness();

        prefetch.start({ wamUrl: WAM_URL });
        prefetch.start({ wamUrl: WAM_URL });

        expect(urls()).toEqual([WAM_URL]);
    });

    it("hands a prefetch over once: a scene created again fetches the map as it is then", async () => {
        const { prefetch, requests } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        requests[0].resolve({ mapUrl: TMJ_URL });
        await prefetch.takeWam(WAM_URL, normally("unused"));
        const again = normally("the WAM now");

        const second = await prefetch.takeWam(WAM_URL, again);

        expect(second).toBe("the WAM now");
        expect(again).toHaveBeenCalledTimes(1);
    });

    it("falls back on the normal request when the prefetch failed", async () => {
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { prefetch, requests } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        const fetchWam = normally("from the normal request");

        const wam = prefetch.takeWam(WAM_URL, fetchWam);
        requests[0].reject(new Error("503"));

        await expect(wam).resolves.toBe("from the normal request");
        expect(fetchWam).toHaveBeenCalledTimes(1);
    });

    it("falls back on the normal request for a WAM whose body is not a JSON object", async () => {
        // Axios hands back a body it cannot parse as a string: the scene's migration would throw on it.
        const { prefetch, requests } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        const fetchWam = normally({ mapUrl: TMJ_URL });

        const wam = prefetch.takeWam(WAM_URL, fetchWam);
        requests[0].resolve("<html>an error page with a 200</html>");

        await expect(wam).resolves.toEqual({ mapUrl: TMJ_URL });
        expect(fetchWam).toHaveBeenCalledTimes(1);
    });

    it("resolves a TMJ whose prefetch failed with undefined, never rejects: the scene loads it with Phaser", async () => {
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        const { prefetch, requests } = harness();
        prefetch.start({ mapUrl: TMJ_URL });

        const tmj = prefetch.takeTmj(TMJ_URL);
        requests[0].reject(new Error("CORS or 503"));

        await expect(tmj).resolves.toBeUndefined();
    });

    it.each([
        ["a string", "<html></html>"],
        ["null", null],
        ["an array", []],
    ])("resolves a TMJ whose body is %s with undefined, so it never reaches the Phaser cache", async (_name, body) => {
        const { prefetch, requests } = harness();
        prefetch.start({ mapUrl: TMJ_URL });

        const tmj = prefetch.takeTmj(TMJ_URL);
        requests[0].resolve(body);

        await expect(tmj).resolves.toBeUndefined();
    });

    it("does not leave a failed prefetch that nobody claimed as an unhandled rejection", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        const { prefetch, requests } = harness();
        prefetch.start({ wamUrl: WAM_URL });

        requests[0].reject(new Error("503"));
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
        });
        process.off("unhandledRejection", unhandled);

        expect(unhandled).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalled();
    });

    it("does not serve a prefetch older than its limit: the map editor may have changed the WAM since", async () => {
        const { prefetch, requests, advance } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        requests[0].resolve({ mapUrl: TMJ_URL });
        await Promise.resolve();
        advance(MAP_PREFETCH_MAX_AGE_MS + 1);
        const fetchWam = normally("fresh WAM");

        const wam = await prefetch.takeWam(WAM_URL, fetchWam);
        const tmj = prefetch.takeTmj(TMJ_URL);

        expect(wam).toBe("fresh WAM");
        expect(fetchWam).toHaveBeenCalledTimes(1);
        expect(tmj).toBeUndefined();
    });

    it("serves a prefetch that is as old as the limit", async () => {
        const { prefetch, requests, advance } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        requests[0].resolve({ mapUrl: TMJ_URL });
        advance(MAP_PREFETCH_MAX_AGE_MS);
        const fetchWam = normally("unused");

        await prefetch.takeWam(WAM_URL, fetchWam);

        expect(fetchWam).not.toHaveBeenCalled();
    });

    it("asks again for a file whose earlier prefetch went stale, instead of keeping the old one", () => {
        const { prefetch, urls, advance } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        advance(MAP_PREFETCH_MAX_AGE_MS + 1);

        prefetch.start({ wamUrl: WAM_URL });

        expect(urls()).toEqual([WAM_URL, WAM_URL]);
    });

    it("leaves a file it did not prefetch to the caller", () => {
        const { prefetch } = harness();
        prefetch.start({ wamUrl: WAM_URL });

        expect(prefetch.takeTmj("https://maps.test/other.tmj")).toBeUndefined();
    });

    it("starts nothing and claims nothing when it is off, and the scene fetches as it always did", async () => {
        const { prefetch, urls } = harness({ enabled: false });
        const fetchWam = normally("normal");

        prefetch.start({ wamUrl: WAM_URL, mapUrl: undefined });

        expect(urls()).toEqual([]);
        await expect(prefetch.takeWam(WAM_URL, fetchWam)).resolves.toBe("normal");
        expect(prefetch.takeTmj(TMJ_URL)).toBeUndefined();
    });

    it("does not prefetch a TMJ when the WAM does not name one, nor when it cannot be read", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { prefetch, requests, urls } = harness();
        prefetch.start({ wamUrl: WAM_URL });
        requests[0].resolve({});
        await Promise.resolve();

        expect(urls()).toEqual([WAM_URL]);

        const unreadable = new MapPrefetch({
            fetchFile: () => Promise.resolve({}),
            mapUrlOfWam: () => {
                throw new Error("invalid WAM");
            },
            now: () => 0,
            enabled: () => true,
            baseUrl: () => "https://play.test/",
        });
        unreadable.start({ wamUrl: WAM_URL });
        await Promise.resolve();
        await Promise.resolve();

        expect(warn).toHaveBeenCalledTimes(1);
        await expect(unreadable.takeWam(WAM_URL, normally("unused"))).resolves.toEqual({});
    });
});
