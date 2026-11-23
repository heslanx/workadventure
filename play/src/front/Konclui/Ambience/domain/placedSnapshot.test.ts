import { describe, expect, it } from "vitest";
import { PlacedSnapshot } from "./placedSnapshot";

interface Piece {
    kind: "piece";
    texture: { key: string };
    x: number;
    y: number;
    flipX?: boolean;
    displayWidth?: number;
    displayHeight?: number;
}

const piece = (key: string, x: number, y: number): Piece => ({ kind: "piece", texture: { key }, x, y });
const isPiece = (child: unknown): child is Piece => (child as { kind?: string }).kind === "piece";

describe("a snapshot of the placed images", () => {
    it("matches the scene it captured, whatever else is among the children", () => {
        const placed = [piece("a", 1, 2), piece("b", 3, 4)];
        const snapshot = new PlacedSnapshot();
        snapshot.capture(placed);

        expect(snapshot.matches([{ kind: "layer" }, placed[0], { kind: "shader" }, placed[1]], isPiece)).toBe(true);
    });

    it("does not match before anything is captured, not even an empty scene", () => {
        expect(new PlacedSnapshot().matches([], isPiece)).toBe(false);
    });

    it("matches an empty scene it captured as empty", () => {
        const snapshot = new PlacedSnapshot();
        snapshot.capture([]);

        expect(snapshot.matches([{ kind: "layer" }], isPiece)).toBe(true);
    });

    const changes: [string, (list: Piece[]) => void][] = [
        [
            "a piece moved sideways",
            (list) => {
                list[1].x += 1;
            },
        ],
        [
            "a piece moved down",
            (list) => {
                list[0].y -= 1;
            },
        ],
        [
            "a piece took another texture",
            (list) => {
                list[1].texture = { key: "c" };
            },
        ],
        [
            "a piece was added",
            (list) => {
                list.push(piece("c", 0, 0));
            },
        ],
        [
            "a piece was removed",
            (list) => {
                list.pop();
            },
        ],
        [
            "two pieces swapped places",
            (list) => {
                list.reverse();
            },
        ],
    ];

    it.each(changes)("does not match once %s", (_, change) => {
        const placed = [piece("a", 1, 2), piece("b", 3, 4)];
        const snapshot = new PlacedSnapshot();
        snapshot.capture(placed);

        change(placed);

        expect(snapshot.matches(placed, isPiece)).toBe(false);
    });

    it("matches again after a new capture, and forgets what was longer before", () => {
        const placed = [piece("a", 1, 2), piece("b", 3, 4), piece("c", 5, 6)];
        const snapshot = new PlacedSnapshot();
        snapshot.capture(placed);
        placed.pop();
        snapshot.capture(placed);

        expect(snapshot.matches(placed, isPiece)).toBe(true);
        expect(snapshot.matches([...placed, piece("c", 5, 6)], isPiece)).toBe(false);
    });

    // Seen failing with the snapshot reading only key and position: a piece mirrored or resized in the editor kept its
    // old shadow until something else moved.
    it("does not match once a piece is mirrored or drawn at another size, which move its shadow", () => {
        const make = (flipX: boolean, w: number): Piece => ({
            ...piece("a", 1, 2),
            flipX,
            displayWidth: w,
            displayHeight: 32,
        });
        const snapshot = new PlacedSnapshot(true);
        snapshot.capture([make(false, 32)]);
        expect(snapshot.matches([make(false, 32)], isPiece)).toBe(true);
        expect(snapshot.matches([make(true, 32)], isPiece)).toBe(false);
        expect(snapshot.matches([make(false, 48)], isPiece)).toBe(false);
    });

    it("reads neither flip nor size unless asked to (a room without the shading reads what it always did)", () => {
        const make = (flipX: boolean, w: number): Piece => ({
            ...piece("a", 1, 2),
            flipX,
            displayWidth: w,
            displayHeight: 32,
        });
        const snapshot = new PlacedSnapshot();
        snapshot.capture([make(false, 32)]);
        expect(snapshot.matches([make(true, 48)], isPiece)).toBe(true);
    });
});
