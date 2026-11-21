import { describe, expect, it } from "vitest";
import { isSamePlace, placeAt, placeName, type AreaLike } from "./place";

// Areas as the reference office's map has them: a workstation wing with a booth inside it, a room, the unnamed arrival
// area (the one with a `start` property), an unnamed area in the corridor and one the map editor left behind.
const wing: AreaLike = { name: "Estações de trabalho — oeste", x: 640, y: 928, width: 512, height: 352 };
const booth: AreaLike = { name: "Cabine de foco A1", x: 960, y: 960, width: 128, height: 96 };
const room: AreaLike = { name: "Sala 01", x: 1600, y: 900, width: 100, height: 100 };
const arrival: AreaLike = { name: "", x: 1360, y: 1648, width: 64, height: 64, properties: [{ type: "start" }] };
const corridor: AreaLike = { name: "", x: 1200, y: 950, width: 100, height: 100 };
const leftover: AreaLike = { name: "  ", x: 0, y: 0, width: 64, height: 64 };
const office = [wing, booth, room, arrival, corridor, leftover];

describe("placeAt", () => {
    it("names the smallest area that holds the point, so a booth wins over the wing around it", () => {
        expect(placeAt(office, { x: 700, y: 1000 })).toEqual({ kind: "area", name: "Estações de trabalho — oeste" });
        expect(placeAt(office, { x: 1000, y: 1000 })).toEqual({ kind: "area", name: "Cabine de foco A1" });
    });

    it("gives the same answer whatever order the map lists its areas in", () => {
        expect(placeAt([...office].reverse(), { x: 1000, y: 1000 })).toEqual({
            kind: "area",
            name: "Cabine de foco A1",
        });
    });

    it("calls the space between the rooms the hall, an unnamed area in it included", () => {
        expect(placeAt(office, { x: 1400, y: 1000 })).toEqual({ kind: "hall" });
        expect(placeAt(office, { x: 1250, y: 1000 })).toEqual({ kind: "hall" });
    });

    it("calls anything beyond the rooms outside, the entrance not counting as a room", () => {
        // The map editor's unnamed leftover area holds this point and names nothing.
        expect(placeAt(office, { x: 10, y: 10 })).toEqual({ kind: "outside" });
        // Below the last room: the arrival area is lower, but it takes no part in the box around the rooms.
        expect(placeAt(office, { x: 1370, y: 1720 })).toEqual({ kind: "outside" });
    });

    it("calls the unnamed arrival area the entrance", () => {
        expect(placeAt(office, { x: 1370, y: 1660 })).toEqual({ kind: "entrance" });
    });

    it("keeps the name of an arrival area the map named", () => {
        const named = { ...arrival, name: "Recepção" };

        expect(placeAt([...office.filter((area) => area !== arrival), named], { x: 1370, y: 1660 })).toEqual({
            kind: "area",
            name: "Recepção",
        });
    });

    it("includes the edges of an area, as WorkAdventure's own test does", () => {
        expect(placeAt(office, { x: 1600, y: 900 })).toEqual({ kind: "area", name: "Sala 01" });
        expect(placeAt(office, { x: 1700, y: 1000 })).toEqual({ kind: "area", name: "Sala 01" });
        expect(placeAt(office, { x: 1701, y: 1000 })).not.toEqual({ kind: "area", name: "Sala 01" });
    });

    it("says nothing when the map names no area, instead of calling every such map the hall", () => {
        expect(placeAt([], { x: 10, y: 10 })).toBeUndefined();
        expect(placeAt([leftover], { x: 10, y: 10 })).toBeUndefined();
    });

    it("says nothing outside the entrance when the entrance is the only named area", () => {
        expect(placeAt([arrival], { x: 10, y: 10 })).toBeUndefined();
        expect(placeAt([arrival], { x: 1370, y: 1660 })).toEqual({ kind: "entrance" });
    });

    it("reads a name without its surrounding spaces", () => {
        expect(placeAt([{ ...room, name: "  Sala 01 " }], { x: 1650, y: 950 })).toEqual({
            kind: "area",
            name: "Sala 01",
        });
    });
});

describe("isSamePlace", () => {
    it.each([
        [{ kind: "area", name: "Sala 01" }, { kind: "area", name: "Sala 01" }, true],
        [{ kind: "area", name: "Sala 01" }, { kind: "area", name: "Sala 02" }, false],
        [{ kind: "hall" }, { kind: "hall" }, true],
        [{ kind: "hall" }, { kind: "outside" }, false],
        [{ kind: "area", name: "Hall" }, { kind: "hall" }, false],
        [undefined, undefined, true],
        [undefined, { kind: "entrance" }, false],
    ] as const)("compares %j with %j as %s", (a, b, same) => {
        expect(isSamePlace(a, b)).toBe(same);
    });
});

describe("placeName", () => {
    const names = { entrance: "Entrada", hall: "Hall", outside: "Área externa" };

    it("is the name the map gave an area", () => {
        expect(placeName({ kind: "area", name: "Sala 01" }, names)).toBe("Sala 01");
    });

    it("is the interface's own word for the places the map does not name", () => {
        expect(placeName({ kind: "entrance" }, names)).toBe("Entrada");
        expect(placeName({ kind: "hall" }, names)).toBe("Hall");
        expect(placeName({ kind: "outside" }, names)).toBe("Área externa");
    });
});
