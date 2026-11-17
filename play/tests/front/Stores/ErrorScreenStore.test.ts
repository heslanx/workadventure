import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { errorScreenStore } from "../../../src/front/Stores/ErrorScreenStore";

describe("errorScreenStore.setException", () => {
    afterEach(() => {
        errorScreenStore.delete();
        vi.restoreAllMocks();
    });

    it("shows an error screen for something that is not an Error, instead of rethrowing it", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => errorScreenStore.setException(new Event("close"))).not.toThrow();

        expect(get(errorScreenStore)).toMatchObject({
            type: "error",
            code: "INTERNAL_ERROR",
            clientErrorKind: "generic",
            technicalDetails: "[object Event]",
        });
    });

    it("leaves the logo of a thrown string to the error screen", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        errorScreenStore.setException("Room not found");

        const errorScreen = get(errorScreenStore);
        expect(errorScreen).toMatchObject({
            type: "error",
            code: "INTERNAL_ERROR",
            clientErrorKind: "generic",
            technicalDetails: "Room not found",
        });
        // The error screen shows `imageLogo ?? <room logo or Konclui logo>`: a logo set here would replace both.
        expect(errorScreen?.imageLogo).toBeUndefined();
    });
});
