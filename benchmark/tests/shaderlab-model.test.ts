import { describe, expect, it } from "vitest";
import { frameCandidates, presetsToRun, safeJoin, slug, contentType } from "../shader-lab/files";
import {
    AVATAR_H,
    AVATAR_W,
    PRESETS,
    avatarCells,
    compileFailure,
    diffImage,
    diffStats,
    drawPeople,
    flipRows,
    forProbe,
    isSoftwareRenderer,
    percentile,
    resolveHour,
    rimMode,
    shaderErrors,
    summarizeTimes,
    viewRect,
} from "../shader-lab/model";
import { folderOf, paintOrder, placementsOf, type Collection, type Wam } from "../shader-lab/placements";
import { mapLights, postUniforms, shadeUniforms, type ManifestSlice } from "../shader-lab/uniforms";

const MAP: [number, number] = [2752, 1792];

describe("shader lab: presets and views", () => {
    it("keeps every preset's window and people inside the map", () => {
        for (const [name, preset] of Object.entries(PRESETS)) {
            const [x, y, w, h] = viewRect(preset.camera, { width: 960, height: 540 });
            expect(x, name).toBeGreaterThanOrEqual(0);
            expect(y, name).toBeGreaterThanOrEqual(0);
            expect(x + w, name).toBeLessThanOrEqual(MAP[0]);
            expect(y + h, name).toBeLessThanOrEqual(MAP[1] + 100);
            expect(preset.people.length, name).toBeGreaterThan(0);
            for (const p of preset.people) {
                expect(p.x, name).toBeGreaterThanOrEqual(7);
                expect(p.y, name).toBeGreaterThanOrEqual(AVATAR_H);
                expect(p.x, name).toBeLessThan(MAP[0]);
                expect(p.y, name).toBeLessThan(MAP[1]);
            }
        }
    });

    it("computes the world rectangle of a window from its centre and zoom", () => {
        expect(viewRect({ x: 1000, y: 500, zoom: 2 }, { width: 960, height: 540 })).toEqual([760, 365, 480, 270]);
        expect(viewRect({ x: 100.5, y: 50, zoom: 0.5 }, { width: 100, height: 40 })).toEqual([0.5, 10, 200, 80]);
    });

    it("reads the hour from --hour, then konclui.fx.hour, then night", () => {
        expect(resolveHour(12.5, { "konclui.fx.hour": "3" })).toBe(12.5);
        expect(resolveHour(undefined, { "konclui.fx.hour": "19.3" })).toBe(19.3);
        expect(resolveHour(undefined, {})).toBe(22);
        expect(() => resolveHour(undefined, { "konclui.fx.hour": "x" })).toThrow(/0 to 24/);
    });

    it("reads konclui.fx.rim as the client does", () => {
        expect(rimMode({})).toBe("off");
        expect(rimMode({ "konclui.fx.rim": "0" })).toBe("off");
        expect(rimMode({ "konclui.fx.rim": "1" })).toBe("on");
        expect(rimMode({ "konclui.fx.rim": "legacy" })).toBe("legacy");
        expect(rimMode({ "konclui.fx.rim": "full" })).toBe("full");
        expect(() => rimMode({ "konclui.fx.rim": "maybe" })).toThrow(/must be 0, 1/);
    });

    it("picks presets", () => {
        expect(presetsToRun(undefined)).toEqual(["reception"]);
        expect(presetsToRun("all")).toEqual(Object.keys(PRESETS));
        expect(presetsToRun("lounge")).toEqual(["lounge"]);
        expect(() => presetsToRun("kitchen")).toThrow(/unknown preset "kitchen"/);
    });
});

