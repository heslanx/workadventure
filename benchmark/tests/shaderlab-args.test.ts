import { describe, expect, it } from "vitest";
import {
    DEFAULT_SIZE,
    DEFAULT_TIMING_DRAWS,
    DEFAULT_TIMING_SIZE,
    parseArgs,
    parseCamera,
    parseFlag,
    parsePeople,
    parseSize,
    UsageError,
} from "../shader-lab/args";

const MAP = "/tmp/map";

describe("shader lab: the command line", () => {
    it("takes the map directory and --out, and leaves everything else to the preset", () => {
        const config = parseArgs([MAP, "--out", "/tmp/o"]);

        expect(config).toMatchObject({
            dist: MAP,
            out: "/tmp/o",
            hour: undefined,
            camera: undefined,
            people: undefined,
            preset: undefined,
            size: DEFAULT_SIZE,
            gl: 1,
            frame: "map",
            timing: true,
            timingDraws: DEFAULT_TIMING_DRAWS,
            timingSize: DEFAULT_TIMING_SIZE,
            channel: "chrome",
            clouds: true,
        });
        expect(config.flags).toEqual({});
    });

    it("reads the hour, the camera, the people and the size as the brief writes them", () => {
        const config = parseArgs([
            MAP,
            "--out=/tmp/o",
            "--hour",
            "19.3",
            "--camera",
            "1391.5,1330,2",
            "--people",
            "10,20;30.5,40",
            "--size=640x360",
        ]);

        expect(config.hour).toBe(19.3);
        expect(config.camera).toEqual({ x: 1391.5, y: 1330, zoom: 2 });
        expect(config.people).toEqual([
            { x: 10, y: 20 },
            { x: 30.5, y: 40 },
        ]);
        expect(config.size).toEqual({ width: 640, height: 360 });
    });

    it("takes several --flag key=value pairs, with dots in the key, and --flag=key=value", () => {
        const config = parseArgs([
            MAP,
            "--out",
            "o",
            "--flag",
            "konclui.fx.rim=1",
            "konclui.fx.hour=12.5",
            "--flag=a.b=c=d",
        ]);

        expect(config.flags).toEqual({ "konclui.fx.rim": "1", "konclui.fx.hour": "12.5", "a.b": "c=d" });
    });

    it("does not let --flag swallow the next option", () => {
        const config = parseArgs([MAP, "--flag", "konclui.fx.rim=1", "--out", "o", "--no-timing"]);

        expect(config.flags).toEqual({ "konclui.fx.rim": "1" });
        expect(config.out).toBe("o");
        expect(config.timing).toBe(false);
    });

    it("selects WebGL2 with --webgl2 or --gl 2, and rejects another context", () => {
        expect(parseArgs([MAP, "--out", "o", "--webgl2"]).gl).toBe(2);
        expect(parseArgs([MAP, "--out", "o", "--gl", "2"]).gl).toBe(2);
        expect(() => parseArgs([MAP, "--out", "o", "--gl", "3"])).toThrow(UsageError);
    });

    it("runs the Phaser probe without a map, but not without an output directory", () => {
        expect(parseArgs(["--phaser", "--out", "o"]).phaser).toBe(true);
        expect(parseArgs([MAP, "--out", "o"]).phaser).toBe(false);
        expect(() => parseArgs(["--phaser"])).toThrow(/--out/);
    });

    it("draws the people unmarked with --unmarked, and checks the shimmer with --shimmer, both off by default and taking no value", () => {
        const plain = parseArgs([MAP, "--out", "o"]);
        expect([plain.unmarked, plain.shimmer]).toEqual([false, false]);
        const both = parseArgs([MAP, "--out", "o", "--unmarked", "--shimmer"]);
        expect([both.unmarked, both.shimmer]).toEqual([true, true]);
        expect(() => parseArgs([MAP, "--out", "o", "--unmarked=1"])).toThrow(/takes no value/);
        expect(() => parseArgs([MAP, "--out", "o", "--shimmer=1"])).toThrow(/takes no value/);
    });

    it("lists presets without a map or an output directory", () => {
        expect(parseArgs(["--list-presets"]).listPresets).toBe(true);
    });

    it.each([
        [["--out", "o"], /map directory is required/],
        [[MAP], /--out/],
        [[MAP, "--out", "o", "--bogus"], /unknown option --bogus/],
        [[MAP, "--out"], /--out needs a value/],
        [[MAP, "--out", "o", "--hour", "25"], /--hour is 0 to 24/],
        [[MAP, "--out", "o", "--hour", "noon"], /--hour must be a number/],
        [[MAP, "--out", "o", "--camera", "1,2"], /x,y,zoom/],
        [[MAP, "--out", "o", "--camera", "1,2,0"], /zoom must be above 0/],
        [[MAP, "--out", "o", "--people", "1;2"], /x,y;x,y/],
        [[MAP, "--out", "o", "--size", "big"], /WIDTHxHEIGHT/],
        [[MAP, "--out", "o", "--flag", "nokey"], /key=value/],
        [[MAP, "--out", "o", "--flag"], /--flag takes key=value/],
        [[MAP, "other", "--out", "o"], /one map directory only/],
        [[MAP, "--out", "o", "--timing-draws", "0"], /1 to 5000/],
        [[MAP, "--out", "o", "--no-timing=1"], /takes no value/],
    ])("refuses %j", (argv, message) => {
        expect(() => parseArgs(argv)).toThrow(message);
    });

    it("parses the pieces on their own", () => {
        expect(parseCamera("0,0,0.75")).toEqual({ x: 0, y: 0, zoom: 0.75 });
        expect(parsePeople("none")).toEqual([]);
        expect(parseSize("2048x1200")).toEqual({ width: 2048, height: 1200 });
        expect(() => parseSize("8x8")).toThrow(/between 16 and 4096/);
        expect(parseFlag("konclui.fx.off=1")).toEqual(["konclui.fx.off", "1"]);
    });
});
