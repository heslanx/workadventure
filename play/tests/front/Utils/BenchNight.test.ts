import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    createBenchNight,
    FIXED_HOUR_KEY,
    hourForNightLevel,
    NIGHT_ON_LAMPS,
} from "../../../src/front/Utils/BenchNight";
// The Koncluí look table, to check the seam against: a test may import it, an upstream source file may not
import { daylight } from "../../../src/front/Konclui/Ambience/domain/timeOfDay";

describe("hourForNightLevel", () => {
    it.each([
        [0, 12],
        [0.8, 17.4],
        [0.9, 18.3],
        [1, 19.3],
    ])("maps the level %s to the keyframe hour %s", (level, hour) => {
        expect(hourForNightLevel(level)).toBeCloseTo(hour, 9);
    });

    it.each([0, 0.05, 0.25, 0.5, 0.75, 0.8, 0.85, 0.9, 0.95, 1])(
        "gives an hour whose look has the lamps at exactly %s (the uNight the post pass reads)",
        (level) => {
            expect(daylight(hourForNightLevel(level)).lamps).toBeCloseTo(level, 6);
        },
    );

    it("rises with the level", () => {
        const hours = [0, 0.2, 0.4, 0.6, 0.8, 0.85, 0.9, 1].map(hourForNightLevel);

        expect(hours).toEqual([...hours].sort((a, b) => a - b));
    });

    it.each([-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])("refuses the level %s", (level) => {
        expect(() => hourForNightLevel(level)).toThrow("from 0 to 1");
    });
});

describe("the night-only lights threshold", () => {
    it("is the one SceneEffects switches its night branch on, read from the source so a change fails here", () => {
        const source = readFileSync(
            new URL("../../../src/front/Konclui/Ambience/phaser/SceneEffects.ts", import.meta.url),
            "utf8",
        );
        const threshold = /const night = look\.lamps >= ([0-9.]+);/.exec(source);

        expect(threshold).not.toBeNull();
        expect(Number(threshold?.[1])).toBe(NIGHT_ON_LAMPS);
    });

    it.each([
        [0, false],
        [0.5, false],
        [0.85, false],
        [0.89, false],
        [0.91, true],
        [1, true],
    ])("says nightOn for the level %s is %s, as the effects' own look at that hour decides it", (level, nightOn) => {
        const result = createBenchNight(fakeStorage().storage)(level);

        // Level 0.85 of the mandate is the dusk look: its night-only lights are off
        expect(result.nightOn).toBe(nightOn);
        expect(daylight(hourForNightLevel(level)).lamps >= NIGHT_ON_LAMPS).toBe(nightOn);
    });
});

function fakeStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    return {
        items,
        storage: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => {
                items.set(key, value);
            },
            removeItem: (key: string) => {
                items.delete(key);
            },
        },
    };
}

describe("createBenchNight", () => {
    it("fixes the effects' hour through the QA key the Koncluí port reads", () => {
        const { items, storage } = fakeStorage();

        const result = createBenchNight(storage)(0.85);

        expect(FIXED_HOUR_KEY).toBe("konclui.fx.hour");
        expect(Number(items.get("konclui.fx.hour"))).toBeCloseTo(hourForNightLevel(0.85), 4);
        expect(result).toEqual({ level: 0.85, hour: Number(items.get("konclui.fx.hour")), nightOn: false });
    });

    it("gives the clock back: the key is removed when it held nothing before", () => {
        const { items, storage } = fakeStorage();
        const setBenchNight = createBenchNight(storage);

        setBenchNight(0.5);
        const result = setBenchNight(null);

        expect(items.has("konclui.fx.hour")).toBe(false);
        expect(result).toEqual({ level: null, hour: null, nightOn: false });
    });

    it("restores what the key held before the first call, even after several levels", () => {
        const { items, storage } = fakeStorage({ "konclui.fx.hour": "9.5" });
        const setBenchNight = createBenchNight(storage);

        setBenchNight(0);
        setBenchNight(0.85);
        setBenchNight(null);

        expect(items.get("konclui.fx.hour")).toBe("9.5");
    });

    it("leaves the storage alone when it is given back without having been set", () => {
        const { items, storage } = fakeStorage({ "konclui.fx.hour": "9.5" });

        createBenchNight(storage)(null);

        expect(items.get("konclui.fx.hour")).toBe("9.5");
    });
});