describe("shader lab: synthetic people", () => {
    it("draws a 14x26 avatar with an outline, a head, a torso and two legs", () => {
        const cells = avatarCells();

        expect(cells.length).toBe(AVATAR_W * AVATAR_H);
        const count = (v: number) => cells.filter((c) => c === v).length;
        expect(count(1)).toBeGreaterThan(30);
        expect(count(2)).toBeGreaterThan(6);
        expect(count(3)).toBeGreaterThan(20);
        expect(count(4)).toBeGreaterThan(6);
        // the legs are two separate stripes on the last row
        const lastRow = Array.from(cells.slice((AVATAR_H - 1) * AVATAR_W)).map((c) => c !== 0);
        expect(lastRow.filter(Boolean).length).toBe(6);
        expect(lastRow[6]).toBe(false);
    });

    it("writes alpha 0 on body pixels when marked and 255 when not, feet on the row below the body", () => {
        const w = 40;
        const h = 60;
        const marked = new Uint8ClampedArray(w * h * 4).fill(200);
        const plain = new Uint8ClampedArray(w * h * 4).fill(200);

        const drawn = drawPeople(marked, w, h, [{ x: 20, y: 40 }], true);
        drawPeople(plain, w, h, [{ x: 20, y: 40 }], false);

        const zeros = marked.filter((_, i) => i % 4 === 3 && marked[i] === 0).length;
        expect(zeros).toBe(drawn.pixels[0]);
        expect(zeros).toBeGreaterThan(80);
        expect(plain.filter((_, i) => i % 4 === 3 && plain[i] !== 255 && plain[i] !== 200).length).toBe(0);
        // the foot row is y 39, the row under it (y 40) is untouched
        for (let x = 0; x < w; x++) expect(marked[(40 * w + x) * 4 + 3]).toBe(200);
        expect(Array.from({ length: w }, (_, x) => marked[(39 * w + x) * 4 + 3]).some((a) => a === 0)).toBe(true);
    });

    it("clips a person at the frame's edge instead of wrapping", () => {
        const w = 20;
        const h = 30;
        const frame = new Uint8ClampedArray(w * h * 4).fill(9);

        expect(() => drawPeople(frame, w, h, [{ x: 2, y: 10 }], true)).not.toThrow();
        // the left of the body is cut off at column 0 and nothing wrapped round to the right edge, on any row
        expect(frame[(5 * w + 0) * 4 + 3]).toBe(0);
        for (let y = 0; y < h; y++) expect(frame[(y * w + w - 1) * 4 + 3]).toBe(9);
    });
});

describe("shader lab: picture comparison", () => {
    const a = new Uint8ClampedArray([10, 10, 10, 255, 100, 100, 100, 255, 0, 0, 0, 255]);

    it("counts what changed above the GPU's rounding and reports the largest delta", () => {
        const b = new Uint8ClampedArray([11, 10, 12, 255, 160, 100, 100, 255, 0, 0, 0, 255]);

        const stats = diffStats(a, b);

        expect(stats).toEqual({ pixels: 3, changed: 1, changedShare: 1 / 3, maxDelta: 60 });
        expect(diffStats(a, a)).toMatchObject({ changed: 0, maxDelta: 0 });
    });

    it("limits the count to a region when asked", () => {
        const b = new Uint8ClampedArray([90, 10, 10, 255, 190, 100, 100, 255, 0, 0, 0, 255]);

        expect(diffStats(a, b, 2, (p) => p === 1)).toMatchObject({ pixels: 1, changed: 1 });
    });

    it("paints changed pixels red over the off picture dimmed to 40%", () => {
        const b = new Uint8ClampedArray([10, 10, 10, 255, 200, 100, 100, 255, 0, 0, 0, 255]);

        const image = diffImage(a, b);

        expect(Array.from(image.slice(0, 4))).toEqual([4, 4, 4, 255]);
        expect(Array.from(image.slice(4, 8))).toEqual([255, 20, 20, 255]);
    });

    it("refuses pictures of different sizes", () => {
        expect(() => diffStats(a, new Uint8ClampedArray(4))).toThrow(/differ in size/);
        expect(() => diffImage(a, new Uint8ClampedArray(4))).toThrow(/differ in size/);
    });

    it("flips rows and can force the alpha opaque", () => {
        const rgba = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]);

        const flipped = flipRows(rgba, 1, 2, true);

        expect(Array.from(flipped)).toEqual([2, 0, 0, 255, 1, 0, 0, 255]);
    });
});

describe("shader lab: timing numbers", () => {
    it("uses the nearest-rank percentile", () => {
        const sorted = Array.from({ length: 100 }, (_, i) => i + 1);

        expect(percentile(sorted, 50)).toBe(50);
        expect(percentile(sorted, 99)).toBe(99);
        expect(percentile(sorted, 100)).toBe(100);
        expect(percentile([], 50)).toBeNaN();
    });

    it("summarises samples in any order and says nothing for none", () => {
        const stats = summarizeTimes([5, 1, 3, 2, 4]);

        expect(stats).toEqual({ count: 5, mean: 3, median: 3, p95: 5, p99: 5, max: 5 });
        expect(summarizeTimes([])).toBeNull();
    });

    it("calls a software renderer invalid and a Metal one valid", () => {
        expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)")).toBe(true);
        expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
        expect(isSoftwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)")).toBe(
            false,
        );
    });
});

