import { describe, expect, it } from "vitest";
import {
    SPRING_SURFACE,
    SPRING_SURFACE_MS,
    SPRING_TURN,
    SPRING_TURN_MS,
    cubicBezier,
    linearCss,
    settleMs,
    springEasing,
    springPosition,
    type Spring,
} from "./spring";

// The four springs of the owner's examples, with the figures computed for them in
// .local/konclui/motion-2026-11-24/primitives.md, section 2.2. Only the first and the last are theme tokens.
const springs: { name: string; spring: Spring; settle: number; progress: number[] }[] = [
    {
        name: "dropdown surface 420/32/0.6",
        spring: SPRING_SURFACE,
        settle: 286,
        progress: [0.738, 0.903, 0.966, 0.989, 0.996],
    },
    {
        name: "hover pill 450/35/1",
        spring: { stiffness: 450, damping: 35, mass: 1 },
        settle: 335,
        progress: [0.701, 0.913, 0.992, 1.01, 1.008],
    },
    {
        name: "card stack 440/34/0.8",
        spring: { stiffness: 440, damping: 34, mass: 0.8 },
        settle: 238,
        progress: [0.721, 0.909, 0.978, 0.997, 1.001],
    },
    {
        name: "chevron 350/25/1",
        spring: SPRING_TURN,
        settle: 365,
        progress: [0.696, 0.956, 1.051, 1.055, 1.03],
    },
];

/** The points of a `linear()` text: the first has no percentage and is at 0, the last has none and is at 1. */
function linearPoints(text: string): { input: number; output: number }[] {
    const body = /^linear\((.*)\)$/.exec(text)?.[1];
    if (body === undefined) throw new Error(`not a linear() text: ${text}`);
    return body.split(",").map((item, index, all) => {
        const [output, percent] = item.trim().split(/\s+/);
        const last = index === all.length - 1;
        return {
            input: percent === undefined ? (last ? 1 : 0) : Number.parseFloat(percent) / 100,
            output: Number.parseFloat(output),
        };
    });
}

/** Reads the output of a `linear()` text at an input from 0 to 1, as the browser does. */
function evaluateLinear(text: string, input: number): number {
    const points = linearPoints(text);
    for (let index = 1; index < points.length; index++) {
        const before = points[index - 1];
        const after = points[index];
        if (input <= after.input) {
            return (
                before.output + ((input - before.input) / (after.input - before.input)) * (after.output - before.output)
            );
        }
    }
    return points[points.length - 1].output;
}

describe("springPosition", () => {
    it.each(springs)("follows the computed progress of the $name spring at 100, 150, 200, 250 and 300 ms", (item) => {
        const seen = [100, 150, 200, 250, 300].map((ms) => springPosition(item.spring, ms / 1000));

        seen.forEach((value, index) => expect(value).toBeCloseTo(item.progress[index], 2));
    });

    it("starts at 0, and a spring that was never released has not moved", () => {
        expect(springPosition(SPRING_SURFACE, 0)).toBe(0);
        expect(springPosition(SPRING_SURFACE, -1)).toBe(0);
    });

    it("reads the critically damped spring as 1 - e^(-wt)(1 + wt)", () => {
        // stiffness 100, mass 1: w = 10 rad/s, and damping 20 is exactly critical.
        const critical: Spring = { stiffness: 100, damping: 20, mass: 1 };

        expect(springPosition(critical, 0.1)).toBeCloseTo(1 - 2 * Math.exp(-1), 10);
    });

    it("gives the same curve on both sides of critical damping, so no branch is off by a term", () => {
        const under = springPosition({ stiffness: 100, damping: 19.99, mass: 1 }, 0.2);
        const critical = springPosition({ stiffness: 100, damping: 20, mass: 1 }, 0.2);
        const over = springPosition({ stiffness: 100, damping: 20.01, mass: 1 }, 0.2);

        expect(under).toBeCloseTo(critical, 3);
        expect(over).toBeCloseTo(critical, 3);
    });

    it("refuses what is not a spring", () => {
        expect(() => springPosition({ stiffness: 0, damping: 1, mass: 1 }, 1)).toThrow(RangeError);
        expect(() => springPosition({ stiffness: 1, damping: -1, mass: 1 }, 1)).toThrow(RangeError);
        expect(() => springPosition({ stiffness: 1, damping: 1, mass: 0 }, 1)).toThrow(RangeError);
        expect(() => springPosition({ stiffness: Number.NaN, damping: 1, mass: 1 }, 1)).toThrow(RangeError);
    });
});

