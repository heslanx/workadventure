import type { FeatureSwitches } from "../../Preferences/domain/effectSwitches";

export const TIME_ZONE = "America/Sao_Paulo";

/** Decimal hour in the office's time zone (Brasília). */
export function localHour(date = new Date(), timeZone = TIME_ZONE): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
        Number(parts.find((part) => part.type === type)?.value || 0);
    return get("hour") + get("minute") / 60;
}

export type Rgb = readonly [r: number, g: number, b: number];

/**
 * The look by the hour. The office keeps its lamps and screens lit at night; the garden goes navy. A colour multiplies
 * the picture (1 = as drawn).
 */
export interface Look {
    readonly inside: Rgb;
    readonly outside: Rgb;
    readonly lawn: Rgb;
    /** The wall faces. */
    readonly wall: Rgb;
    /** The saturated things out in the garden (flowers, wood), so they keep some colour at night. */
    readonly vivid: Rgb;
    readonly facade: Rgb;
    /** The ambient that warm fabrics and wood keep indoors (rugs, frames). */
    readonly warm: Rgb;
    /** The occlusion field's strength, then the direction and length of cast shadows (down-left from the late sun). */
    readonly shadow: readonly [strength: number, dx: number, dy: number, length: number];
    readonly lamps: number;
    /** The sunlight layer through the glass. */
    readonly sun: number;
    /** The cloud shadows. */
    readonly clouds: number;
    /** The reflection on the glass. */
    readonly sheen: number;
    /** Darkens the darks: an exponent below mid grey. */
    readonly toe: number;
    /** Pulls the darks toward navy. */
    readonly darks: number;
    /** The colour outside. */
    readonly sat: number;
    /** The late sun through the glass, in diagonal bands. */
    readonly shafts: number;
    /** The tint of the panes. */
    readonly glass: readonly [r: number, g: number, b: number, amount: number];
}

const NIGHT: Look = {
    inside: [0.5, 0.53, 0.64],
    outside: [0.31, 0.37, 0.59],
    lawn: [0.1, 0.27, 0.6],
    wall: [0.3, 0.36, 0.54],
    vivid: [0.58, 0.42, 0.62],
    facade: [0.42, 0.46, 0.62],
    warm: [0.62, 0.53, 0.5],
    shadow: [0.18, 0, 0, 0],
    lamps: 1,
    sun: 0,
    clouds: 0,
    sheen: 0,
    toe: 1.2,
    darks: 1,
    sat: 1,
    shafts: 0,
    glass: [0.2, 0.33, 0.55, 0.6],
};
const DAWN: Look = {
    inside: [0.88, 0.86, 0.94],
    outside: [0.66, 0.64, 0.8],
    lawn: [0.56, 0.62, 0.8],
    wall: [0.7, 0.7, 0.82],
    vivid: [0.8, 0.72, 0.84],
    facade: [0.8, 0.8, 0.88],
    warm: [0.9, 0.86, 0.9],
    shadow: [0.24, 0, 1, 3],
    lamps: 0.45,
    sun: 0.5,
    clouds: 0.5,
    sheen: 0.8,
    toe: 1.05,
    darks: 0.4,
    sat: 1.05,
    shafts: 0,
    glass: [0.55, 0.62, 0.82, 0.28],
};
const DAY: Look = {
    inside: [1, 1, 1],
    outside: [1, 1, 1],
    lawn: [0.97, 1, 0.92],
    wall: [1, 1, 1],
    vivid: [1, 1, 1],
    facade: [1, 1, 1],
    warm: [1, 1, 1],
    shadow: [0.18, 0, 1, 3],
    lamps: 0,
    sun: 1,
    clouds: 1,
    sheen: 1,
    toe: 1,
    darks: 0,
    sat: 1.22,
    shafts: 0,
    glass: [0.3, 0.75, 0.95, 0.26],
};
const AFTERNOON: Look = { ...DAY, warm: [1, 0.95, 0.86], shadow: [0.2, -0.5, 0.8, 5] };
const GOLDEN: Look = {
    inside: [1, 0.77, 0.5],
    outside: [1.02, 0.76, 0.53],
    lawn: [1.02, 0.78, 0.5],
    wall: [0.72, 0.62, 0.6],
    vivid: [1, 0.8, 0.6],
    facade: [0.9, 0.86, 0.82],
    warm: [1, 0.8, 0.6],
    shadow: [0.26, -0.7, 0.7, 8],
    lamps: 0.8,
    sun: 1,
    clouds: 0.75,
    sheen: 1,
    toe: 1.12,
    darks: 0.9,
    sat: 1.1,
    shafts: 1,
    glass: [0.95, 0.72, 0.5, 0.25],
};
const SUNSET: Look = {
    inside: [0.86, 0.68, 0.6],
    outside: [0.76, 0.58, 0.6],
    lawn: [0.62, 0.5, 0.55],
    wall: [0.6, 0.48, 0.5],
    vivid: [0.86, 0.66, 0.64],
    facade: [0.8, 0.68, 0.66],
    warm: [0.86, 0.68, 0.6],
    shadow: [0.32, -0.7, 0.7, 7],
    lamps: 0.9,
    sun: 0.3,
    clouds: 0.35,
    sheen: 0.6,
    toe: 1.15,
    darks: 0.9,
    sat: 1.05,
    shafts: 0.4,
    glass: [0.7, 0.48, 0.52, 0.35],
};
const DUSK: Look = {
    inside: [0.62, 0.63, 0.75],
    outside: [0.4, 0.43, 0.64],
    lawn: [0.2, 0.33, 0.62],
    wall: [0.42, 0.46, 0.62],
    vivid: [0.64, 0.52, 0.68],
    facade: [0.5, 0.52, 0.7],
    warm: [0.7, 0.6, 0.58],
    shadow: [0.2, 0, 0, 0],
    lamps: 1,
    sun: 0,
    clouds: 0,
    sheen: 0.3,
    toe: 1.18,
    darks: 0.9,
    sat: 1,
    shafts: 0,
    glass: [0.3, 0.36, 0.55, 0.5],
};

