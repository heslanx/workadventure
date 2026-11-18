import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config";

const REQUIRED = {
    WA_PUSHER_URL: "http://play.test",
    WA_ROOM_URLS: "http://play.test/_/global/maps.test/a.json",
    WA_SESSIONS: "10",
};

function parse(argv: string[] = [], env: Record<string, string | undefined> = {}) {
    return parseConfig(argv, { ...REQUIRED, ...env });
}

describe("scenario flags", () => {
    it("keeps today's scenario when no new flag is given, so old baselines stay comparable", () => {
        // Change any of these defaults and a run without flags no longer reproduces baseline-300.json.
        expect(parse()).toMatchObject({
            viewport: "bot",
            pattern: "ellipse",
            movingFraction: 1,
            worldSpaceWatchFraction: 0,
            worldSpaceMemberFraction: 0,
            indexOffset: 0,
            steadyWindowSeconds: 0,
            metricsUrls: [],
        });
    });

    it.each(["bot", "browser", "zoomout"])("accepts --viewport=%s", (viewport) => {
        expect(parse([`--viewport=${viewport}`]).viewport).toBe(viewport);
    });

    it.each(["ellipse", "plaza", "ring", "walk-stop"])("accepts --pattern=%s", (pattern) => {
        expect(parse([`--pattern=${pattern}`]).pattern).toBe(pattern);
    });

    it.each([
        ["--viewport=phone", "WA_VIEWPORT"],
        ["--pattern=uniform", "WA_PATTERN"],
    ])("refuses %s and names the setting", (argument, name) => {
        expect(() => parse([argument])).toThrow(name);
    });

    it("reads --moving-fraction as a share between 0 and 1", () => {
        expect(parse(["--moving-fraction=0.2"]).movingFraction).toBe(0.2);
        expect(parse(["--moving-fraction=0"]).movingFraction).toBe(0);
        expect(() => parse(["--moving-fraction=1.5"])).toThrow(ConfigError);
        expect(() => parse(["--moving-fraction=-0.1"])).toThrow(ConfigError);
        expect(() => parse(["--moving-fraction=most"])).toThrow(ConfigError);
    });

    it("lets --index-offset shift only whole numbers", () => {
        expect(parse(["--index-offset=250"]).indexOffset).toBe(250);
        expect(() => parse(["--index-offset=2.5"])).toThrow(ConfigError);
        expect(() => parse(["--index-offset=-1"])).toThrow(ConfigError);
    });

    it("lets a command-line flag override the environment for the new flags too", () => {
        const config = parse(["--pattern=ring"], { WA_PATTERN: "plaza", WA_VIEWPORT: "zoomout" });

        expect(config).toMatchObject({ pattern: "ring", viewport: "zoomout" });
    });
});

describe("world space flags", () => {
    it("makes every bot a member and a watcher with --world-space=1", () => {
        expect(parse(["--world-space=1"])).toMatchObject({
            worldSpaceWatchFraction: 1,
            worldSpaceMemberFraction: 1,
        });
    });

    it("takes the share of watchers and lets every bot join with it", () => {
        // 30% watch the list while everybody is in the space: what a roster that is opened on demand looks like.
        expect(parse(["--world-space=0.3"])).toMatchObject({
            worldSpaceWatchFraction: 0.3,
            worldSpaceMemberFraction: 1,
        });
    });

    it("reads on and off as 1 and 0", () => {
        expect(parse(["--world-space=on"]).worldSpaceWatchFraction).toBe(1);
        expect(parse(["--world-space=off"])).toMatchObject({ worldSpaceWatchFraction: 0, worldSpaceMemberFraction: 0 });
    });

    it("joins members that never watch with --world-members alone", () => {
        // The state after the roster is made lazy: everyone is in the space and nobody subscribes to its users.
        expect(parse(["--world-members=1"])).toMatchObject({
            worldSpaceWatchFraction: 0,
            worldSpaceMemberFraction: 1,
        });
    });

    it("refuses more watchers than members", () => {
        expect(() => parse(["--world-space=0.8", "--world-members=0.5"])).toThrow(ConfigError);
    });

    it("refuses a share outside 0..1", () => {
        expect(() => parse(["--world-space=2"])).toThrow(ConfigError);
        expect(() => parse(["--world-space=all"])).toThrow(ConfigError);
    });
});

describe("steady window and metrics flags", () => {
    it("takes the closing seconds of the run that the statistics cover", () => {
        const config = parse(["--duration-seconds=240", "--ramp-seconds=60", "--steady-window=120"]);

        expect(config.steadyWindowSeconds).toBe(120);
    });

    it("refuses a window that would reach back into the ramp", () => {
        // 200 s window in a 240 s run with a 60 s ramp would start at second 40, while sessions are still joining.
        expect(() => parse(["--duration-seconds=240", "--ramp-seconds=60", "--steady-window=200"])).toThrow(
            ConfigError,
        );
        expect(() => parse(["--duration-seconds=240", "--ramp-seconds=60", "--steady-window=180"])).not.toThrow();
    });

    it("does not judge a run without a window by its ramp", () => {
        expect(() => parse(["--duration-seconds=1", "--ramp-seconds=10"])).not.toThrow();
    });

    it("splits --metrics-urls on commas and trims them", () => {
        const config = parse(["--metrics-urls=http://127.0.0.1:9100/metrics, http://127.0.0.1:9101/metrics ,"]);

        expect(config.metricsUrls).toEqual(["http://127.0.0.1:9100/metrics", "http://127.0.0.1:9101/metrics"]);
    });

    it("refuses a metrics address that is not an http(s) URL", () => {
        expect(() => parse(["--metrics-urls=127.0.0.1:9100"])).toThrow(ConfigError);
        expect(() => parse(["--metrics-urls=file:///etc/passwd"])).toThrow(ConfigError);
    });
});
