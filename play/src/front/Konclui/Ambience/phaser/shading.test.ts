// @vitest-environment jsdom
import * as Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";
import type { EffectsManifest } from "../domain/effectsManifest";
import { newPersonShadow } from "../domain/personShadow";
import type { CastRenderer } from "./castTexture";
import type { MarkRenderer } from "./peopleMark";
import {
    CROWD_SLOTS,
    MARKED_AT_LEVEL_1,
    MARKED_AT_LEVEL_2,
    PICK_EVERY,
    STABLE_MS,
    Shading,
    type PeopleFrame,
    type ShadePlaced,
} from "./shading";

const GL = {
    ONE: 1,
    ZERO: 0,
    ONE_MINUS_SRC_ALPHA: 771,
    FUNC_ADD: 32774,
    CLAMP_TO_EDGE: 33071,
    NEAREST: 9728,
    RGBA: 6408,
};

function renderer() {
    const table: object[] = Array.from({ length: 28 }, () => ({}));
    const textures: { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
    const r = {
        gl: GL,
        blendModes: table,
        addBlendMode: () => table.push({}) - 2,
        updateBlendMode: () => undefined,
        createUint8ArrayTexture: () => {
            const t = { update: vi.fn(), destroy: vi.fn() };
            textures.push(t);
            return t;
        },
    } as unknown as CastRenderer & MarkRenderer;
    return { r, textures };
}

const manifest = (): EffectsManifest => ({
    map: [64, 48],
    water: { rect: [0, 0, 1, 1], glint: [], waterline: [0, 0, 0] },
    lights: {},
    rooms: [],
    ink: [0, 0, 0],
});

function sprite(): Phaser.GameObjects.Sprite & { blendMode: number } {
    const s = Object.create(Phaser.GameObjects.Sprite.prototype) as Phaser.GameObjects.Sprite & { blendMode: number };
    s.blendMode = 0;
    s.setBlendMode = (mode: number) => {
        s.blendMode = mode;
        return s;
    };
    return s;
}

function people(n: number) {
    const bodies = Array.from({ length: n }, () => ({ list: [sprite()], depth: 1 }));
    const persons = Array.from({ length: n }, (_, i) => ({
        x: 10 + i * 5,
        y: 20,
        me: i === 0,
        shadow: newPersonShadow(),
    }));
    return { bodies, persons };
}

function peopleFrame(
    persons: ReturnType<typeof people>["persons"],
    bodies: ReturnType<typeof people>["bodies"],
    centre: [number, number],
    rebuilt = true,
): PeopleFrame {
    return { count: persons.length, people: persons, bodies, rebuilt, pools: [], lamps: 0, centre };
}

function shading(level: 0 | 1 | 2 = 2) {
    const { r, textures } = renderer();
    const s = new Shading({
        renderer: r,
        manifest: manifest(),
        level,
        isWall: () => false,
        readPixels: () => undefined,
    });
    return { s, textures };
}

describe("Shading, the people's marks", () => {
    it("marks everyone when there are no more than the cap, once", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(MARKED_AT_LEVEL_2);
        s.frame(0, peopleFrame(persons, bodies, [0, 0]));
        expect(s.marked).toBe(MARKED_AT_LEVEL_2);
        s.frame(16, peopleFrame(persons, bodies, [0, 0]));
        expect(s.marked).toBe(MARKED_AT_LEVEL_2);
    });

    it("keeps the player's mark and marks the nearest to the view's centre when there are more than the cap", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(60);
        // the view is centred on the last person: the nearest are the last ones
        s.frame(0, peopleFrame(persons, bodies, [persons[59].x, 20]));
        expect(s.marked).toBe(MARKED_AT_LEVEL_2);
        expect(bodies[0].list[0].blendMode).not.toBe(0); // the player, far from the centre, keeps theirs
        expect(bodies[59].list[0].blendMode).not.toBe(0);
        expect(bodies[41].list[0].blendMode).not.toBe(0);
        expect(bodies[40].list[0].blendMode).toBe(0); // the 21st nearest is not marked
        expect(bodies[1].list[0].blendMode).toBe(0);
    });

    it("follows the view: when it moves, the marks move to the people now nearest", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(60);
        s.frame(0, peopleFrame(persons, bodies, [persons[59].x, 20]));
        s.frame(250, peopleFrame(persons, bodies, [persons[5].x, 20]));
        expect(s.marked).toBe(MARKED_AT_LEVEL_2);
        expect(bodies[5].list[0].blendMode).not.toBe(0);
        expect(bodies[59].list[0].blendMode).toBe(0);
        expect(bodies[0].list[0].blendMode).not.toBe(0);
    });

    it("marks fewer at level 1", () => {
        const { s } = shading(1);
        const { bodies, persons } = people(30);
        s.frame(0, peopleFrame(persons, bodies, [100, 20]));
        expect(s.marked).toBe(MARKED_AT_LEVEL_1);
        expect(MARKED_AT_LEVEL_1).toBeLessThan(MARKED_AT_LEVEL_2);
    });

    it("takes every mark off at level 0 and puts them back above it", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(5);
        s.frame(0, peopleFrame(persons, bodies, [0, 0]));
        expect(s.marked).toBe(5);
        s.setLevel(0);
        expect(s.marked).toBe(0);
        for (const b of bodies) expect(b.list[0].blendMode).toBe(0);
        s.frame(16, peopleFrame(persons, bodies, [0, 0], false));
        expect(s.marked).toBe(0); // a level 0 frame marks nothing
        s.setLevel(2);
        s.frame(32, peopleFrame(persons, bodies, [0, 0], false));
        expect(s.marked).toBe(5);
    });

    it("marks a person who arrived since the last look at the next look", () => {
        const { s } = shading(2);
        const first = people(3);
        s.frame(0, peopleFrame(first.persons, first.bodies, [0, 0]));
        const more = people(4);
        more.bodies.splice(0, 3, ...first.bodies);
        more.persons.splice(0, 3, ...first.persons);
        s.frame(16, peopleFrame(more.persons, more.bodies, [0, 0], false));
        expect(more.bodies[3].list[0].blendMode).toBe(0); // not looked at yet
        s.frame(250, peopleFrame(more.persons, more.bodies, [0, 0], true));
        expect(more.bodies[3].list[0].blendMode).not.toBe(0);
    });
});

