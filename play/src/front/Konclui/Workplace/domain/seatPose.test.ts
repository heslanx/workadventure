import { describe, expect, it } from "vitest";
import { parseSeatPose } from "./seatPose";

const baseUrl = "http://localhost:8090/~/escritorio-sede/office.wam";

describe("parseSeatPose", () => {
    it.each([
        ["up", { crop: 10, dy: -3 }],
        ["down", { crop: 0, dy: -3 }],
        ["left", { crop: 0, dy: -3 }],
        ["right", { crop: 0, dy: -3 }],
    ])("gives a pose facing %s its default crop and offset", (direction, defaults) => {
        expect(parseSeatPose({ v: 1, direction }, baseUrl)).toEqual({ direction, ...defaults, front: undefined });
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["a string", "down"],
        ["a number", 1],
        ["an array", [1, "down"]],
        ["no version", { direction: "down" }],
        ["another version", { v: 2, direction: "down" }],
        ["a version given as a string", { v: "1", direction: "down" }],
        ["no direction", { v: 1 }],
        ["a direction that is not one of the four", { v: 1, direction: "north" }],
        ["a direction in another case", { v: 1, direction: "Down" }],
    ])("has no pose for %s", (_label, value) => {
        expect(parseSeatPose(value, baseUrl)).toBeUndefined();
    });

    it.each([
        ["the smallest crop", { crop: 0 }, { crop: 0, dy: -3 }],
        ["the largest crop", { crop: 16 }, { crop: 16, dy: -3 }],
        ["the lowest offset", { dy: -16 }, { crop: 10, dy: -16 }],
        ["the highest offset", { dy: 16 }, { crop: 10, dy: 16 }],
        ["an offset with a fraction, rounded", { dy: 2.6 }, { crop: 10, dy: 3 }],
    ])("keeps %s the seat sends", (_label, fields, expected) => {
        expect(parseSeatPose({ v: 1, direction: "up", ...fields }, baseUrl)).toMatchObject(expected);
    });

    it.each([
        ["a crop above the range", { crop: 17, dy: 4 }, { crop: 10, dy: 4 }],
        ["a crop below the range", { crop: -1, dy: 4 }, { crop: 10, dy: 4 }],
        ["a crop that is not an integer", { crop: 2.5, dy: 4 }, { crop: 10, dy: 4 }],
        ["a crop given as a string", { crop: "3", dy: 4 }, { crop: 10, dy: 4 }],
        ["an offset above the range", { crop: 3, dy: 17 }, { crop: 3, dy: -3 }],
        ["an offset below the range", { crop: 3, dy: -17 }, { crop: 3, dy: -3 }],
        ["an offset that is not a number", { crop: 3, dy: Number.NaN }, { crop: 3, dy: -3 }],
        ["an infinite offset", { crop: 3, dy: Number.NEGATIVE_INFINITY }, { crop: 3, dy: -3 }],
        ["an offset given as a string", { crop: 3, dy: "4" }, { crop: 3, dy: -3 }],
    ])("falls back to the default for %s and keeps the other field", (_label, fields, expected) => {
        expect(parseSeatPose({ v: 1, direction: "up", ...fields }, baseUrl)).toMatchObject(expected);
    });

    it("resolves a front image of the map storage against the page address and rounds its position", () => {
        const front = { src: "/map-storage/room/entities/chair.png", x: 100.4, y: 199.5 };

        expect(parseSeatPose({ v: 1, direction: "up", front }, baseUrl)?.front).toEqual({
            source: "http://localhost:8090/map-storage/room/entities/chair.png",
            x: 100,
            y: 200,
        });
    });

    it("accepts a front image given as an absolute address of the same origin", () => {
        const front = { src: "http://localhost:8090/map-storage/chair.png", x: 0, y: 0 };

        expect(parseSeatPose({ v: 1, direction: "up", front }, baseUrl)?.front?.source).toBe(
            "http://localhost:8090/map-storage/chair.png",
        );
    });

    it.each([
        ["of another origin", "https://example.com/map-storage/chair.png"],
        ["of another port", "http://localhost:9090/map-storage/chair.png"],
        ["outside the map storage", "/other/chair.png"],
        ["relative to the page", "chair.png"],
        ["that climbs out of the map storage", "/map-storage/../admin/x.png"],
        ["that is not a PNG", "/map-storage/chair.svg"],
        ["with a query", "/map-storage/chair.png?v=2"],
        ["with a fragment", "/map-storage/chair.png#2"],
        ["whose address does not parse", "http://["],
    ])("drops a front image %s and keeps the pose", (_label, src) => {
        const pose = parseSeatPose({ v: 1, direction: "up", dy: 4, front: { src, x: 0, y: 0 } }, baseUrl);

        expect(pose).toEqual({ direction: "up", crop: 10, dy: 4, front: undefined });
    });

    it.each([
        ["that is not an object", "/map-storage/chair.png"],
        ["that is null", null],
        ["without an address", { x: 0, y: 0 }],
        ["without a horizontal position", { src: "/map-storage/chair.png", y: 0 }],
        ["without a vertical position", { src: "/map-storage/chair.png", x: 0 }],
        ["placed beyond the range", { src: "/map-storage/chair.png", x: 100_001, y: 0 }],
        ["placed at a position that is not a number", { src: "/map-storage/chair.png", x: 0, y: "0" }],
    ])("drops a front image %s and keeps the pose", (_label, front) => {
        expect(parseSeatPose({ v: 1, direction: "left", front }, baseUrl)).toEqual({
            direction: "left",
            crop: 0,
            dy: -3,
            front: undefined,
        });
    });

    it("drops the front image and keeps the pose when the page address does not parse", () => {
        const front = { src: "/map-storage/chair.png", x: 0, y: 0 };

        expect(parseSeatPose({ v: 1, direction: "down", front }, "not an address")).toEqual({
            direction: "down",
            crop: 0,
            dy: -3,
            front: undefined,
        });
    });

    it("resolves the same front image against the page address it is given", () => {
        const seat = { v: 1, direction: "up", front: { src: "/map-storage/chair.png", x: 0, y: 0 } };

        expect(parseSeatPose(seat, "http://play.example.test/~/office.wam")?.front?.source).toBe(
            "http://play.example.test/map-storage/chair.png",
        );
    });
});
