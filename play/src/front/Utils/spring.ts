/**
 * Springs as pure functions: the closed-form motion of a mass on a damped spring, the easing it gives a JS-driven
 * transition, and the CSS `linear()` text that gives a CSS transition the same curve.
 *
 * It touches no `window` and no `document`, so anything may import it. The theme's two springs are named here with
 * the durations that fit them; `libs/tailwind/style/konclui.css` carries the `linear()` text this module generates
 * (`--k-ease-spring`, `--k-ease-spring-turn`), and `tests/front/Style/KoncluiMotionTokens.test.ts` fails when the
 * stylesheet and this generator disagree. Change a spring here, regenerate the token, and change them together.
 */

/** Physical constants of a spring, for a unit step from 0 to 1 that starts at rest. */
export interface Spring {
    readonly stiffness: number;
    readonly damping: number;
    readonly mass: number;
}

/**
 * A surface that opens over the map and the one that follows it. Damping is just above critical (1.008), so it
 * settles without bouncing.
 */
export const SPRING_SURFACE: Spring = { stiffness: 420, damping: 32, mass: 0.6 };

/** A mark that turns (a chevron): the only spring with a visible overshoot, 6 % of its travel. */
export const SPRING_TURN: Spring = { stiffness: 350, damping: 25, mass: 1 };

/** The duration of each spring in a transition: within 10 ms of its settle time to 0.5 % of the travel (286 and 365 ms). */
export const SPRING_SURFACE_MS = 290;
export const SPRING_TURN_MS = 360;

/** How far from rest, in share of the travel, a spring may still be when it is said to have settled. */
const REST_DELTA = 0.005;

/** The longest a spring is followed when it never settles. */
const SETTLE_LIMIT_MS = 10_000;

/** Samples of the curve that `linearCss` reduces to a few points. */
const LINEAR_SAMPLES = 4000;

/** `linear()` text is cut to this error, in share of the travel, against the curve it replaces. */
const LINEAR_TOLERANCE = 0.002;

function assertSpring({ stiffness, damping, mass }: Spring): void {
    if (!(stiffness > 0 && mass > 0 && damping >= 0 && Number.isFinite(stiffness + damping + mass))) {
        throw new RangeError(`not a spring: stiffness ${stiffness}, damping ${damping}, mass ${mass}`);
    }
}

/**
 * Where the spring is `seconds` after it was released, as a share of its travel: 0 at the start, 1 at rest. A
 * spring that is under-damped overshoots 1; a critically or over-damped one never does.
 */
export function springPosition(spring: Spring, seconds: number): number {
    assertSpring(spring);
    if (seconds <= 0) return 0;
    const { stiffness, damping, mass } = spring;
    const omega = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    if (Math.abs(zeta - 1) < 1e-6) {
        return 1 - Math.exp(-omega * seconds) * (1 + omega * seconds);
    }
    if (zeta < 1) {
        const damped = omega * Math.sqrt(1 - zeta * zeta);
        return (
            1 -
            Math.exp(-zeta * omega * seconds) *
                (Math.cos(damped * seconds) + ((zeta * omega) / damped) * Math.sin(damped * seconds))
        );
    }
    const root = Math.sqrt(zeta * zeta - 1);
    const slow = -omega * (zeta - root);
    const fast = -omega * (zeta + root);
    return 1 - (fast * Math.exp(slow * seconds) - slow * Math.exp(fast * seconds)) / (fast - slow);
}

/**
 * Milliseconds until the spring stays within `restDelta` of its travel (0.5 % by default: 0.12 px of a 24 px move).
 * It is read off the curve every 0.1 ms, so it is exact to that step. A spring without damping never settles and
 * gives the limit of 10 s.
 */
export function settleMs(spring: Spring, restDelta: number = REST_DELTA): number {
    assertSpring(spring);
    const stepMs = 0.1;
    let lastOutside = 0;
    for (let ms = 0; ms <= SETTLE_LIMIT_MS; ms += stepMs) {
        if (Math.abs(springPosition(spring, ms / 1000) - 1) > restDelta) lastOutside = ms;
    }
    return lastOutside + stepMs;
}