describe("shader lab: shader diagnostics", () => {
    const source = [
        "#pragma phaserTemplate(shaderName)",
        "precision highp float;",
        "void main() {",
        "  gl_FragColor = vec4(oops);",
        "}",
    ].join("\n");

    it("keeps the pragma line's place when it strips it", () => {
        const stripped = forProbe(source);

        expect(stripped.split("\n")).toHaveLength(5);
        expect(stripped.split("\n")[0]).toBe("");
        expect(stripped).not.toContain("phaserTemplate");
    });

    it("reads an ANGLE log into the offending line with its neighbours", () => {
        const log =
            "ERROR: 0:4: 'oops' : undeclared identifier\nERROR: 0:4: 'constructor' : not enough data provided\n";

        const errors = shaderErrors(log, forProbe(source));

        expect(errors).toHaveLength(2);
        expect(errors[0].line).toBe(4);
        expect(errors[0].message).toBe("'oops' : undeclared identifier");
        expect(errors[0].excerpt).toContain(">    4 |   gl_FragColor = vec4(oops);");
        expect(errors[0].excerpt).toContain("     3 | void main() {");
    });

    it("fails with the driver's own words and the line it points at", () => {
        const message = compileFailure(
            "POST",
            "compile",
            "ERROR: 0:4: 'oops' : undeclared identifier",
            forProbe(source),
        );

        expect(message).toContain('shader "POST" does not compile');
        expect(message).toContain("'oops' : undeclared identifier");
        expect(message).toContain("gl_FragColor = vec4(oops);");
    });

    it("still says something when the log has no line numbers", () => {
        expect(compileFailure("X", "link", "Fragment shader uses too many uniforms", "")).toContain("does not link");
    });
});

describe("shader lab: the built map's pieces", () => {
    const wam: Wam = {
        entityCollections: [{ url: "entities/mobilia/collection.json" }, { url: "entities/konclui/collection.json" }],
        entities: {
            a: { x: 10, y: 20, name: "Mesa", prefabRef: { collectionName: "Mobília", id: "m1" } },
            b: { x: 30, y: 40, prefabRef: { collectionName: "Koncluí", id: "k1" } },
            c: { x: 0, y: 0, prefabRef: { collectionName: "Koncluí", id: "gone" } },
            d: { x: 0, y: 0 },
        },
    };
    const collections: Collection[] = [
        {
            collectionName: "Mobília",
            collection: [
                {
                    id: "m1",
                    name: "Mesa de escritório",
                    imagePath: "sprites/a/m1.png",
                    depthOffset: -13,
                    tags: ["Mesas"],
                },
            ],
        },
        { collectionName: "Koncluí", collection: [{ id: "k1", name: "Luminária", imagePath: "sprites/k1.png" }] },
    ];

    it("keys each piece by its path under entities/ and counts the prefabs it could not find", () => {
        const { placements, unknown } = placementsOf(wam, collections);

        expect(unknown).toBe(2);
        expect(placements).toEqual([
            { key: "mobilia/sprites/a/m1.png", x: 10, y: 20, name: "Mesa", depthOffset: -13, tags: ["Mesas"] },
            { key: "konclui/sprites/k1.png", x: 30, y: 40, name: "Luminária", depthOffset: 0, tags: [] },
        ]);
    });

    it("reads the folder from the collection url and refuses an odd one", () => {
        expect(folderOf("entities/escritorio-moderno/collection.json")).toBe("escritorio-moderno");
        expect(() => folderOf("https://x/y.json")).toThrow(/under entities/);
    });

    it("paints by foot line plus depth offset, so a flat piece goes under what stands on it", () => {
        const { placements } = placementsOf(wam, collections);
        const heights = new Map([
            ["mobilia/sprites/a/m1.png", 64],
            ["konclui/sprites/k1.png", 16],
        ]);

        // the table's foot line is 20 + 64 - 13 = 71, the lamp's 40 + 16 = 56: the lamp is painted first
        expect(paintOrder(placements, heights).map((p) => p.name)).toEqual(["Luminária", "Mesa"]);
        expect(paintOrder(placements, new Map()).map((p) => p.name)).toEqual(["Mesa", "Luminária"]);
    });
});

describe("shader lab: the driver's helpers", () => {
    it("looks for the whole-map render beside the build and in the matching renders directory", () => {
        expect(frameCandidates("/tmp/kv/dist2")).toEqual([
            "/tmp/kv/dist2/preview.png",
            "/tmp/kv/dist2/fx/preview.png",
            "/tmp/kv/renders2/preview.png",
        ]);
        expect(frameCandidates("/tmp/build")).toHaveLength(2);
    });

    it("serves nothing outside the map directory", () => {
        expect(safeJoin("/srv/map", "/fx/manifest.json")).toBe("/srv/map/fx/manifest.json");
        expect(safeJoin("/srv/map", "/../secret")).toBeNull();
        expect(safeJoin("/srv/map", "/%2e%2e/secret")).toBeNull();
        expect(safeJoin("/srv/map", "/a/%E0%A4%A")).toBeNull();
    });

    it("names content types and directories", () => {
        expect(contentType("a/b.png")).toBe("image/png");
        expect(contentType("office.wam")).toBe("application/json");
        expect(contentType("x.bin")).toBe("application/octet-stream");
        expect(slug("19.3 pm!")).toBe("19-3-pm");
    });
});

