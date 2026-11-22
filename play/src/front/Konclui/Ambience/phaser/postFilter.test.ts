// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    EXTERNAL_POST_FILTER_ENABLED,
    EXTERNAL_POST_FILTER_STORAGE_KEY,
    isExternalPostFilterEnabled,
    resetExternalPostFilterStorageWarningForTests,
} from "./postFilter";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
    return { getItem: (key) => (key === EXTERNAL_POST_FILTER_STORAGE_KEY ? value : null) };
}

afterEach(() => {
    vi.restoreAllMocks();
    resetExternalPostFilterStorageWarningForTests();
});

describe("the flag that puts the camera pass on the external filter list", () => {
    it("is off by default, until a real run measures it", () => {
        expect(EXTERNAL_POST_FILTER_ENABLED).toBe(false);
        expect(isExternalPostFilterEnabled(storageWith(null))).toBe(false);
        expect(isExternalPostFilterEnabled(undefined)).toBe(false);
    });

    it('is read from localStorage["konclui.fx.external"]: "1" on, "0" off, anything else the default', () => {
        expect(EXTERNAL_POST_FILTER_STORAGE_KEY).toBe("konclui.fx.external");
        expect(isExternalPostFilterEnabled(storageWith("1"))).toBe(true);
        expect(isExternalPostFilterEnabled(storageWith("0"))).toBe(false);
        expect(isExternalPostFilterEnabled(storageWith("true"))).toBe(EXTERNAL_POST_FILTER_ENABLED);
        expect(isExternalPostFilterEnabled(storageWith(""))).toBe(EXTERNAL_POST_FILTER_ENABLED);
    });

    it("keeps the default, and says so once, when the storage cannot be read", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const blocked: Pick<Storage, "getItem"> = {
            getItem: () => {
                throw new DOMException("blocked", "SecurityError");
            },
        };

        expect(isExternalPostFilterEnabled(blocked)).toBe(EXTERNAL_POST_FILTER_ENABLED);
        expect(isExternalPostFilterEnabled(blocked)).toBe(EXTERNAL_POST_FILTER_ENABLED);

        expect(warn).toHaveBeenCalledTimes(1);
    });
});
