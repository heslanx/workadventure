import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEffectsData } from "./effectsLoader";

const MAP_URL = "http://localhost:8090/~/konclui-office/office.wam";
const FX_FOLDER = "http://localhost:8090/~/konclui-office/fx/";

function serve(response: Response): ReturnType<typeof vi.fn> {
    const fetch = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("loading a map folder's effects", () => {
    it("asks for the manifest beside the map file, past the browser's cache", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetch = serve(new Response(null, { status: 404 }));

        await loadEffectsData(MAP_URL);

        expect(fetch).toHaveBeenCalledWith(`${FX_FOLDER}manifest.json`, { cache: "no-cache" });
    });

    it("finds a room without effects when the manifest is a 404, and says nothing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        serve(new Response(null, { status: 404 }));

        await expect(loadEffectsData(MAP_URL)).resolves.toBeUndefined();

        expect(warn).not.toHaveBeenCalled();
    });

    it.each([500, 403, 401])("warns with the status and the folder when the manifest answers %i", async (status) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        serve(new Response(null, { status }));

        await expect(loadEffectsData(MAP_URL)).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith("[konclui] fx not loaded:", status, FX_FOLDER);
    });

    it("warns when the manifest is not one", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        serve(new Response("{}", { status: 200 }));

        await expect(loadEffectsData(MAP_URL)).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalledWith("[konclui] fx not loaded:", expect.any(Error));
    });
});

// The optional normal map (fx/normal.png, written only by a build with KONCLUI_FX_NORMALS=1 that also says `normal: true`
// in the manifest): asked for only when the manifest says it is there and the caller wants it, so a room without it, or
// with the preview off, makes no request that could fail in the console.
describe("loading a map folder's optional normal map", () => {
    const MAP = [2752, 1792] as const;

    /** A manifest of a room with fx/, with or without the normal map. */
    const manifestOf = (extra: object): string =>
        JSON.stringify({
            map: MAP,
            water: { rect: [0, 0, 1, 1], glint: [[0, 0, 0]], waterline: [0, 0, 0] },
            lights: {},
            rooms: [],
            ink: [0, 0, 0],
            ...extra,
        });

    /**
     * Serves the manifest and stands in for `Image`: every picture "loads" at the size given by its name (the normal map's
     * by `normalSize`), or fails when it is in `missing`. The urls asked of the network and the pictures are recorded.
     */
    function serveRoom(
        manifestText: string,
        options: { normalSize?: readonly [number, number]; missing?: string[] } = {},
    ) {
        const fetch = vi.fn(() => Promise.resolve(new Response(manifestText, { status: 200 })));
        const pictures: string[] = [];
        class FakeImage {
            width = 0;
            height = 0;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(url: string) {
                pictures.push(url);
                const [w, h] = url.endsWith("/normal.png") ? (options.normalSize ?? MAP) : [8, 8];
                this.width = w;
                this.height = h;
                const fails = (options.missing ?? []).some((name) => url.endsWith(name));
                queueMicrotask(() => (fails ? this.onerror?.() : this.onload?.()));
            }
        }
        vi.stubGlobal("fetch", fetch);
        vi.stubGlobal("Image", FakeImage);
        return { pictures, fetch };
    }

    it("asks for no normal map of a room whose manifest does not list one, even when the preview wants it", async () => {
        const { pictures } = serveRoom(manifestOf({}));

        const data = await loadEffectsData(MAP_URL, { normal: true });

        expect(data?.normal).toBeUndefined();
        expect(pictures.filter((url) => url.endsWith("normal.png"))).toEqual([]);
        expect(pictures).toHaveLength(6); // the six effect pictures, as before
    });

    it("asks for no normal map when the manifest lists one and the caller did not ask for it", async () => {
        const { pictures } = serveRoom(manifestOf({ normal: true }));

        const data = await loadEffectsData(MAP_URL);

        expect(data?.normal).toBeUndefined();
        expect(pictures.filter((url) => url.endsWith("normal.png"))).toEqual([]);
    });

    it("loads the normal map beside the manifest when both say so", async () => {
        const { pictures } = serveRoom(manifestOf({ normal: true }));

        const data = await loadEffectsData(MAP_URL, { normal: true });

        expect(pictures).toContain(`${FX_FOLDER}normal.png`);
        expect(data?.normal?.width).toBe(MAP[0]);
        expect(Object.keys(data?.images ?? {}).sort()).toEqual(
            ["glass", "masks", "occluders", "tv-slide", "water", "water-data"].sort(),
        );
    });

    it("keeps the flat look, and says so, when the listed normal map is not the map's size", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        serveRoom(manifestOf({ normal: true }), { normalSize: [1376, 896] });

        const data = await loadEffectsData(MAP_URL, { normal: true });

        expect(data?.manifest).toBeDefined();
        expect(data?.normal).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("normal.png is 1376x896");
    });

    it("keeps the room's effects, with flat normals, when the listed normal map fails to load", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        serveRoom(manifestOf({ normal: true }), { missing: ["/normal.png"] });

        const data = await loadEffectsData(MAP_URL, { normal: true });

        expect(data?.manifest).toBeDefined();
        expect(data?.normal).toBeUndefined();
        expect(warn).toHaveBeenCalledWith("[konclui] fx normal.png not loaded; flat normals:", expect.any(Error));
    });
});