describe("settleMs", () => {
    it.each(springs)("settles the $name spring to 0.5 % of its travel in $settle ms", (item) => {
        expect(Math.abs(settleMs(item.spring) - item.settle)).toBeLessThanOrEqual(1);
    });

    it("keeps each theme duration within 10 ms of the time its spring takes to settle", () => {
        expect(Math.abs(settleMs(SPRING_SURFACE) - SPRING_SURFACE_MS)).toBeLessThanOrEqual(10);
        expect(Math.abs(settleMs(SPRING_TURN) - SPRING_TURN_MS)).toBeLessThanOrEqual(10);
    });

    it("takes longer to settle to a finer delta, and gives up on a spring without damping", () => {
        expect(settleMs(SPRING_SURFACE, 0.001)).toBeGreaterThan(settleMs(SPRING_SURFACE, 0.01));
        expect(settleMs({ stiffness: 100, damping: 0, mass: 1 })).toBeGreaterThan(9_999);
    });
});

describe("springEasing", () => {
    it.each(springs)("starts the $name spring at 0 with no slope and ends at exactly 1", (item) => {
        const easing = springEasing(item.spring, Math.round(item.settle / 10) * 10);

        expect(easing(0)).toBe(0);
        expect(easing(1)).toBe(1);
        // No jump at the end: just before it, the curve is already at 1, not 0.4 % short of it.
        expect(easing(1 - 1e-9)).toBeCloseTo(1, 6);
        // A spring released at rest has no speed: a ten-thousandth of the duration has moved a millionth.
        expect(easing(0.0001) / 0.0001).toBeLessThan(0.01);
    });

    it("clamps what is outside 0 to 1, as a transition's progress never is but a rounding can be", () => {
        const easing = springEasing(SPRING_SURFACE, SPRING_SURFACE_MS);

        expect(easing(-0.5)).toBe(0);
        expect(easing(1.5)).toBe(1);
    });

    it("does not overshoot when it is over-damped, and rises the whole way", () => {
        const easing = springEasing(SPRING_SURFACE, SPRING_SURFACE_MS);
        const heavy = springEasing({ stiffness: 100, damping: 40, mass: 1 }, 1500);

        for (const curve of [easing, heavy]) {
            let before = 0;
            for (let step = 1; step <= 1000; step++) {
                const value = curve(step / 1000);
                expect(value).toBeLessThanOrEqual(1);
                expect(value).toBeGreaterThanOrEqual(before);
                before = value;
            }
        }
    });

    it("overshoots when it is under-damped: the chevron goes about 6 % past its mark", () => {
        const easing = springEasing(SPRING_TURN, SPRING_TURN_MS);
        let peak = 0;
        for (let step = 0; step <= 1000; step++) peak = Math.max(peak, easing(step / 1000));

        expect(peak).toBeGreaterThan(1.05);
        expect(peak).toBeLessThan(1.07);
    });

    it("reaches 74 % of the travel in 100 ms of the surface's 290, so it reads as arrived at the old durations", () => {
        const easing = springEasing(SPRING_SURFACE, SPRING_SURFACE_MS);

        expect(easing(100 / SPRING_SURFACE_MS)).toBeCloseTo(0.74, 2);
    });

    it("refuses a duration that is not above zero", () => {
        expect(() => springEasing(SPRING_SURFACE, 0)).toThrow(RangeError);
        expect(() => springEasing(SPRING_SURFACE, -10)).toThrow(RangeError);
    });
});