// Review of 2026-11-23: an avatar drawn in full but carrying no mark (more than 20 drawn) is a pixel of the picture to the shader:
// over a sofa or a desk it took the prop's relief, x1.30 lit or x0.62 dark. The shader is told where the nearest of them stand.
describe("Shading, the unmarked avatars the shader is told about", () => {
    const slot = (s: Shading, k: number): number[] => Array.from(s.crowd.slice(k * 4, k * 4 + 4));

    it("lists nobody while everyone drawn is marked", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(MARKED_AT_LEVEL_2);
        s.frame(0, peopleFrame(persons, bodies, [0, 0]));
        expect(Array.from(s.crowd)).toEqual(new Array(CROWD_SLOTS * 4).fill(0));
    });

    it("lists the feet of the unmarked avatars nearest the view's centre, up to the slots, and ends the list with a zero", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(60);
        s.frame(0, peopleFrame(persons, bodies, [persons[0].x, 20])); // the player and the 19 beside them are marked
        expect(s.marked).toBe(MARKED_AT_LEVEL_2);
        // the unmarked nearest the centre are the next 8 along: indices 20 to 27
        for (let k = 0; k < CROWD_SLOTS; k++) expect(slot(s, k)).toEqual([persons[20 + k].x, 20, 1, 0]);
    });

    it("follows the avatars between rebuilds, and never lists a marked one", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(40);
        s.frame(0, peopleFrame(persons, bodies, [persons[0].x, 20]));
        persons[20].x += 7;
        s.frame(16, peopleFrame(persons, bodies, [persons[0].x, 20], false));
        expect(slot(s, 0)).toEqual([persons[20].x, 20, 1, 0]);
        const listed = new Set<number>();
        for (let k = 0; k < CROWD_SLOTS; k++) listed.add(slot(s, k)[0]);
        for (let i = 0; i < MARKED_AT_LEVEL_2; i++) expect(listed.has(persons[i].x)).toBe(false);
    });

    it("lists fewer when fewer are unmarked, and the rest of the slots read z 0", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(MARKED_AT_LEVEL_2 + 3);
        s.frame(0, peopleFrame(persons, bodies, [persons[0].x, 20]));
        for (let k = 0; k < 3; k++) expect(slot(s, k)[2]).toBe(1);
        for (let k = 3; k < CROWD_SLOTS; k++) expect(slot(s, k)).toEqual([0, 0, 0, 0]);
    });

    it("empties the list at level 0, and writes it into the pass's record as uCrowd[0]", () => {
        const { s } = shading(2);
        const { bodies, persons } = people(40);
        s.frame(0, peopleFrame(persons, bodies, [persons[0].x, 20]));
        const record: Record<string, unknown> = {};
        s.uniformsInto(record as never);
        expect(record["uCrowd[0]"]).toBe(s.crowd);
        s.setLevel(0);
        expect(Array.from(s.crowd)).toEqual(new Array(CROWD_SLOTS * 4).fill(0));
    });
});

