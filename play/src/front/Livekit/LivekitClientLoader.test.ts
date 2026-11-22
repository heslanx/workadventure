import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createLivekitClientLoader,
    LivekitClientLoadError,
    loadLivekitClient,
    livekitClient,
    type LivekitClientModule,
} from "./LivekitClientLoader";

const fakeModule = { Room: class FakeRoom {} } as unknown as LivekitClientModule;

describe("livekit-client loader", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fetches the library once for every caller that asks while it loads, and once more for none after", async () => {
        const importModule = vi.fn(() => Promise.resolve(fakeModule));
        const loader = createLivekitClientLoader(importModule);

        const [first, second] = await Promise.all([loader.load(), loader.load()]);
        const third = await loader.load();

        expect(first).toBe(fakeModule);
        expect(second).toBe(fakeModule);
        expect(third).toBe(fakeModule);
        expect(importModule).toHaveBeenCalledOnce();
    });

    it("rejects with a load error that keeps the cause, then fetches again on the next load instead of replaying the failure", async () => {
        const networkError = new TypeError("Failed to fetch dynamically imported module");
        const importModule = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValue(fakeModule);
        const loader = createLivekitClientLoader(importModule);

        const failure = await loader.load().catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(LivekitClientLoadError);
        expect((failure as LivekitClientLoadError).cause).toBe(networkError);
        expect(loader.isLoaded()).toBe(false);
        await expect(loader.load()).resolves.toBe(fakeModule);
        expect(importModule).toHaveBeenCalledTimes(2);
    });

    it("hands the same failure to every caller waiting on one fetch", async () => {
        const importModule = vi.fn().mockRejectedValue(new Error("offline"));
        const loader = createLivekitClientLoader(importModule);

        const results = await Promise.allSettled([loader.load(), loader.load()]);

        expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
        expect(importModule).toHaveBeenCalledOnce();
    });

    it("refuses to hand out the module before it is loaded, and hands it out after", async () => {
        const loader = createLivekitClientLoader(() => Promise.resolve(fakeModule));

        expect(() => loader.get()).toThrow("not loaded yet");
        await loader.load();

        expect(loader.get()).toBe(fakeModule);
        expect(loader.isLoaded()).toBe(true);
    });

    describe("preload", () => {
        it("starts the fetch without waiting for it, and only once", async () => {
            const importModule = vi.fn(() => Promise.resolve(fakeModule));
            const loader = createLivekitClientLoader(importModule);

            loader.preload();
            loader.preload();
            await loader.load();
            loader.preload();

            expect(importModule).toHaveBeenCalledOnce();
        });

        it("logs a failure instead of raising it, and lets the next load try again", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const importModule = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(fakeModule);
            const loader = createLivekitClientLoader(importModule);

            loader.preload();
            await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());

            await expect(loader.load()).resolves.toBe(fakeModule);
            expect(importModule).toHaveBeenCalledTimes(2);
        });
    });

    it("loads the real library through its one dynamic import", async () => {
        const module = await loadLivekitClient();

        expect(typeof module.Room).toBe("function");
        expect(livekitClient()).toBe(module);
    });
});