export const KEYFRAMES: readonly (readonly [hour: number, look: Look])[] = [
    [0, NIGHT],
    [5.2, NIGHT],
    [6.3, DAWN],
    [7.5, DAY],
    [13.5, DAY],
    [15.5, AFTERNOON],
    [16.3, AFTERNOON],
    [17.4, GOLDEN],
    [18.3, SUNSET],
    [19.3, DUSK],
    [20.3, NIGHT],
    [24, NIGHT],
];

type Vec4 = readonly [number, number, number, number];

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mix4 = (a: Vec4, b: Vec4, t: number): [number, number, number, number] => [
    mix(a[0], b[0], t),
    mix(a[1], b[1], t),
    mix(a[2], b[2], t),
    mix(a[3], b[3], t),
];

/** The look at a decimal hour, eased between the keyframes. */
export function daylight(hour: number): Look {
    const h = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1][0] <= h) i += 1;
    const [h0, a] = KEYFRAMES[i];
    const [h1, b] = KEYFRAMES[i + 1];
    const t0 = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
    const t = t0 * t0 * (3 - 2 * t0);
    return {
        inside: mix3(a.inside, b.inside, t),
        outside: mix3(a.outside, b.outside, t),
        lawn: mix3(a.lawn, b.lawn, t),
        wall: mix3(a.wall, b.wall, t),
        vivid: mix3(a.vivid, b.vivid, t),
        facade: mix3(a.facade, b.facade, t),
        warm: mix3(a.warm, b.warm, t),
        shadow: mix4(a.shadow, b.shadow, t),
        lamps: mix(a.lamps, b.lamps, t),
        sun: mix(a.sun, b.sun, t),
        clouds: mix(a.clouds, b.clouds, t),
        sheen: mix(a.sheen, b.sheen, t),
        toe: mix(a.toe, b.toe, t),
        darks: mix(a.darks, b.darks, t),
        sat: mix(a.sat, b.sat, t),
        shafts: mix(a.shafts, b.shafts, t),
        glass: mix4(a.glass, b.glass, t),
    };
}

/**
 * True when the look leaves the inside as drawn (plain day): the camera pass can stay off indoors (outside, the day's
 * colour and the clouds keep it on while the garden is in view).
 */
export function isPlainDay(look: Look): boolean {
    const one = (v: number): boolean => Math.abs(v - 1) < 1e-3;
    return (
        look.lamps <= 0 &&
        look.shafts <= 0 &&
        look.darks <= 0 &&
        one(look.toe) &&
        [...look.inside, ...look.wall, ...look.facade].every(one)
    );
}

// With the light switched off the office keeps the art's colours all day: a day without the garden's extra saturation,
// the lamps or the late sun; clouds, the glass sheen and the shade at the foot of things keep their own switches.
const AS_DRAWN: Look = { ...DAY, lawn: [1, 1, 1], sat: 1 };

/** The look at an hour, or the art's own colours when the light is off. */
export function lookAt(hour: number, features: Pick<FeatureSwitches, "light">): Look {
    return features.light ? daylight(hour) : { ...AS_DRAWN };
}
