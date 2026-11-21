import { describe, expect, it } from "vitest";
import { emptyReason, listPeople, type NearbyRow, type PeopleListInput, type RosterPerson } from "./peopleList";

const ROOM = "https://office.example/_/global/map.json";
const AWAY_ROOM = "https://office.example/_/global/annex.json";

const near = (id: number, name: string, extra: Partial<NearbyRow> = {}): NearbyRow => ({
    spaceUserId: `${ROOM}_${id}`,
    uuid: `account-${id}`,
    name,
    status: 1,
    place: undefined,
    ...extra,
});

const session = (id: number, name: string, playUri = ROOM): RosterPerson => ({
    spaceUserId: `${playUri}_${id}`,
    uuid: `account-${id}`,
    name,
    playUri,
    roomName: undefined,
});

function list(overrides: Partial<PeopleListInput>) {
    return listPeople({
        mode: "everyone",
        roomKey: ROOM,
        mySpaceUserId: `${ROOM}_1`,
        roster: [],
        nearby: [],
        query: "",
        ...overrides,
    });
}

const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name);

describe("listPeople, near you", () => {
    it("lists the people around the player nearest first, and leaves the player out", () => {
        const result = list({
            mode: "nearby",
            nearby: [near(1, "Eu"), near(7, "Carla"), near(4, "Ana"), near(9, "Bruno")],
        });

        expect(names(result.rows)).toEqual(["Carla", "Ana", "Bruno"]);
        expect(result.held).toBe(3);
    });

    it("carries the account and the room of each person, which the room of the player is", () => {
        const result = list({ mode: "nearby", nearby: [near(7, "Carla")] });

        expect(result.rows[0]).toMatchObject({ uuid: "account-7", playUri: ROOM });
    });

    it("shows the first 60 of 100 people and says how many there are", () => {
        const crowd = Array.from({ length: 100 }, (_, index) => near(index + 10, `Pessoa ${index + 10}`));

        const result = list({ mode: "nearby", nearby: crowd });

        expect(result.rows).toHaveLength(60);
        expect(result.rows[0].name).toBe("Pessoa 10");
        expect(result.held).toBe(100);
        expect(result.matching).toBe(100);
    });

    it("searches before it windows: a name beyond the first 60 is found", () => {
        const crowd = Array.from({ length: 100 }, (_, index) => near(index + 10, `Pessoa ${index + 10}`));

        const result = list({ mode: "nearby", nearby: crowd, query: "pessoa 105" });

        expect(names(result.rows)).toEqual(["Pessoa 105"]);
        expect(result.matching).toBe(1);
    });

    it("does not read the roster", () => {
        const result = list({ mode: "nearby", roster: [session(2, "Longe")], nearby: [] });

        expect(result.rows).toEqual([]);
        expect(result.held).toBe(0);
    });
});

