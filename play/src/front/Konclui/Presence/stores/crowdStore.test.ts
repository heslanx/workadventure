import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { CrowdReading } from "../domain/crowd";
import { crowdStore, crowdWanted, publishCrowd } from "./crowdStore";
import { rosterListOpenStore } from "./worldRoster";

const reading = (name = "Ana"): CrowdReading => ({
    roomKey: "room",
    me: { spaceUserId: "room_1", name: "Eu", place: undefined },
    people: [{ spaceUserId: "room_2", uuid: "ana", name, status: 1, place: undefined }],
});

afterEach(() => {
    publishCrowd(undefined);
    rosterListOpenStore.set(false);
});

describe("the crowd store", () => {
    it("holds the last reading, and nothing before the scene has read", () => {
        expect(get(crowdStore)).toBeUndefined();

        publishCrowd(reading());

        expect(get(crowdStore)?.people[0].name).toBe("Ana");
    });

    it("tells its subscribers about a change and not about a reading equal to the last", () => {
        const heard = vi.fn();
        const stop = crowdStore.subscribe(heard);
        heard.mockClear();

        publishCrowd(reading());
        publishCrowd(reading());
        publishCrowd(reading("Bia"));
        stop();

        expect(heard).toHaveBeenCalledTimes(2);
    });

    it("is wanted exactly while the people panel is open", () => {
        expect(crowdWanted()).toBe(false);

        rosterListOpenStore.set(true);
        expect(crowdWanted()).toBe(true);

        rosterListOpenStore.set(false);
        expect(crowdWanted()).toBe(false);
    });
});