/**
 * The spring as an easing for a transition of `durationMs`: progress 0 to 1 in, progress 0 to 1 out. The curve is
 * divided by where the spring is at `durationMs`, so the last value is exactly 1 and the surface lands where it was
 * going, not 0.4 % short of it. It starts at 0 with no slope, as a spring released at rest does.
 */
export function springEasing(spring: Spring, durationMs: number): (progress: number) => number {
    assertSpring(spring);
    if (!(durationMs > 0)) throw new RangeError(`a spring needs a duration above 0 ms, got ${durationMs}`);
    const end = springPosition(spring, durationMs / 1000);
    return (progress) => {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        return springPosition(spring, (progress * durationMs) / 1000) / end;
    };
}

interface Point {
    readonly input: number;
    readonly output: number;
}

/**
 * Keeps the points of `points` that a straight line between their neighbours would miss by more than `tolerance`
 * (Ramer-Douglas-Peucker, measured vertically because `linear()` interpolates the output at the same input).
 */
function simplify(points: readonly Point[], tolerance: number): Point[] {
    const keep = points.map(() => false);
    keep[0] = true;
    keep[points.length - 1] = true;
    const segments: [number, number][] = [[0, points.length - 1]];
    for (let segment = segments.pop(); segment !== undefined; segment = segments.pop()) {
        const [first, last] = segment;
        const a = points[first];
        const b = points[last];
        let worst = 0;
        let worstIndex = -1;
        for (let index = first + 1; index < last; index++) {
            const point = points[index];
            const line = a.output + ((point.input - a.input) / (b.input - a.input)) * (b.output - a.output);
            const miss = Math.abs(point.output - line);
            if (miss > worst) {
                worst = miss;
                worstIndex = index;
            }
        }
        if (worst > tolerance && worstIndex > 0) {
            keep[worstIndex] = true;
            segments.push([first, worstIndex], [worstIndex, last]);
        }
    }
    return points.filter((_, index) => keep[index]);
}

/**
 * The text of a CSS `linear()` easing that follows `springEasing(spring, durationMs)` within `tolerance` of the
 * travel (0.2 % by default): about twenty points, inputs to 0.1 % and outputs to four decimals. Only the generator
 * and its tests call it; the stylesheet holds the text it produced.
 */
export function linearCss(spring: Spring, durationMs: number, tolerance: number = LINEAR_TOLERANCE): string {
    const easing = springEasing(spring, durationMs);
    const dense: Point[] = [];
    for (let index = 0; index <= LINEAR_SAMPLES; index++) {
        const input = index / LINEAR_SAMPLES;
        dense.push({ input, output: easing(input) });
    }
    const points: Point[] = [];
    for (const { input, output } of simplify(dense, tolerance)) {
        const point = { input: Math.round(input * 1000) / 1000, output: Math.round(output * 10000) / 10000 };
        // Two points that round to the same input leave the later one: the last must stay at 1.
        if (points.at(-1)?.input === point.input) points.pop();
        points.push(point);
    }
    const list = points.map(({ input, output }, index) => {
        if (index === 0) return "0";
        if (index === points.length - 1) return "1";
        return `${output} ${Number((input * 100).toFixed(1))}%`;
    });
    return `linear(${list.join(", ")})`;
}

/**
 * `cubic-bezier(x1, y1, x2, y2)` as an easing function, the way CSS reads it. The exit of a surface runs in JS (its
 * transition is a Svelte one) on the same curve its CSS twin has as a token.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
    const coefficient = (first: number, second: number) => {
        const c = 3 * first;
        const b = 3 * (second - first) - c;
        return { a: 1 - c - b, b, c };
    };
    const at = ({ a, b, c }: { a: number; b: number; c: number }, s: number): number => ((a * s + b) * s + c) * s;
    const x = coefficient(x1, x2);
    const y = coefficient(y1, y2);
    return (progress) => {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        // x grows with s, so bisection finds the s whose x is `progress`; 40 halvings are finer than a pixel of a
        // 4000-pixel travel.
        let low = 0;
        let high = 1;
        for (let step = 0; step < 40; step++) {
            const middle = (low + high) / 2;
            if (at(x, middle) < progress) low = middle;
            else high = middle;
        }
        return at(y, (low + high) / 2);
    };
}
