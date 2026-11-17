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
