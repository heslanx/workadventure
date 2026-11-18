import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../domain/place";
import { placeStore } from "./placeStore";
import { publishPresence } from "./presenceStore";

function reading(place: Place | undefined, nearCount = 0) {
    return { nearest: [], nearCount, place };
}

describe("the place store", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        publishPresence(undefined);
        vi.useRealTimers();
    });

    function follow() {
        const seen: (Place | undefined)[] = [];
        const unsubscribe = placeStore.subscribe((place) => seen.push(place));
        return { seen, unsubscribe };
    }

    it("follows the place of the reading", () => {
        publishPresence(reading({ kind: "area", name: "Sala 01" }));
        const { seen, unsubscribe } = follow();
        unsubscribe();

        expect(seen).toEqual([{ kind: "area", name: "Sala 01" }]);
    });

    it("stays still while people walk by, so the live region is not read out for them", () => {
        publishPresence(reading({ kind: "hall" }, 0));
        const { seen, unsubscribe } = follow();

        publishPresence(reading({ kind: "hall" }, 1));
        publishPresence(reading({ kind: "hall" }, 2));
        publishPresence(reading({ kind: "hall" }, 1));
        unsubscribe();

        expect(seen).toHaveLength(1);
    });

    it("announces a walk along an area's edge once per cool-down, not once per step", () => {
        const hall: Place = { kind: "hall" };
        const room: Place = { kind: "area", name: "Sala 01" };
        publishPresence(reading(hall));
        const { seen, unsubscribe } = follow();

        // Five steps over the edge in 1.25 s: the room, the hall, the room, the hall, the room.
        for (const place of [room, hall, room, hall, room]) {
            publishPresence(reading(place));
            vi.advanceTimersByTime(250);
        }
        vi.advanceTimersByTime(2000);
        unsubscribe();

        expect(seen).toEqual([hall, room]);
    });

    it("is empty when the scene has no reading", () => {
        publishPresence(reading({ kind: "hall" }));
        const { seen, unsubscribe } = follow();

        publishPresence(undefined);
        unsubscribe();

        expect(seen).toEqual([{ kind: "hall" }, undefined]);
    });
});