describe("listPeople, everyone", () => {
    it("puts the people around the player first, nearest first, and the others by name", () => {
        const result = list({
            roster: [session(1, "Eu"), session(2, "Zeca"), session(3, "Alice"), session(4, "Bia"), session(5, "Dora")],
            nearby: [near(5, "Dora"), near(3, "Alice")],
        });

        expect(names(result.rows)).toEqual(["Dora", "Alice", "Bia", "Zeca"]);
    });

    it("gives the place the scene knows to a person who is both on the roster and around the player", () => {
        const result = list({
            roster: [session(1, "Eu"), session(5, "Dora")],
            nearby: [near(5, "Dora", { place: { kind: "area", name: "Sala azul" } })],
        });

        expect(result.rows[0].place).toEqual({ kind: "area", name: "Sala azul" });
    });

    it("marks a session of another room, which the player cannot walk to", () => {
        const result = list({ roster: [session(2, "Ana"), session(3, "Bia", AWAY_ROOM)] });

        expect(result.rows.map((row) => [row.name, row.elsewhere])).toEqual([
            ["Ana", false],
            ["Bia", true],
        ]);
    });

    it("keeps two people with one name apart, in a fixed order, by their session", () => {
        const first = list({ roster: [session(3, "Ana"), session(2, "Ana")] });
        const second = list({ roster: [session(2, "Ana"), session(3, "Ana")] });

        expect(first.rows.map((row) => row.key)).toEqual([`${ROOM}_2`, `${ROOM}_3`]);
        expect(second.rows.map((row) => row.key)).toEqual(first.rows.map((row) => row.key));
    });

    it("lists an account in two sessions as two rows", () => {
        const result = list({ roster: [session(2, "Ana"), session(3, "Ana")] });

        expect(result.rows).toHaveLength(2);
    });

    it("shows the first 200 of 300 people, and counts all 300 as held", () => {
        const roster = [
            session(1, "Eu"),
            ...Array.from({ length: 299 }, (_, index) =>
                session(index + 2, `Pessoa ${String(index + 2).padStart(3, "0")}`),
            ),
        ];

        const result = list({ roster });

        expect(result.rows).toHaveLength(200);
        expect(result.rows[0].name).toBe("Pessoa 002");
        expect(result.held).toBe(299);
        expect(result.matching).toBe(299);
    });

    it("searches the whole roster before it windows, ignoring accents", () => {
        const roster = [
            session(1, "Eu"),
            ...Array.from({ length: 299 }, (_, index) =>
                session(index + 2, `Pessoa ${String(index + 2).padStart(3, "0")}`),
            ),
            session(400, "Zélia"),
        ];

        const result = list({ roster, query: "zelia" });

        expect(names(result.rows)).toEqual(["Zélia"]);
        expect(result.held).toBe(300);
        expect(result.matching).toBe(1);
    });

    it("carries what walking to a person asks for: the account and the room they are in", () => {
        const result = list({ roster: [session(2, "Ana"), session(3, "Bia", AWAY_ROOM)] });

        expect(result.rows.map((row) => [row.uuid, row.playUri])).toEqual([
            ["account-2", ROOM],
            ["account-3", AWAY_ROOM],
        ]);
    });

    it("does not read the people around the player that the roster does not hold", () => {
        const result = list({ roster: [session(2, "Ana")], nearby: [near(9, "Fantasma")] });

        expect(names(result.rows)).toEqual(["Ana"]);
    });
});

describe("emptyReason", () => {
    const base = { mode: "everyone", held: 0, shown: 0, query: "", worldAlone: true } as const;

    it("says nothing while there are rows", () => {
        expect(emptyReason({ ...base, shown: 3, held: 3 })).toBeUndefined();
    });

    it("says the player is alone when the world holds nobody else", () => {
        expect(emptyReason(base)).toBe("alone");
    });

    it("tells nobody matching the query from nobody being there", () => {
        expect(emptyReason({ ...base, held: 5, query: "zé" })).toBe("noMatch");
        expect(emptyReason({ ...base, held: 0, query: "zé" })).toBe("alone");
        expect(emptyReason({ ...base, held: 5, query: "   " })).toBe("alone");
    });

    it("says nobody is near, not that the player is alone, when the world holds more people than the ones around", () => {
        expect(emptyReason({ ...base, mode: "nearby", worldAlone: false })).toBe("nobodyNearby");
        expect(emptyReason({ ...base, mode: "nearby", worldAlone: true })).toBe("alone");
    });

    // A search among the people around the player reaches only them: the colleague it is looking for may be online
    // elsewhere in the office, so "nobody in the office has that name" would be false.
    it("does not say nobody in the office has the name when the search reached only the people around", () => {
        const nearby = { ...base, mode: "nearby", held: 12, worldAlone: false } as const;

        expect(emptyReason({ ...nearby, query: "zé" })).toBe("nobodyNearbyMatches");
        expect(emptyReason({ ...nearby, query: "zé" })).not.toBe("noMatch");
    });

    it("keeps nobody in the office for a search that reached everyone, and nobody near for an empty search", () => {
        expect(emptyReason({ ...base, mode: "everyone", held: 12, query: "zé", worldAlone: false })).toBe("noMatch");
        expect(emptyReason({ ...base, mode: "nearby", held: 12, query: "  ", worldAlone: false })).toBe("nobodyNearby");
    });
});
