/**
 * Runs the shader lab for real: Chrome through Playwright, the built map, the repository's own shaders. It needs a built
 * map with fx/ (SHADER_LAB_DIST, default /private/tmp/kv/dist2) and an installed Google Chrome; without either it skips
 * and the skip says which one is missing.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../shader-lab/run";

const DIST = process.env.SHADER_LAB_DIST ?? "/private/tmp/kv/dist2";
const CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

function skipReason(): string | null {
    if (!existsSync(join(DIST, "fx", "manifest.json"))) {
        return `no built map at ${DIST} (set SHADER_LAB_DIST to a directory with fx/manifest.json)`;
    }
    if (!CHROME_PATHS.some((path) => existsSync(path))) return "Google Chrome is not installed";
    return null;
}

const reason = skipReason();
if (reason !== null) console.warn(`shader lab smoke test skipped: ${reason}`);

const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporary(): string {
    const directory = mkdtempSync(join(tmpdir(), "shader-lab-"));
    directories.push(directory);
    return directory;
}

describe.skipIf(reason !== null)(`shader lab on a built map${reason === null ? "" : ` (skipped: ${reason})`}`, () => {
    it("draws off, on and the difference, passes its self-test and compiles the real programs", async () => {
        const out = temporary();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const code = await main([DIST, "--out", out, "--preset", "reception", "--size", "320x180", "--no-timing"]);

        expect(code).toBe(0);
        for (const name of ["off.png", "on.png", "diff.png", "sheet.png", "stats.json", "timing.json", "log.txt"]) {
            expect(existsSync(join(out, name)), name).toBe(true);
        }
        const png = readFileSync(join(out, "on.png"));
        expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
        const stats = JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as {
            selfTest: { pass: boolean };
            variants: { on: { changedShare: number } };
            glError: number;
        };
        expect(stats.selfTest.pass).toBe(true);
        expect(stats.variants.on.changedShare).toBeGreaterThan(0);
        expect(stats.glError).toBe(0);
        const timing = JSON.parse(readFileSync(join(out, "timing.json"), "utf8")) as { compile: { status: string }[] };
        const compile = timing.compile;
        expect(compile.length).toBeGreaterThanOrEqual(1);
        expect(compile.every((entry) => entry.status === "ok")).toBe(true);
    }, 120_000);

    // What the reviewers found by looking, as numbers (the lab's pictures stay the judge of the look): a person beside a lamp was
    // lit on the far side from it, and a table's shadow floated under its legs.
    it("lights a person on the side that faces the lamp, and gives every standing piece a shadow that starts at its foot", async () => {
        const out = temporary();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        // an arc lamp's spot under it is (1172, 1383) on the built office; a person 40 px to its right and one 40 px to its left
        const code = await main([
            DIST,
            "--out",
            out,
            "--camera",
            "1172,1383,3",
            "--people",
            "1212,1383;1132,1383",
            "--hour",
            "22",
            "--size",
            "320x180",
            "--no-timing",
        ]);
        expect(code).toBe(0);
        const stats = JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as {
            variants: { on: { personSides?: { lamp: string | null; litSide: string | null }[] } };
            bake?: { floatingShadows?: unknown[]; topsWithoutShadow?: unknown[]; hangsWithoutShadow?: unknown[] };
        };
        const sides = stats.variants.on.personSides;
        if (sides === undefined) return; // a tree without the shaded program has no people light to look at
        expect(sides[0]).toMatchObject({ lamp: "left", litSide: "left" }); // the lamp is on their left: lit on the left
        expect(sides[1]).toMatchObject({ lamp: "right", litSide: "right" });
        expect(stats.bake?.floatingShadows ?? []).toEqual([]);
        expect(stats.bake?.topsWithoutShadow ?? []).toEqual([]);
        expect(stats.bake?.hangsWithoutShadow ?? []).toEqual([]);
    }, 120_000);

    // The owner asked for shadows cast from the lamps and the reviewers measured 0.39% of a window at a delta of 20: the lamp
    // element alone must change at least 1% of a window around a lamp that has casters, by 50 or more, and a flat normal (the
    // inside of a table top, a lamp) must come out of the relief as it went in.
    it("makes a lamp's shadow evident around a lamp with casters, and leaves a flat normal alone", async () => {
        const out = temporary();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const code = await main([DIST, "--out", out, "--preset", "lounge", "--hour", "22", "--no-timing"]);
        expect(code).toBe(0);
        const stats = JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as {
            acceptance?: {
                lampShadow: {
                    meets: boolean | null;
                    casterLampsInView: number;
                    changedShare: number;
                    maxDelta: number;
                };
            };
            variants: { relief?: { flatPropChanged: number; changedShare: number } };
        };
        if (stats.acceptance === undefined) return; // a tree without the shaded program has no lamp shadow to look at
        expect(stats.acceptance.lampShadow.casterLampsInView).toBeGreaterThan(0);
        expect(stats.acceptance.lampShadow.changedShare).toBeGreaterThanOrEqual(0.01);
        expect(stats.acceptance.lampShadow.maxDelta).toBeGreaterThanOrEqual(50);
        expect(stats.acceptance.lampShadow.meets).toBe(true);
        expect(stats.variants.relief?.flatPropChanged ?? 0).toBeLessThanOrEqual(8);
    }, 120_000);

    // The defects of the review of 2026-11-23 as numbers, on the real shaders in a real GPU (each of them FAILS on the shader text
    // of that review: relief correlation -0.01 and 8% not darker, people lit on the far side, 1525 swimming pixels).
    it("lights the props from the lamp's side without only darkening them, and lights a person on the side that faces the lamp", async () => {
        const out = temporary();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const code = await main([DIST, "--out", out, "--preset", "reception", "--hour", "22", "--no-timing"]);
        expect(code).toBe(0);
        const stats = JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as {
            acceptance?: {
                reliefLit?: { meets: boolean | null; correlation: number | null; lightShare: number | null };
                peopleLampSide?: { meets: boolean | null; checked: number };
            };
        };
        const acceptance = stats.acceptance;
        if (acceptance?.reliefLit === undefined) return; // a tree without the shaded program has none of this
        expect(acceptance.reliefLit.meets).toBe(true);
        expect(acceptance.reliefLit.correlation ?? 0).toBeGreaterThanOrEqual(0.2);
        expect(acceptance.reliefLit.lightShare ?? 0).toBeGreaterThanOrEqual(0.2);
        expect(acceptance.peopleLampSide?.checked ?? 0).toBeGreaterThan(0);
        expect(acceptance.peopleLampSide?.meets).toBe(true);
    }, 120_000);

    it("does not swim: at four fractional scrolls and zoom 1 and 2 the shaded pass differs from itself shifted by no more pixels than today's", async () => {
        const out = temporary();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const code = await main([
            DIST,
            "--out",
            out,
            "--preset",
            "floor-lamps",
            "--hour",
            "22",
            "--size",
            "480x270",
            "--no-timing",
            "--shimmer",
        ]);
        expect(code).toBe(0);
        const stats = JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as {
            acceptance?: {
                shimmer?: { meets: boolean; rows: { zoom: number; scroll: number; off: number; on: number }[] };
            };
        };
        const shimmer = stats.acceptance?.shimmer;
        if (shimmer === undefined) return;
        expect(shimmer.rows).toHaveLength(8);
        expect(shimmer.meets).toBe(true);
        for (const row of shimmer.rows) expect(row.on).toBe(0);
    }, 120_000);

    it("tells the shader about the avatars that carry no mark, and gives them none of a prop's relief", async () => {
        const out = temporary();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const code = await main([
            DIST,
            "--out",
            out,
            "--preset",
            "reception",
            "--hour",
            "22",
            "--no-timing",
            "--unmarked",
        ]);
        expect(code).toBe(0);
        const stats = JSON.parse(readFileSync(join(out, "stats.json"), "utf8")) as {
            acceptance?: { unmarkedPeopleTakeNoRelief?: { meets: boolean | null; listed: number } };
            unsetUniforms?: { on?: string[] };
        };
        const crowd = stats.acceptance?.unmarkedPeopleTakeNoRelief;
        if (crowd === undefined) return;
        expect(crowd.listed).toBeGreaterThan(0);
        expect(crowd.meets).toBe(true);
        expect(stats.unsetUniforms?.on ?? []).toEqual([]);
    }, 120_000);

    it("stops with the driver's message and the offending line when a shader does not compile", async () => {
        const out = temporary();
        const broken = join(temporary(), "broken.frag");
        writeFileSync(broken, "precision highp float;\nvoid main() {\n  gl_FragColor = vec4(undeclaredThing);\n}\n");
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const code = await main([
            DIST,
            "--out",
            out,
            "--preset",
            "reception",
            "--size",
            "320x180",
            "--no-timing",
            "--on-shader",
            broken,
        ]);

        expect(code).toBe(1);
        const said = errors.mock.calls.map((call) => String(call[0])).join("\n");
        expect(said).toMatch(/does not compile/);
        expect(said).toMatch(/undeclaredThing/);
        expect(said).toContain("gl_FragColor = vec4(undeclaredThing);");
    }, 120_000);
});

describe("shader lab smoke test gate", () => {
    it("says why it is skipped when it is", () => {
        expect(reason === null || /no built map|not installed/.test(reason)).toBe(true);
    });
});
