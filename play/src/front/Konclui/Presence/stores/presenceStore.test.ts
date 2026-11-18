import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresenceReading } from "../domain/presence";
import { presenceStore, publishPresence } from "./presenceStore";

const reading: PresenceReading = { nearest: [{ id: 1, name: "Ana" }], nearCount: 1, place: { kind: "hall" } };

describe("the presence store", () => {
    afterEach(() => {
        publishPresence(undefined);
    });

    it("tells its subscribers about a reading", () => {
        const heard = vi.fn();
        const unsubscribe = presenceStore.subscribe(heard);

        publishPresence(reading);
        unsubscribe();

        expect(heard).toHaveBeenLastCalledWith(reading);
    });

    it("drops a reading equal to the last one, so a subscriber hears each change and not each look", () => {
        const heard = vi.fn();
        const unsubscribe = presenceStore.subscribe(heard);
        publishPresence(reading);
        heard.mockClear();

        publishPresence({ ...reading, nearest: [{ id: 1, name: "Ana" }] });
        unsubscribe();

        expect(heard).not.toHaveBeenCalled();
    });

    it("tells about a reading that differs only in the place", () => {
        const heard = vi.fn();
        const unsubscribe = presenceStore.subscribe(heard);
        publishPresence(reading);
        heard.mockClear();

        publishPresence({ ...reading, place: { kind: "outside" } });
        unsubscribe();

        expect(heard).toHaveBeenCalledTimes(1);
    });

    it("clears when the scene says it has nothing to show", () => {
        publishPresence(reading);
        const heard = vi.fn();
        const unsubscribe = presenceStore.subscribe(heard);

        publishPresence(undefined);
        unsubscribe();

        expect(heard).toHaveBeenLastCalledWith(undefined);
    });
});