describe("Shading, the manifest's casters", () => {
    const KEY = "bench.png";
    const flat: ShadePlaced = {
        texture: { key: `maps/entities/${KEY}`, getSourceImage: () => ({}) },
        x: 40,
        y: 20,
        flipX: false,
        displayWidth: 30,
        displayHeight: 40,
    };
    const empty = (): PeopleFrame => ({
        count: 0,
        people: [],
        bodies: [],
        rebuilt: false,
        pools: [],
        lamps: 0,
        centre: [0, 0],
    });
    const make = (casters?: EffectsManifest["casters"]) => {
        const { r } = renderer();
        const base = manifest();
        return new Shading({
            renderer: r,
            manifest: { ...base, map: [120, 100], ...(casters ? { casters } : {}) },
            level: 2,
            isWall: () => false,
            readPixels: () => ({ width: 30, height: 40, data: new Uint8ClampedArray(30 * 40 * 4).fill(255) }),
        });
    };
    const bakeAll = (s: Shading, from = 0): number => {
        const before = s.bakes;
        let t = from;
        while (s.bakes === before && t < from + 20_000) s.frame((t += 16), empty());
        return t;
    };
    /** The lowest map row below the bench's own picture that the key's channel marks. */
    const lowest = (s: Shading): number => {
        let low = -1;
        for (let y = 0; y < 100; y++)
            for (let x = 0; x < 120; x++)
                if (
                    s.cast.pixels[((100 - 1 - y) * 120 + x) * 4 + 1] > 0 &&
                    s.cast.pixels[((100 - 1 - y) * 120 + x) * 4 + 3] !== 255
                )
                    low = y;
        return low;
    };

    it("bakes a piece with an entry by its h, and a piece without one by its rows", () => {
        const plain = make();
        plain.setHour(15.5);
        plain.setPieces([flat], 0, true);
        bakeAll(plain);
        const benched = make({ [KEY]: { h: 10 } });
        benched.setHour(15.5);
        benched.setPieces([flat], 0, true);
        bakeAll(benched);

        expect(lowest(plain)).toBeGreaterThan(20 + 39 + 10);
        expect(lowest(benched)).toBeLessThanOrEqual(20 + 39 + 5);
        expect(lowest(benched)).toBeGreaterThanOrEqual(20 + 39);
    });

    it("keeps a piece the manifest has no entry for as it was, whatever the other entries say", () => {
        const plain = make();
        plain.setHour(15.5);
        plain.setPieces([flat], 0, true);
        bakeAll(plain);
        const other = make({ "other.png": { h: 4 } });
        other.setHour(15.5);
        other.setPieces([flat], 0, true);
        bakeAll(other);

        expect(Buffer.from(other.cast.pixels).equals(Buffer.from(plain.cast.pixels))).toBe(true);
    });

    it("bakes again, key and fixed parts, when the casters change, and not when they are the same", () => {
        const s = make({ [KEY]: { h: 10 } });
        s.setHour(15.5);
        s.setPieces([flat], 0, true);
        let t = bakeAll(s);
        const first = Buffer.from(s.cast.pixels);
        const shallow = lowest(s);

        expect(s.setCasters({ [KEY]: { h: 10 } })).toBe(false);
        for (let u = 0; u < 200; u++) s.frame((t += 16), empty());
        expect(s.bakes).toBe(1);

        expect(s.setCasters({ [KEY]: { h: 22 } })).toBe(true);
        t = bakeAll(s, t);
        expect(s.bakes).toBe(2);
        expect(lowest(s)).toBeGreaterThan(shallow);
        expect(Buffer.from(s.cast.pixels).equals(first)).toBe(false);

        expect(s.setCasters(undefined)).toBe(true);
        bakeAll(s, t);
        expect(s.bakes).toBe(3);
    });

    it("drops a bake in progress when the casters change under it, and finishes with the new ones", () => {
        const s = make({ [KEY]: { h: 10 } });
        s.setHour(15.5);
        s.setPieces([flat], 0, true);
        s.frame(0, empty());
        s.frame(16, empty());
        s.setCasters({ [KEY]: { h: 22 } });
        const t = bakeAll(s, 32);
        const reference = make({ [KEY]: { h: 22 } });
        reference.setHour(15.5);
        reference.setPieces([flat], 0, true);
        bakeAll(reference);

        expect(s.bakes).toBe(1);
        expect(t).toBeGreaterThan(32);
        expect(Buffer.from(s.cast.pixels).equals(Buffer.from(reference.cast.pixels))).toBe(true);
    });
});

