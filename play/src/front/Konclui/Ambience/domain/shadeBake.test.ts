import { describe, expect, it } from "vitest";
import type { CasterKind } from "./casterKind";
import { keyLightAt, newKeyLight, type KeyLight } from "./keyLight";
import { poolFalloff, type CasterLamp } from "./lamps";
import type { Light } from "./lights";
import {
    BLOCKED_SCALE,
    CastBake,
    FLOOR_PIECE,
    LAMP_FAR_SHARE,
    LAMP_REACH_FACTOR,
    bakeCast,
    carriesLamp,
    lampCasters,
    newCastBuffer,
    type BakeInput,
    type BakePiece,
} from "./shadeBake";
import { silhouetteOf, SOLID_ALPHA } from "./shadeShapes";

const W = 80;
const H = 60;

function sil(rows: string[]) {
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = row[x] === "#" ? 255 : 0;
    });
    return silhouetteOf({ data }, width, rows.length);
}

const POLE = Array.from({ length: 10 }, () => "##");
const BOX = Array.from({ length: 8 }, () => "########");

function piece(
    rows: string[],
    x: number,
    y: number,
    kind: CasterKind = "stand",
    painted = false,
    key = "k",
): BakePiece {
    return { key, x, y, kind, silhouette: sil(rows), painted };
}

function keyAt(hour: number): KeyLight {
    const k = newKeyLight();
    keyLightAt(hour, k);
    return k;
}

function input(pieces: BakePiece[], extra: Partial<BakeInput> = {}): BakeInput {
    return { width: W, height: H, pieces, spaces: [], building: null, lamps: [], key: keyAt(13), ...extra };
}

/** Channel `c` (0 R, 1 G, 2 B, 3 A) of map pixel (x, y) in the flipped buffer. */
const px = (out: Uint8Array, x: number, y: number, c: number): number => out[((H - 1 - y) * W + x) * 4 + c];

/** The cells of a channel above zero, as "x,y". */
function cellsOf(out: Uint8Array, c: number, min = 1): Set<string> {
    const s = new Set<string>();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px(out, x, y, c) >= min) s.add(`${x},${y}`);
    return s;
}

