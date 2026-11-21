import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { NOT_WALKING } from "../domain/walk";
import { publishWalk, walkStore } from "./walkStore";

describe("walkStore", () => {
    it("starts with no walk", () => {
        expect(get(walkStore)).toEqual(NOT_WALKING);
    });

    it("takes in what the controller reports", () => {
        publishWalk({ walking: true, walkStatus: "going" });

        expect(get(walkStore)).toEqual({ walking: true, walkStatus: "going" });

        publishWalk(NOT_WALKING);
    });

    it("wakes nobody when the reading is the one it already holds", () => {
        const listener = vi.fn();
        const unsubscribe = walkStore.subscribe(listener);
        publishWalk({ walking: true, walkStatus: "going" });
        listener.mockClear();

        publishWalk({ walking: true, walkStatus: "going" });
        publishWalk({ walking: true, walkStatus: "going" });

        expect(listener).not.toHaveBeenCalled();
        unsubscribe();
        publishWalk(NOT_WALKING);
    });

    it("takes no more than what a walk is: a controller's richer state leaves its selection out", () => {
        publishWalk({ walking: false, walkStatus: "cancelled", selected: { tileX: 1, tileY: 2 } } as never);

        expect(get(walkStore)).toEqual({ walking: false, walkStatus: "cancelled" });

        publishWalk(NOT_WALKING);
    });

    it("returns to no walk when the controller says the walk is over", () => {
        publishWalk({ walking: true, walkStatus: "going" });

        publishWalk(NOT_WALKING);

        expect(get(walkStore)).toEqual(NOT_WALKING);
    });
});