describe("Shading, the bake's schedule", () => {
    const piece = (key: string, x: number, y: number): ShadePlaced => ({
        texture: { key: `maps/entities/${key}`, getSourceImage: () => ({}) },
        x,
        y,
        flipX: false,
        displayWidth: 4,
        displayHeight: 4,
    });
    const empty = (): PeopleFrame => ({
        count: 0,
        people: [],
        bodies: [],
        rebuilt: false,
        pools: [],
        lamps: 0,
        centre: [0, 0],
    });
    const withPixels = () => {
        const { r, textures } = renderer();
        const s = new Shading({
            renderer: r,
            manifest: manifest(),
            level: 2,
            isWall: () => false,
            readPixels: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }),
        });
        return { s, textures };
    };

    it("bakes once the first time and not again while nothing changes", () => {
        const { s, textures } = withPixels();
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        for (let t = 0; t < 600; t++) s.frame(t * 16, empty());
        expect(s.bakes).toBe(1);
        expect(textures[0].update).toHaveBeenCalledTimes(1);
    });

    it("waits STABLE_MS after a change to a piece, and bakes only after", () => {
        const { s } = withPixels();
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        for (let t = 0; t < 400; t++) s.frame(t * 16, empty());
        expect(s.bakes).toBe(1);
        const at = 400 * 16;
        s.setPieces([piece("a.png", 14, 10)], at);
        for (let t = at; t < at + STABLE_MS - 20; t += 16) s.frame(t, empty());
        expect(s.bakes).toBe(1);
        for (let t = at + STABLE_MS; t < at + STABLE_MS + 4000; t += 16) s.frame(t, empty());
        expect(s.bakes).toBe(2);
    });

    it("restarts the bake when pieces change in the middle of one, and still finishes it", () => {
        const { s } = withPixels();
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        s.frame(0, empty());
        s.frame(16, empty());
        s.setPieces([piece("a.png", 20, 10), piece("b.png", 30, 10)], 32, true);
        for (let t = 48; t < 4000; t += 16) s.frame(t, empty());
        expect(s.bakes).toBe(1);
    });

    it("uploads at most once every 250 ms: a second bake waits for the throttle", () => {
        const { s, textures } = withPixels();
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        let t = 0;
        while (s.bakes < 1) s.frame((t += 16), empty());
        const done = t;
        s.setHour(17.4); // another key state: a second, key-only bake
        for (let u = 0; u < 10; u++) s.frame((t += 16), empty());
        expect(textures[0].update).toHaveBeenCalledTimes(s.bakes);
        while (s.bakes < 2 && t < done + 5000) s.frame((t += 16), empty());
        expect(t - done).toBeGreaterThanOrEqual(0);
        expect(s.bakes).toBe(2);
    });

    it("counts for the frame probe: bakes, slices, uploads and their bytes, level changes and marks", () => {
        const { s } = withPixels();
        expect(s.counters()).toEqual({
            bakes: 0,
            slices: 0,
            uploads: 0,
            uploadedBytes: 0,
            levelChanges: 0,
            level: 2,
            marked: 0,
        });
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        for (let t = 0; t < 600; t++) s.frame(t * 16, empty());
        s.setLevel(1);
        s.setLevel(1); // not a change
        const counters = s.counters();

        expect(counters).toMatchObject({ bakes: 1, uploads: 1, uploadedBytes: 64 * 48 * 4, levelChanges: 1, level: 1 });
        expect(counters.slices).toBe(s.slices);
        expect(counters.slices).toBeGreaterThan(0);
    });

    it("counts a second bake and a second upload when the hour crosses into another key state", () => {
        const { s } = withPixels();
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        let t = 0;
        while (s.bakes < 1) s.frame((t += 16), empty());
        const day = s.counters();
        s.setHour(19.3);
        while (s.bakes < 2 && t < 10_000) s.frame((t += 16), empty());
        const night = s.counters();

        expect(night.bakes - day.bakes).toBe(1);
        expect(night.uploads - day.uploads).toBe(1);
        expect(night.uploadedBytes - day.uploadedBytes).toBe(64 * 48 * 4);
    });

    it("paces the picks of a moving person: one in PICK_EVERY frames each", () => {
        expect(PICK_EVERY).toBeGreaterThan(1);
    });

    it("treats a piece whose picture cannot be read as one that casts nothing, and makes no shadow for it", () => {
        const { r } = renderer();
        const s = new Shading({
            renderer: r,
            manifest: manifest(),
            level: 2,
            isWall: () => false,
            readPixels: () => undefined,
        });
        s.setHour(12);
        s.setPieces([piece("a.png", 10, 10)], 0, true);
        for (let t = 0; t < 600; t++) s.frame(t * 16, empty());
        expect(s.bakes).toBe(1);
        const px = (x: number, y: number, c: number) => s.cast.pixels[((48 - 1 - y) * 64 + x) * 4 + c];
        expect(px(11, 14, 1)).toBe(0);
        expect(px(11, 11, 3)).toBe(0);
    });

    it("ignores the effects' own images (a TV's slide) among the scene's children", () => {
        const { s } = withPixels();
        s.setHour(12);
        s.setPieces(
            [
                piece("a.png", 10, 10),
                { ...piece("x", 20, 20), texture: { key: "kfx-1-tv-slide", getSourceImage: () => ({}) } },
            ],
            0,
            true,
        );
        for (let t = 0; t < 600; t++) s.frame(t * 16, empty());
        expect(s.measures).toBe(1);
    });
});
