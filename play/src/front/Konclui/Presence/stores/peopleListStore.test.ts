// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, readable, type Writable } from "svelte/store";
import type { CrowdReading } from "../domain/crowd";
import type { SpaceUserExtended } from "../../../Space/SpaceInterface";

// The roster is what the world roster tests cover; here it is a view the panel store reads, and the player's status
// comes from a store that reaches the media devices.
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { availabilityStatusStore: writable(1) };
});
vi.mock("./worldRoster", async () => {
    const { writable } = await import("svelte/store");
    return { rosterViewStore: writable({}) };
});

import { availabilityStatusStore } from "../../../Stores/MediaStore";
import { peoplePanelStore } from "./peopleListStore";
import { publishCrowd } from "./crowdStore";
import { setPeopleQuery } from "./peopleSearchStore";
import { rosterViewStore, type RosterView } from "./worldRoster";

const view = rosterViewStore as unknown as Writable<RosterView>;
const myStatus = availabilityStatusStore as unknown as Writable<number>;

const ROOM = "https://office.example/map";

const unwatched: RosterView = {
    mode: "nearby",
    canChooseEveryone: false,
    watching: false,
    synced: false,
    failed: false,
    users: new Map(),
    headcount: 0,
};

const user = (id: number, name: string, playUri = ROOM): SpaceUserExtended =>
    ({
        spaceUserId: `${ROOM}_${id}`,
        uuid: `account-${id}`,
        name,
        playUri,
        roomName: undefined,
        reactiveUser: { availabilityStatus: readable(1) },
    }) as unknown as SpaceUserExtended;

const everyone = (people: SpaceUserExtended[], extra: Partial<RosterView> = {}): RosterView => ({
    ...unwatched,
    mode: "everyone",
    watching: true,
    synced: true,
    users: new Map(people.map((person) => [person.spaceUserId, person])),
    headcount: people.length,
    ...extra,
});

const crowd = (people: CrowdReading["people"] = []): CrowdReading => ({
    roomKey: ROOM,
    me: { spaceUserId: `${ROOM}_1`, name: "Eu", place: { kind: "hall" } },
    people,
});

const nearbyPerson = (id: number, name: string): CrowdReading["people"][number] => ({
    spaceUserId: `${ROOM}_${id}`,
    uuid: `account-${id}`,
    name,
    status: 1,
    place: { kind: "area", name: "Sala azul" },
});

beforeEach(() => {
    view.set(unwatched);
    publishCrowd(undefined);
    setPeopleQuery("");
    myStatus.set(1);
});

afterEach(() => {
    publishCrowd(undefined);
});

describe("the people panel's state, near you", () => {
    it("is loading until the scene has read the player once", () => {
        expect(get(peoplePanelStore).phase).toBe("loading");

        publishCrowd(crowd());

        expect(get(peoplePanelStore).phase).toBe("ready");
    });

    it("lists the people around the player nearest first, and the player apart", () => {
        view.set({ ...unwatched, headcount: 500, canChooseEveryone: true });
        publishCrowd(crowd([nearbyPerson(7, "Carla"), nearbyPerson(4, "Ana")]));

        const state = get(peoplePanelStore);

        expect(state.mode).toBe("nearby");
        expect(state.rows.map((row) => row.name)).toEqual(["Carla", "Ana"]);
        expect(state.me).toEqual({ name: "Eu", place: { kind: "hall" }, status: 1 });
        expect(state.canChooseEveryone).toBe(true);
    });

    it("says how many people the world holds from the headcount, not from the rows it lists", () => {
        view.set({ ...unwatched, headcount: 640 });
        publishCrowd(crowd([nearbyPerson(7, "Carla")]));

        expect(get(peoplePanelStore).count).toBe(640);
        expect(get(peoplePanelStore).rows).toHaveLength(1);
    });

    it("says nobody is near, not that the player is alone, when the world holds more people", () => {
        view.set({ ...unwatched, headcount: 500 });
        publishCrowd(crowd());

        expect(get(peoplePanelStore).empty).toBe("nobodyNearby");
    });

    it("says a search reached only the people around, not the office, when none of them has the name", () => {
        view.set({ ...unwatched, headcount: 500, canChooseEveryone: true });
        publishCrowd(crowd([nearbyPerson(7, "Carla")]));
        setPeopleQuery("zeca");

        const state = get(peoplePanelStore);

        expect(state.rows).toEqual([]);
        expect(state.empty).toBe("nobodyNearbyMatches");
        expect(state.canChooseEveryone).toBe(true);
    });

    it("follows the player's own status", () => {
        publishCrowd(crowd());
        myStatus.set(4);

        expect(get(peoplePanelStore).me?.status).toBe(4);
    });
});

describe("the people panel's state, everyone", () => {
    it("is loading until the pusher has sent the whole list, and says so rather than listing nobody", () => {
        view.set(everyone([], { synced: false }));
        publishCrowd(crowd());

        const state = get(peoplePanelStore);

        expect(state.phase).toBe("loading");
        expect(state.empty).toBeUndefined();
    });

    it("is unavailable when the list could not be loaded", () => {
        view.set(everyone([], { synced: false, failed: true }));

        expect(get(peoplePanelStore).phase).toBe("unavailable");
    });

    it("lists the roster by name, leaving the player out, and gives each person's live status through the roster", () => {
        const people = [user(1, "Eu"), user(3, "Zeca"), user(2, "Ana")];
        view.set(everyone(people));
        publishCrowd(crowd());

        const state = get(peoplePanelStore);

        expect(state.rows.map((row) => row.name)).toEqual(["Ana", "Zeca"]);
        expect(state.users.get(`${ROOM}_2`)).toBe(people[2]);
    });

    it("says the player is alone when the roster holds nobody else", () => {
        view.set(everyone([user(1, "Eu")]));
        publishCrowd(crowd());

        expect(get(peoplePanelStore).empty).toBe("alone");
    });

    it("tells nobody matching the search from nobody being there", () => {
        view.set(everyone([user(1, "Eu"), user(2, "Ana")]));
        publishCrowd(crowd());
        setPeopleQuery("zeca");

        const state = get(peoplePanelStore);

        expect(state.empty).toBe("noMatch");
        expect(state.searching).toBe(true);
    });

    it("finds a name without its accents", () => {
        view.set(everyone([user(1, "Eu"), user(2, "João Silva")]));
        publishCrowd(crowd());
        setPeopleQuery("joao");

        expect(get(peoplePanelStore).rows.map((row) => row.name)).toEqual(["João Silva"]);
    });

    it("says it shows the first 200 of the people that match when the window cut the list", () => {
        const people = Array.from({ length: 301 }, (_, index) =>
            user(index + 1, `Pessoa ${String(index).padStart(3, "0")}`),
        );
        view.set(everyone(people, { headcount: 301 }));
        publishCrowd(crowd());

        const state = get(peoplePanelStore);

        expect(state.rows).toHaveLength(200);
        expect(state.cutOf).toBe(300);
    });

    it("keeps a person of another room in the list, marked as not reachable", () => {
        view.set(everyone([user(1, "Eu"), user(2, "Bia", "https://office.example/annex")]));
        publishCrowd(crowd());

        expect(get(peoplePanelStore).rows[0]).toMatchObject({ name: "Bia", elsewhere: true });
    });
});