describe("bakeCast", () => {
    it("writes rows flipped: map row y is buffer row H - 1 - y", () => {
        const out = newCastBuffer(W, H);
        bakeCast(input([piece(BOX, 10, 5)]), out, { contact: false, key: false, lamp: false, surface: false });
        expect(out[((H - 1 - 5) * W + 10) * 4 + 3]).toBe(255);
        expect(out[(5 * W + 10) * 4 + 3]).toBe(0);
    });

    describe("solid", () => {
        it("covers the pixels of stand, top and hang pieces and never a floor piece's", () => {
            const out = newCastBuffer(W, H);
            const pieces = [
                piece(BOX, 2, 2, "stand"),
                piece(BOX, 20, 2, "top"),
                piece(BOX, 40, 2, "hang"),
                piece(BOX, 60, 2, "floor"),
            ];
            bakeCast(input(pieces), out, { contact: false, key: false, lamp: false, surface: false });
            const a = cellsOf(out, 3, 255);
            expect(a.size).toBe(3 * 64);
            expect(a.has("2,2") && a.has("20,2") && a.has("40,2")).toBe(true);
            expect(a.has("60,2")).toBe(false);
        });

        // Seen failing with floor pieces left out of the buffer: a rug then took the normal map's relief (stripes on its border).
        it("marks a rug as a receiving floor that takes no relief (alpha 40), never over a picture, and under a piece standing on it", () => {
            const out = newCastBuffer(W, H);
            const rug = piece(BOX, 10, 10, "floor");
            const chair = piece(["##", "##"], 12, 12, "stand");
            bakeCast(input([rug, chair]), out, { contact: false, key: false, lamp: false, surface: false });
            expect(px(out, 10, 10, 3)).toBe(FLOOR_PIECE);
            expect(px(out, 17, 17, 3)).toBe(FLOOR_PIECE);
            expect(px(out, 12, 12, 3)).toBe(255); // the chair on the rug
            expect(px(out, 9, 10, 3)).toBe(0);
            // the order of the pieces does not matter: the chair first, the rug after
            const other = newCastBuffer(W, H);
            bakeCast(input([chair, rug]), other, { contact: false, key: false, lamp: false, surface: false });
            expect(Buffer.from(other).equals(Buffer.from(out))).toBe(true);
        });
    });

    describe("key shadow", () => {
        it("lays a pole's shadow straight down at noon: two bands, umbra nearest the base (golden)", () => {
            const out = newCastBuffer(W, H);
            const noon = keyAt(13); // straight down, length 0.28
            bakeCast(input([piece(POLE, 30, 20)], { key: noon }), out, {
                solid: false,
                contact: false,
                lamp: false,
                surface: false,
            });
            // the pole stands rows 20..29 (its foot is 29, under the pole itself); H = 10, 0.28 -> 2.8 px, scaled up to
            // the floor of 3 px: the umbra is the half of the height nearest the base, the outer band the other half
            const column = [];
            for (let y = 28; y <= 34; y++) column.push(px(out, 30, y, 1));
            expect(column).toEqual([0, 255, 255, 128, 128, 0, 0]);
        });

        it("leans to the lower left in the afternoon and to the lower right in the morning", () => {
            const evening = newCastBuffer(W, H);
            const morning = newCastBuffer(W, H);
            const only = { solid: false, contact: false, lamp: false, surface: false };
            bakeCast(input([piece(POLE, 40, 20)], { key: keyAt(17.4) }), evening, only);
            bakeCast(input([piece(POLE, 40, 20)], { key: keyAt(7.5) }), morning, only);
            const xs = (o: Uint8Array) => [...cellsOf(o, 1)].map((c) => Number(c.split(",")[0]));
            expect(Math.min(...xs(evening))).toBeLessThan(40);
            expect(Math.max(...xs(evening))).toBeLessThanOrEqual(41);
            expect(Math.max(...xs(morning))).toBeGreaterThan(41);
        });

        it("never makes a shadow longer than its cap, nor shorter than its floor", () => {
            const tall = Array.from({ length: 40 }, () => "####");
            const out = newCastBuffer(W, H);
            bakeCast(input([piece(tall, 30, 0)], { key: keyAt(17.4) }), out, {
                solid: false,
                contact: false,
                lamp: false,
                surface: false,
            });
            const cells = [...cellsOf(out, 1)].map((c) => c.split(",").map(Number));
            const tipDown = Math.max(...cells.map(([, y]) => y)) - 39;
            const tipLeft = 30 - Math.min(...cells.map(([x]) => x));
            // along its slope the shadow is 0.6 x 40 = 24 px, held to the cap of 22 (the 1:1 slope: 15 down, 15 left)
            expect(Math.hypot(tipDown, tipLeft)).toBeLessThanOrEqual(22);
            expect(Math.hypot(tipDown, tipLeft)).toBeGreaterThanOrEqual(20);
            const stub = newCastBuffer(W, H);
            bakeCast(input([piece(["##", "##"], 30, 4)], { key: keyAt(13) }), stub, {
                solid: false,
                contact: false,
                lamp: false,
                surface: false,
            });
            const sy = [...cellsOf(stub, 1)].map((c) => Number(c.split(",")[1]));
            expect(Math.max(...sy) - 5).toBeGreaterThanOrEqual(2);
        });

        it("is cast by stand pieces only: top, hang and floor pieces cast nothing", () => {
            for (const kind of ["top", "hang", "floor"] as const) {
                const out = newCastBuffer(W, H);
                bakeCast(input([piece(BOX, 30, 20, kind)]), out, {
                    solid: false,
                    contact: false,
                    lamp: false,
                    surface: false,
                });
                expect(cellsOf(out, 1).size, kind).toBe(0);
            }
        });

        it("stays in the space its object stands in: nothing crosses a thin partition", () => {
            const out = newCastBuffer(W, H);
            const spaces: [number, number, number, number][] = [
                [0, 0, 36, H],
                [36, 0, 44, H],
            ];
            bakeCast(input([piece(POLE, 34, 20)], { key: keyAt(7.5), spaces }), out, {
                solid: false,
                contact: false,
                lamp: false,
                surface: false,
            });
            const xs = [...cellsOf(out, 1)].map((c) => Number(c.split(",")[0]));
            expect(xs.length).toBeGreaterThan(0);
            expect(Math.max(...xs)).toBeLessThan(36);
        });

        it("keeps a garden piece's shadow out of the building and the hall's inside it", () => {
            const building: [number, number, number, number] = [0, 0, 40, H];
            const garden = newCastBuffer(W, H);
            bakeCast(input([piece(POLE, 41, 20)], { key: keyAt(17.4), building }), garden, {
                solid: false,
                contact: false,
                lamp: false,
                surface: false,
            });
            expect(Math.min(...[...cellsOf(garden, 1)].map((c) => Number(c.split(",")[0])))).toBeGreaterThanOrEqual(40);
        });
    });

    describe("contact", () => {
        const only = { solid: false, key: false, lamp: false, surface: false };

        it("puts a hard row under the base and a soft one below it, and a soft rim at the base's sides (golden)", () => {
            const out = newCastBuffer(W, H);
            bakeCast(input([piece(BOX, 30, 20)]), out, only);
            // the box is 8 wide, rows 20..27; foot row 27
            expect([28, 29, 30].map((y) => px(out, 33, y, 2))).toEqual([255, 128, 0]);
            expect(px(out, 29, 28, 2)).toBe(255);
            expect(px(out, 38, 28, 2)).toBe(255);
            expect(px(out, 29, 27, 2)).toBe(128);
            expect(px(out, 29, 25, 2)).toBe(128);
            expect(px(out, 29, 24, 2)).toBe(0);
        });

        it("draws none for a piece whose picture is painted, and none for top, hang and floor pieces", () => {
            const painted = newCastBuffer(W, H);
            bakeCast(input([piece(BOX, 30, 20, "stand", true)]), painted, only);
            expect(cellsOf(painted, 2).size).toBe(0);
            for (const kind of ["top", "hang", "floor"] as const) {
                const out = newCastBuffer(W, H);
                bakeCast(input([piece(BOX, 30, 20, kind)]), out, only);
                expect(cellsOf(out, 2).size, kind).toBe(0);
            }
        });
    });

    describe("surfaces", () => {
        const only = { key: false, contact: false, lamp: false };

        it("rings a piece on furniture with a contact band on the furniture, not on the floor beside it", () => {
            const out = newCastBuffer(W, H);
            const desk = piece(
                Array.from({ length: 10 }, () => "################"),
                20,
                20,
                "stand",
            );
            const mug = piece(["##", "##"], 26, 22, "top");
            bakeCast(input([desk, mug]), out, only);
            expect(px(out, 25, 22, 3)).toBe(128);
            expect(px(out, 25, 22, 2)).toBe(128);
            expect(px(out, 28, 23, 3)).toBe(128);
            expect(px(out, 27, 22, 3)).toBe(255); // the mug itself
            // a top piece at the desk's edge leaves the floor outside the desk alone
            const edge = piece(["##"], 34, 20, "top");
            const out2 = newCastBuffer(W, H);
            bakeCast(input([desk, edge]), out2, only);
            expect(px(out2, 36, 20, 3)).toBe(0);
            expect(px(out2, 36, 20, 2)).toBe(0);
        });

        it("marks the wall around a hanging piece as able to take its shadow, and the floor-less pixels off the wall as nothing", () => {
            const out = newCastBuffer(W, H);
            const frame = piece(
                Array.from({ length: 6 }, () => "######"),
                30,
                10,
                "hang",
            );
            const isWall = (x: number, y: number) => y < 30;
            bakeCast(input([frame], { isWall }), out, only);
            expect(px(out, 29, 11, 3)).toBe(128); // beside it, on the wall
            expect(px(out, 36, 10, 3)).toBe(128); // either side: the key may fall either way
            expect(px(out, 29, 11, 2)).toBe(128); // the ring of contact
            expect(px(out, 30, 16, 3)).toBe(128); // below it
            expect(px(out, 30, 25, 3)).toBe(0); // far below: out of the zone
            const noWall = newCastBuffer(W, H);
            bakeCast(input([frame], { isWall: () => false }), noWall, only);
            expect(cellsOf(noWall, 3, 128).size).toBe(36); // the piece's own pixels only (solid)
        });

        it("drops a hanging piece's shadow on the wall along the key, two bands, and none on a wall with no key", () => {
            const frame = piece(
                Array.from({ length: 6 }, () => "######"),
                30,
                10,
                "hang",
            );
            const isWall = (x: number, y: number) => y < 30;
            const afternoon = newCastBuffer(W, H);
            bakeCast(input([frame], { isWall, key: keyAt(17.4) }), afternoon, { contact: false, lamp: false });
            // the key at 17.4 falls lower-left: the near band 2 px along (1 left, 1 down), the far band 4 (3 left)
            expect(px(afternoon, 29, 12, 1)).toBe(255);
            expect(px(afternoon, 27, 12, 1)).toBe(128);
            expect(px(afternoon, 38, 12, 1)).toBe(0); // the lit side
            const morning = newCastBuffer(W, H);
            bakeCast(input([frame], { isWall, key: keyAt(7.5) }), morning, { contact: false, lamp: false });
            expect(px(morning, 36, 12, 1)).toBe(255);
            expect(px(morning, 37, 12, 1)).toBe(128);
            expect(px(morning, 29, 12, 1)).toBe(0);
            // every shadow pixel is a pixel the static part marked: nothing on the floor, nothing under the piece
            for (const c of cellsOf(afternoon, 1)) {
                const [x, y] = c.split(",").map(Number);
                expect(px(afternoon, x, y, 3), c).toBe(128);
            }
        });

        // The owner asked for ALL the objects to cast: a mug, a lamp or a monitor on a table has a shadow of 2 to 3 px on it.
        it("throws a piece on furniture's shadow of 2 to 3 px on its support, along the key, and never on the floor beside it", () => {
            const desk = piece(
                Array.from({ length: 12 }, () => "################"),
                20,
                20,
                "stand",
            );
            const mug = piece(
                Array.from({ length: 6 }, () => "####"),
                28,
                20,
                "top",
            );
            const out = newCastBuffer(W, H);
            bakeCast(input([desk, mug], { key: keyAt(17.4) }), out, { contact: false, lamp: false });
            // the desk is a standing piece and throws its own shadow on the floor: the mug's is what is on the desk's pixels
            const shadow = [...cellsOf(out, 1)]
                .map((c) => c.split(",").map(Number))
                .filter(([x, y]) => px(out, x, y, 3) !== 0);
            expect(shadow.length).toBeGreaterThan(4);
            // lower-left of the mug (x 28..31, foot row 25), on the desk (x 20..35, y 20..31)
            expect(Math.min(...shadow.map(([x]) => x))).toBeLessThan(28);
            expect(Math.min(...shadow.map(([x]) => x))).toBeGreaterThanOrEqual(25);
            expect(Math.max(...shadow.map(([, y]) => y))).toBeLessThanOrEqual(25 + 3);
            for (const [x, y] of shadow) expect(px(out, x, y, 3), `${x},${y}`).toBe(128);
            // not the mug's own pixels
            expect(px(out, 29, 23, 1)).toBe(0);
        });

        it("keeps a standing piece's shadow off a surface that takes a piece on furniture's: a chair's shadow does not darken the desk", () => {
            const desk = piece(
                Array.from({ length: 12 }, () => "################"),
                20,
                20,
                "stand",
            );
            const mug = piece(["##", "##"], 28, 22, "top");
            const chair = piece(
                Array.from({ length: 10 }, () => "####"),
                36,
                18,
                "stand",
            );
            const out = newCastBuffer(W, H);
            bakeCast(input([desk, mug, chair], { key: keyAt(7.5) }), out, { contact: false, lamp: false });
            // the chair is right of the desk and its shadow leans right, away from it: nothing of the chair's lands on desk pixels
            const alone = newCastBuffer(W, H);
            bakeCast(input([desk, mug], { key: keyAt(7.5) }), alone, { contact: false, lamp: false });
            for (let y = 20; y < 32; y++)
                for (let x = 20; x < 36; x++) expect(px(out, x, y, 1), `${x},${y}`).toBe(px(alone, x, y, 1));
        });
    });

    describe("a shadow starts at its object", () => {
        // Seen failing in the lounge: a bedside table's picture carries a baked pool of light (alpha 130 to 155) under it; read
        // at alpha 128 the pool's lowest row was the foot and the table's shadow floated 16 px below its legs.
        const TABLE = ["..##..", "..##..", "..##..", ".####.", ".#..#."];

        it("keeps the shadow touching the foot, whatever layer of partial alpha the picture carries", () => {
            const width = 8;
            const rows = [...TABLE.map((r) => `.${r}.`), "pppppppp", "pppppppp", ".pppppp."];
            const data = new Uint8ClampedArray(width * rows.length * 4);
            rows.forEach((row, y) => {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    data[i + 3] = row[x] === "#" ? 255 : row[x] === "p" ? SOLID_ALPHA - 60 : 0;
                }
            });
            const lit = silhouetteOf({ data }, width, rows.length);
            expect(lit?.foot).toBe(TABLE.length - 1);
            const stand: BakePiece = { key: "table", x: 30, y: 20, kind: "stand", silhouette: lit, painted: false };
            const out = newCastBuffer(W, H);
            bakeCast(input([stand], { key: keyAt(17.4) }), out, {
                solid: false,
                contact: false,
                lamp: false,
                surface: false,
            });
            const foot = 20 + TABLE.length - 1;
            const cells = [...cellsOf(out, 1)].map((c) => c.split(",").map(Number));
            // the nearest shadow cell to the foot row touches it (a gap of 0 or 1 px), the farthest is within the cap
            const gap = Math.min(...cells.map(([, y]) => Math.abs(y - foot)));
            expect(gap).toBeLessThanOrEqual(1);
        });

        it("starts every stand piece's shadow at its foot, for any hour: the connectivity the lab checks on the map", () => {
            const pieces = [
                piece(POLE, 10, 10),
                piece(BOX, 30, 20),
                piece(["##..##", "######", "#....#"], 50, 8),
                piece(["#"], 70, 40),
            ];
            for (const hour of [7.5, 13, 15.5, 17.4, 22]) {
                for (const p of pieces) {
                    const out = newCastBuffer(W, H);
                    bakeCast(input([p], { key: keyAt(hour) }), out, {
                        solid: false,
                        contact: false,
                        lamp: false,
                        surface: false,
                    });
                    const sil = p.silhouette;
                    if (!sil) throw new Error("no silhouette");
                    const foot = p.y + sil.foot;
                    const touching = [...cellsOf(out, 1)]
                        .map((c) => c.split(",").map(Number))
                        .filter(([, y]) => y <= foot + 1).length;
                    expect(touching, `${p.key} ${p.x},${p.y} at ${hour}`).toBeGreaterThan(0);
                }
            }
        });
    });

    describe("lamps", () => {
        const pool: Light = {
            x: 20,
            y: 30,
            reach: 40,
            color: [1, 0.737, 0.314],
            power: 0.95,
            squash: 0.8,
            clip: null,
            kind: "arc",
            self: false,
            night: false,
            halo: true,
        };
        const lamp: CasterLamp = {
            piece: 0,
            x: 20,
            y: 12,
            z: 42,
            // the spot under the lamp is its widest pool's centre
            gx: 20,
            gy: 48,
            reach: 44,
            squash: 0.6,
            pools: [pool, { ...pool, y: 48, reach: 44, power: 0.6, squash: 0.6 }],
        };
        const lampPiece = piece(["##", "##"], 19, 10, "stand", false, "lamp");
        const only = { solid: false, contact: false, key: false, surface: false };

        it("takes off the pool the light the shader would give those pixels (R = falloff / 1.5): all of it in the near half, 0.6 of it in the far half", () => {
            const out = newCastBuffer(W, H);
            const box = piece(["####", "####", "####", "####", "####", "####"], 30, 28, "stand");
            const stats = bakeCast(input([lampPiece, box], { lamps: [lamp] }), out, only);
            expect(stats.lampsWithShadow).toBe(1);
            const cells = cellsOf(out, 0);
            expect(cells.size).toBeGreaterThan(10);
            let near = 0;
            let far = 0;
            for (const c of cells) {
                const [x, y] = c.split(",").map(Number);
                const light =
                    poolFalloff(lamp.pools[0], x + 0.5, y + 0.5) + poolFalloff(lamp.pools[1], x + 0.5, y + 0.5);
                const full = Math.round(Math.min(1, light / BLOCKED_SCALE) * 255);
                const part = Math.round(Math.min(1, (light * LAMP_FAR_SHARE) / BLOCKED_SCALE) * 255);
                const got = px(out, x, y, 0);
                expect([full, part], c).toContain(got);
                if (got === full) near += 1;
                else far += 1;
            }
            expect(near).toBeGreaterThan(0);
            expect(far).toBeGreaterThan(0);
        });

        it("points away from the spot under the lamp, not from the lamp's head", () => {
            // a box straight left of the spot under the lamp (20, 48) and level with it: its shadow goes left. From the head
            // (20, 12) it would be down and to the left, and it would run into the lit floor below the box.
            const out = newCastBuffer(W, H);
            const box = piece(["####", "####", "####", "####", "####", "####"], 4, 42, "stand");
            bakeCast(input([lampPiece, box], { lamps: [lamp] }), out, only);
            const cells = [...cellsOf(out, 0)].map((c) => c.split(",").map(Number));
            expect(cells.length).toBeGreaterThan(0);
            expect(Math.max(...cells.map(([x]) => x))).toBeLessThanOrEqual(8);
            const rows = cells.map(([, y]) => y);
            expect(Math.max(...rows)).toBeLessThanOrEqual(47 + 1); // it stays level with the box's foot (47), it does not slide down
        });

        it("gives the same caster a shadow strong enough to see: tens of pixels, a quarter or more of the 1.5 the shader can take", () => {
            const out = newCastBuffer(W, H);
            const box = piece(
                Array.from({ length: 20 }, () => "########"),
                34,
                30,
                "stand",
            );
            bakeCast(input([lampPiece, box], { lamps: [lamp] }), out, only);
            const cells = [...cellsOf(out, 0)].map((c) => c.split(",").map(Number));
            expect(cells.length).toBeGreaterThan(20);
            const best = Math.max(...cells.map(([x, y]) => px(out, x, y, 0)));
            expect(best / 255).toBeGreaterThan(0.25);
        });

        it("lists the casters a lamp has: inside the widest pool, in its room, not the lamp, not right under it", () => {
            const inside = piece(["####", "####"], 34, 40, "stand");
            const under = piece(["##", "##"], 18, 46, "stand"); // right under the spot
            const far = piece(["####", "####"], 75, 30, "stand");
            const top = piece(["####", "####"], 30, 40, "top");
            const casters = lampCasters(input([lampPiece, inside, under, far, top], { lamps: [lamp] }), 0);
            expect(casters).toEqual([1]);
        });

        it("points away from the lamp, never covers the lamp's own piece, and skips a caster beyond LAMP_REACH_FACTOR times the widest of the lamp's pools", () => {
            const out = newCastBuffer(W, H);
            const east = piece(["####", "####", "####", "####"], 34, 26, "stand");
            bakeCast(input([lampPiece, east], { lamps: [lamp] }), out, only);
            const xs = [...cellsOf(out, 0)].map((c) => Number(c.split(",")[0]));
            expect(Math.min(...xs)).toBeGreaterThanOrEqual(34); // east of the lamp: the shadow goes further east
            expect(cellsOf(out, 0).has("19,12")).toBe(false);
            const near = piece(["##"], 22, 0, "stand");
            const far = piece(["####", "####"], 75, 30, "stand");
            const none = newCastBuffer(W, H);
            const stats = bakeCast(input([lampPiece, near, far], { lamps: [lamp] }), none, only);
            expect(stats.lampsWithShadow).toBe(0);
        });

        it("reaches a caster out to LAMP_REACH_FACTOR times the widest pool: a table at 1.3 times is listed, one a fifth beyond the factor is not", () => {
            // The reviewers saw the lamp's shadow change under 1% of the reception window, because only what stood inside the
            // pool (1.1 times) threw one. Level ground: the squash only counts in y, so the casters stand east of the spot.
            expect(LAMP_REACH_FACTOR).toBeGreaterThanOrEqual(1.3);
            const narrow: CasterLamp = { ...lamp, reach: 15, pools: [{ ...pool, y: 48, reach: 15 }] }; // the spot is (20, 48)
            const stand = (distance: number): BakePiece => piece(["####", "####"], 20 + distance - 2, 47, "stand");
            const within = stand(Math.round(15 * 1.3)); // foot centre 19.5 px east of the spot
            const beyond = stand(Math.round(15 * (LAMP_REACH_FACTOR + 0.2)));
            expect(lampCasters(input([lampPiece, within], { lamps: [narrow] }), 0)).toEqual([1]);
            expect(lampCasters(input([lampPiece, beyond], { lamps: [narrow] }), 0)).toEqual([]);
        });

        it("does not throw a lamp's shadow from the table that holds the lamp: it came out as a block under the table", () => {
            // The lounge's bedside lamp stands on its table: the table's foot centre is 35 px below the lamp's head, so the
            // shadow from the lamp went straight down for 36 px, the table's width wide (seen in the lab, el-lamp.png).
            const table = piece(
                ["########", "########", "########", "########", "########", "########"],
                16,
                44,
                "stand",
                false,
                "table",
            );
            const lampOnTable = piece(["##", "##", "##", "##"], 19, 42, "top", false, "lamp"); // its foot (row 45) is inside the table's box
            const head: CasterLamp = {
                ...lamp,
                piece: 1,
                x: 20,
                y: 30,
                gx: 20,
                gy: 30,
                reach: 20,
                pools: [{ ...pool, y: 30, reach: 20 }],
            };
            const held = newCastBuffer(W, H);
            const stats = bakeCast(input([table, lampOnTable], { lamps: [head] }), held, only);
            expect(stats.lampsWithShadow).toBe(0);
            expect(carriesLamp(input([table, lampOnTable]), table, table.silhouette as never, head)).toBe(true);
            // the same table with the lamp somewhere else (a lamp on the floor beside it) still casts
            const lampBeside = piece(["##", "##"], 40, 40, "stand", false, "lamp");
            const beside: CasterLamp = {
                ...head,
                piece: 1,
                x: 41,
                y: 30,
                gx: 41,
                gy: 30,
                reach: 40,
                pools: [{ ...pool, x: 41, y: 30, reach: 40 }],
            };
            const stats2 = bakeCast(input([table, lampBeside], { lamps: [beside] }), newCastBuffer(W, H), only);
            expect(stats2.lampsWithShadow).toBe(1);
        });

        it("stays in the lamp's room and adds the shadows of two lamps, clamped at 255", () => {
            const spaces: [number, number, number, number][] = [[0, 0, 44, H]];
            const out = newCastBuffer(W, H);
            const box = piece(["####", "####", "####", "####"], 30, 28, "stand");
            bakeCast(input([lampPiece, box], { lamps: [lamp], spaces }), out, only);
            for (const c of cellsOf(out, 0)) expect(Number(c.split(",")[0])).toBeLessThan(44);
            const two = newCastBuffer(W, H);
            const second: CasterLamp = { ...lamp, piece: 0 };
            bakeCast(input([lampPiece, box], { lamps: [lamp, second] }), two, only);
            const one = newCastBuffer(W, H);
            bakeCast(input([lampPiece, box], { lamps: [lamp] }), one, only);
            const c = [...cellsOf(one, 0)][0].split(",").map(Number);
            expect(px(two, c[0], c[1], 0)).toBe(Math.min(255, 2 * px(one, c[0], c[1], 0)));
        });

        it("is not blocked under a picture: a solid pixel keeps R at 0", () => {
            const out = newCastBuffer(W, H);
            const box = piece(["####", "####", "####", "####"], 30, 28, "stand");
            bakeCast(input([lampPiece, box], { lamps: [lamp] }), out, { contact: false, key: false, surface: false });
            for (const c of cellsOf(out, 3, 255))
                expect(px(out, ...(c.split(",").map(Number) as [number, number]), 0), c).toBe(0);
        });
    });

    // Review of 2026-11-23, the lounge's big plant: a dark patch each side of its pot, the moon's shadow on the left and the lamp's on
    // the right, and a thin tail. At night a piece a lamp reaches has the lamp's shadow as its one shadow, in the key's channel too.
    describe("one shadow at night: a piece near a lamp casts away from the lamp, not away from the moon", () => {
        const pool: Light = {
            x: 20,
            y: 30,
            reach: 40,
            color: [1, 0.737, 0.314],
            power: 0.95,
            squash: 0.8,
            clip: null,
            kind: "arc",
            self: false,
            night: false,
            halo: true,
        };
        const lamp: CasterLamp = {
            piece: 0,
            x: 20,
            y: 12,
            z: 42,
            gx: 20,
            gy: 30,
            reach: 40,
            squash: 0.8,
            pools: [pool],
        };
        const lampPiece = piece(["##", "##"], 19, 10, "stand", false, "lamp");
        const post = piece(POLE, 40, 28, "stand", false, "post"); // east of the lamp: its shadow points east (away)
        const keyOnly = { solid: false, contact: false, lamp: false, surface: false };
        // the shadows of the post (its foot is at row 37); the lamp's own picture, up at row 11, casts its own
        const xs = (o: Uint8Array) =>
            [...cellsOf(o, 1)].filter((c) => Number(c.split(",")[1]) >= 30).map((c) => Number(c.split(",")[0]));

        it("casts its key shadow away from the lamp, not to the moon's lower left", () => {
            const out = newCastBuffer(W, H);
            bakeCast(input([lampPiece, post], { lamps: [lamp], key: keyAt(22) }), out, keyOnly);
            expect(Math.min(...xs(out))).toBeGreaterThanOrEqual(40); // east of the post: the lamp is west of it
            const moon = newCastBuffer(W, H);
            bakeCast(input([lampPiece, post], { lamps: [], key: keyAt(22) }), moon, keyOnly);
            expect(Math.min(...xs(moon))).toBeLessThan(40); // with no lamp the moon's: lower left
        });

        it("gives the key's channel and the lamp's the same shape, so no second shadow shows", () => {
            const out = newCastBuffer(W, H);
            bakeCast(input([lampPiece, post], { lamps: [lamp], key: keyAt(22) }), out, {
                solid: false,
                contact: false,
                surface: false,
            });
            const below = (set: Set<string>): Set<string> =>
                new Set([...set].filter((c) => Number(c.split(",")[1]) >= 30));
            const g = below(cellsOf(out, 1));
            const r = below(cellsOf(out, 0));
            expect(r.size).toBeGreaterThan(5);
            for (const cell of g) expect(r.has(cell), cell).toBe(true);
            for (const cell of r) expect(g.has(cell), cell).toBe(true);
        });

        it("keeps the moon's shadow by day, and for a piece no lamp reaches, whatever the hour", () => {
            const day = newCastBuffer(W, H);
            bakeCast(input([lampPiece, post], { lamps: [lamp], key: keyAt(17.4) }), day, keyOnly);
            expect(Math.min(...xs(day))).toBeLessThan(40); // the sun's: lower left
            const far = piece(POLE, 70, 30, "stand", false, "far");
            const small: CasterLamp = { ...lamp, reach: 20, pools: [{ ...pool, reach: 20 }] };
            const out = newCastBuffer(W, H);
            bakeCast(input([lampPiece, far], { lamps: [small], key: keyAt(22) }), out, keyOnly);
            expect(Math.min(...xs(out))).toBeLessThan(70); // the moon's, lower left: the lamp is 50 px away and its reach 28
        });

        it("makes a lamp's own picture a caster from the spot under its head, an arc lamp's base but not a table lamp's", () => {
            // an arc lamp: the head's light lands at (20, 30), the foot of its picture stands at (46, 38): 26 px off
            const arc = piece(["#", "#", "#", "#", "#", "#", "####"], 44, 32, "stand", false, "arc");
            const self: CasterLamp = { ...lamp, piece: 0, gx: 20, gy: 30 };
            const stats = bakeCast(input([arc], { lamps: [self], key: keyAt(22) }), newCastBuffer(W, H), {
                solid: false,
                contact: false,
                key: false,
                surface: false,
            });
            expect(stats.lampsWithShadow).toBe(1);
            expect(lampCasters(input([arc], { lamps: [self] }), 0)).toEqual([]); // the furniture a lamp casts from: not its own picture
            // its shadow is its base, not its arc: a tall thin arc above the base adds nothing to the shadow's reach
            const tall = piece(
                ["####", "#...", "#...", "#...", "#...", "#...", "#...", "#...", "#...", "#...", "#...", "####"],
                44,
                26,
                "stand",
                false,
                "arc",
            );
            const reach = (p: BakePiece): number => {
                const out = newCastBuffer(W, H);
                bakeCast(input([p], { lamps: [{ ...self, piece: 0 }], key: keyAt(22) }), out, {
                    solid: false,
                    contact: false,
                    key: false,
                    surface: false,
                });
                return cellsOf(out, 0).size;
            };
            const notOwn = reach({ ...tall });
            const sameShapeNotAnOwn = (() => {
                const out = newCastBuffer(W, H);
                // the same picture as another piece (index 1), lamp's own piece is 0: the whole shape casts
                bakeCast(input([lampPiece, tall], { lamps: [{ ...self, piece: 0 }], key: keyAt(22) }), out, {
                    solid: false,
                    contact: false,
                    key: false,
                    surface: false,
                });
                return cellsOf(out, 0).size;
            })();
            expect(notOwn).toBeGreaterThan(0);
            expect(sameShapeNotAnOwn).toBeGreaterThan(notOwn);
            // a table lamp: its foot is under its head
            const table = piece(["##", "##"], 19, 28, "stand", false, "table");
            expect(lampCasters(input([table], { lamps: [{ ...lamp, piece: 0 }] }), 0)).toEqual([]);
        });
    });

    // Review of 2026-11-23: a shelf against a side wall threw its shadow into the wall and a monitor's fell on its desk's own front,
    // so nothing showed. A shadow that mostly does not land is cast again straight down, then to the other side.
    describe("a shadow lands on the floor", () => {
        const shelf = piece(
            Array.from({ length: 16 }, () => "######"),
            30,
            20,
            "stand",
            false,
            "shelf",
        );
        const keyOnly = { solid: true, contact: false, lamp: false, surface: false };

        it("tries straight down and then the other side when the lower-left shadow is all in a wall, and keeps the one that lands", () => {
            const out = newCastBuffer(W, H);
            // the afternoon key points lower-left; the wall fills everything left of x 36 (the shelf stands against it): the first
            // two tries are in the wall, the one to the right lands on the floor
            const isWall = (x: number): boolean => x < 36;
            const stats = bakeCast(input([shelf], { key: keyAt(17.4), isWall }), out, keyOnly);
            expect(stats.keyPixels).toBeGreaterThan(8);
            let floor = 0;
            for (const cell of cellsOf(out, 1)) {
                const [x] = cell.split(",").map(Number);
                if (x >= 36) floor += 1;
            }
            expect(floor).toBeGreaterThan(8);
        });

        it("keeps straight down when that lands and the key's direction does not", () => {
            const out = newCastBuffer(W, H);
            // a wall under the lower-left only (x < 30, y > 35): straight down at x 30..35 is on the floor
            const isWall = (x: number, y: number): boolean => x < 30 && y > 35;
            bakeCast(input([shelf], { key: keyAt(17.4), isWall }), out, keyOnly);
            const xs = [...cellsOf(out, 1)].map((c) => Number(c.split(",")[0]));
            expect(Math.min(...xs)).toBeGreaterThanOrEqual(30);
        });

        it("does not move a shadow that lands: without the wall it keeps the key's direction", () => {
            const out = newCastBuffer(W, H);
            bakeCast(input([shelf], { key: keyAt(17.4) }), out, keyOnly);
            expect(Math.min(...[...cellsOf(out, 1)].map((c) => Number(c.split(",")[0])))).toBeLessThan(30);
        });

        it("does not try again for a shadow of a few pixels (a pole's)", () => {
            const out = newCastBuffer(W, H);
            const isWall = (x: number): boolean => x < 30;
            bakeCast(input([piece(["#", "#", "#"], 30, 20, "stand")], { key: keyAt(17.4), isWall }), out, keyOnly);
            expect(cellsOf(out, 1).size).toBeLessThan(12);
        });
    });

    describe("determinism and slices", () => {
        const pieces = [
            piece(POLE, 10, 10),
            piece(BOX, 30, 20),
            piece(["####", "####"], 50, 8, "top"),
            piece(BOX, 5, 40, "stand", true),
        ];
        it("gives the same bytes on two runs, whatever was in the buffer before", () => {
            const a = newCastBuffer(W, H);
            const b = newCastBuffer(W, H);
            b.fill(77);
            bakeCast(input(pieces), a);
            bakeCast(input(pieces), b);
            expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
        });

        it("gives the same bytes in slices of one caster as in one go, and each slice is bounded", () => {
            const whole = newCastBuffer(W, H);
            bakeCast(input(pieces), whole);
            const sliced = newCastBuffer(W, H);
            const job = new CastBake(input(pieces), sliced);
            let steps = 0;
            while (!job.step(1)) steps += 1;
            expect(steps).toBeGreaterThan(pieces.length);
            expect(Buffer.from(sliced).equals(Buffer.from(whole))).toBe(true);
        });

        it("redoes only the key's channel when only the key changes", () => {
            const out = newCastBuffer(W, H);
            bakeCast(input(pieces, { key: keyAt(13) }), out);
            const before = Uint8Array.from(out);
            const job = new CastBake(input(pieces, { key: keyAt(17.4) }), out, {}, { fixed: false, key: true });
            while (!job.step(64)) {
                // slices
            }
            let others = 0;
            let green = 0;
            for (let i = 0; i < out.length; i += 4) {
                if (out[i] !== before[i] || out[i + 2] !== before[i + 2] || out[i + 3] !== before[i + 3]) others += 1;
                if (out[i + 1] !== before[i + 1]) green += 1;
            }
            expect(others).toBe(0);
            expect(green).toBeGreaterThan(0);
            const full = newCastBuffer(W, H);
            bakeCast(input(pieces, { key: keyAt(17.4) }), full);
            expect(Buffer.from(out).equals(Buffer.from(full))).toBe(true);
        });

        it("refuses a buffer of the wrong size", () => {
            expect(() => new CastBake(input([]), new Uint8Array(10))).toThrow(/bytes/);
        });
    });
});
