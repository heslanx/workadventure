import { describe, expect, it } from "vitest";
import { isRowKey, rowAfterKey } from "./rowNavigation";

describe("rowAfterKey", () => {
    it("moves one row down and up", () => {
        expect(rowAfterKey("ArrowDown", 2, 10)).toBe(3);
        expect(rowAfterKey("ArrowUp", 2, 10)).toBe(1);
    });

    it("stops at the ends of the list", () => {
        expect(rowAfterKey("ArrowDown", 9, 10)).toBe(9);
        expect(rowAfterKey("ArrowUp", 0, 10)).toBe(0);
    });

    it("goes to the first and the last row with Home and End", () => {
        expect(rowAfterKey("Home", 5, 10)).toBe(0);
        expect(rowAfterKey("End", 5, 10)).toBe(9);
    });

    it("enters the list from outside: Down reaches the first row and Up the last", () => {
        expect(rowAfterKey("ArrowDown", -1, 10)).toBe(0);
        expect(rowAfterKey("ArrowUp", -1, 10)).toBe(9);
    });

    it("has no row to go to in an empty list", () => {
        expect(rowAfterKey("ArrowDown", -1, 0)).toBe(-1);
    });
});

describe("isRowKey", () => {
    it("knows the four keys and nothing else", () => {
        expect(["ArrowDown", "ArrowUp", "Home", "End"].every(isRowKey)).toBe(true);
        expect(["ArrowLeft", "Enter", "k"].some(isRowKey)).toBe(false);
    });
});
