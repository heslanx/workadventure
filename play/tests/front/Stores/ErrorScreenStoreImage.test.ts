import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the type guards are used, and only when an error is set: stubbing the module keeps this test independent of the
// generated protobuf code.
vi.mock("@workadventure/messages", () => ({
    ErrorScreenMessage: {},
    isErrorApiErrorData: { safeParse: vi.fn() },
    isErrorApiRetryData: { safeParse: vi.fn() },
    isErrorApiUnauthorizedData: { safeParse: vi.fn() },
}));

describe("importing ErrorScreenStore", () => {
    const requestedImages: string[] = [];

    beforeEach(() => {
        requestedImages.length = 0;
        vi.resetModules();
        vi.stubGlobal(
            "Image",
            class {
                set src(url: string) {
                    requestedImages.push(url);
                }
            },
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // The import has to happen inside the test, after Image is stubbed and the module registry reset, so the test
    // pays for a cold import of the store's module graph: about 1.5 s alone, past the default 5 s when every worker
    // of the full suite imports at once. The longer timeout covers that import; there is no race to hide.
    it("does not download images before an error screen needs them", { timeout: 30_000 }, async () => {
        await import("../../../src/front/Stores/ErrorScreenStore");

        expect(requestedImages).toEqual([]);
    });
});