describe("shader lab: uniforms from the runtime's pure code", () => {
    // two arc lamps (the real manifest's kind), one inside a room
    const manifest: ManifestSlice = {
        map: MAP,
        lights: { "mobilia/lamp.png": { kind: "arc", w: 64, h: 64, foot: [16, 63], head: [42, 18] } },
        spaces: [[0, 0, 500, 500]],
        staticLights: [],
        ink: [10, 20, 30],
    };
    const placements = [{ key: "mobilia/lamp.png", x: 100, y: 100, name: "Lamp", depthOffset: 0, tags: [] }];

    it("finds the lamp's pools from the placement and the manifest", () => {
        const lights = mapLights(manifest, placements);

        expect(lights.pools.length).toBeGreaterThan(0);
        expect(lights.pools[0].x).toBeGreaterThan(100);
        expect(lights.pools[0].clip).toEqual([0, 0, 500, 500]);
    });

    const input = (hour: number) => ({
        manifest,
        lights: mapLights(manifest, placements),
        hour,
        view: [0, 0, 480, 270] as const,
        resolution: [960, 540] as const,
        people: [{ x: 120, y: 160 }],
        clouds: true,
        rim: 1 as const,
        normalsOn: 1 as const,
    });

    it("lights the pool at night, packed as the shader reads it, and not by day", () => {
        const night = postUniforms(input(22));
        const day = postUniforms(input(12.5));

        expect(night.values.uLN).toBeGreaterThan(0);
        expect((night.values["uL[0]"] as Float32Array)[0]).toBeGreaterThan(100);
        // an arc lamp also glows: a negative reach on each of its three pools (the lights are sorted nearest first)
        const L = night.values["uL[0]"] as Float32Array;
        const reaches = [0, 1, 2].map((i) => L[i * 4 + 2]).sort((x, y) => x - y);
        expect(reaches).toEqual([-96, -80, -44]);
        const LC = night.values["uLC[0]"] as Float32Array;
        const powers = [0, 1, 2].map((i) => LC[i * 4 + 3]).sort((x, y) => x - y);
        [0.45, 0.6, 0.95].forEach((power, i) => expect(powers[i]).toBeCloseTo(power, 5));
        expect(Array.from((night.values["uLClip[0]"] as Float32Array).slice(0, 4))).toEqual([0, 0, 500, 500]);
        expect(night.values.uNight).toBe(1);
        expect(day.values.uLN).toBe(0);
        expect(day.values.uNight).toBe(0);
    });

    it("hands the people's feet and the switches to the program that wants them", () => {
        const { values } = postUniforms(input(22));

        expect(values.uPeopleN).toBe(1);
        expect(Array.from((values["uPeople[0]"] as Float32Array).slice(0, 2))).toEqual([120, 160]);
        expect(values.uRimOn).toBe(1);
        expect(values.uNormalsOn).toBe(1);
        expect(values.uWorld).toEqual([0, 0, 480, 270]);
        expect(values.uInk).toEqual([10 / 255, 20 / 255, 30 / 255]);
    });

    it("falls back to the lab's constants, and says so, when the runtime's modules are not there", () => {
        const { look } = postUniforms(input(22));

        const shade = shadeUniforms(2, 22, look, undefined);

        expect(shade.source).toMatch(/lab constants/);
        expect(shade.values.uShade).toEqual([2, 0.42, 0.6, 0.9]);
        expect(shade.key).toBeNull();
    });

    it("reports a failing runtime hook instead of throwing", () => {
        const { look } = postUniforms(input(22));
        const hooks = {
            keyLightAt: () => {
                throw new Error("boom");
            },
            newKeyLight: () => ({ dirIndex: 0, length: 0, strength: 0 }),
            newShadeUniforms: () => ({ shade: [], key: [], keyShade: [] }),
            shadeUniformsInto: () => undefined,
        };

        const shade = shadeUniforms(1, 22, look, hooks);

        expect(shade.notes.join(" ")).toMatch(/failed .*boom/);
        expect(shade.source).toMatch(/lab constants/);
    });
});