describe("linearCss", () => {
    it.each([
        ["the surface", SPRING_SURFACE, SPRING_SURFACE_MS],
        ["the chevron", SPRING_TURN, SPRING_TURN_MS],
    ])("gives %s a linear() text that follows the easing within 0.25 % of the travel", (_name, spring, duration) => {
        const text = linearCss(spring, duration);
        const easing = springEasing(spring, duration);

        let worst = 0;
        for (let step = 0; step <= 2000; step++) {
            worst = Math.max(worst, Math.abs(evaluateLinear(text, step / 2000) - easing(step / 2000)));
        }
        // 0.2 % of tolerance, and the rounding of the points to four decimals and 0.1 % of the input.
        expect(worst).toBeLessThan(0.0025);
    });

    it("writes about twenty points, from 0 to 1, with the inputs rising", () => {
        const text = linearCss(SPRING_SURFACE, SPRING_SURFACE_MS);
        const points = linearPoints(text);

        expect(text.startsWith("linear(0, ")).toBe(true);
        expect(text.endsWith(", 1)")).toBe(true);
        expect(points.length).toBeGreaterThanOrEqual(15);
        expect(points.length).toBeLessThanOrEqual(30);
        points.slice(1).forEach((point, index) => expect(point.input).toBeGreaterThan(points[index].input));
        expect(points[0]).toEqual({ input: 0, output: 0 });
        expect(points.at(-1)).toEqual({ input: 1, output: 1 });
    });

    it("keeps the chevron's overshoot in the text, and the surface's none", () => {
        const surface = linearPoints(linearCss(SPRING_SURFACE, SPRING_SURFACE_MS));
        const turn = linearPoints(linearCss(SPRING_TURN, SPRING_TURN_MS));

        expect(Math.max(...surface.map((point) => point.output))).toBe(1);
        expect(Math.max(...turn.map((point) => point.output))).toBeGreaterThan(1.05);
    });

    it("needs more points for a finer tolerance", () => {
        const loose = linearPoints(linearCss(SPRING_SURFACE, SPRING_SURFACE_MS, 0.01));
        const fine = linearPoints(linearCss(SPRING_SURFACE, SPRING_SURFACE_MS, 0.0005));

        expect(fine.length).toBeGreaterThan(loose.length);
    });
});

describe("cubicBezier", () => {
    it("is the identity for the straight line, and 0 and 1 at the ends of any curve", () => {
        const straight = cubicBezier(0, 0, 1, 1);
        const sheet = cubicBezier(0.22, 1, 0.36, 1);

        expect(straight(0.3)).toBeCloseTo(0.3, 6);
        expect(sheet(0)).toBe(0);
        expect(sheet(1)).toBe(1);
        expect(sheet(-1)).toBe(0);
        expect(sheet(2)).toBe(1);
    });

    it("reads the theme's sheet curve as the study measured it: 40, 67, 83 and 96 % at 10, 20, 30 and 50 % of the time", () => {
        const sheet = cubicBezier(0.22, 1, 0.36, 1);

        expect(sheet(0.1)).toBeCloseTo(0.4, 2);
        expect(sheet(0.2)).toBeCloseTo(0.67, 2);
        expect(sheet(0.3)).toBeCloseTo(0.83, 2);
        expect(sheet(0.5)).toBeCloseTo(0.96, 2);
    });

    it("rises the whole way for a curve that does not overshoot", () => {
        const sheet = cubicBezier(0.22, 1, 0.36, 1);
        let before = 0;
        for (let step = 1; step <= 1000; step++) {
            const value = sheet(step / 1000);
            expect(value).toBeGreaterThanOrEqual(before);
            before = value;
        }
    });
});
