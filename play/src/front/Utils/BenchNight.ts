/**
 * Night for a measurement, through the QA key the Koncluí effects already read: localStorage `konclui.fx.hour` fixes the
 * hour of the day (Konclui/Ambience/phaser/browserEffectsPort.ts, which takes the change within a second without a
 * reload). An upstream file must not import play/src/front/Konclui, so the key and the hour table below are the seam;
 * BenchNight.test.ts checks the table against the Koncluí `daylight()` so that a change of the keyframes fails there.
 *
 * "Night level" is the light factor the post pass reads as `uNight`: the lamps of the look at that hour (0 in daylight,
 * 1 from 19:18 on). The level fixes only that factor: the rest of the look (sun, shade, tints) is the one of the hour
 * the level maps to, which is dusk for any level above 0.
 */

export const FIXED_HOUR_KEY = "konclui.fx.hour";

/**
 * The lamps level from which the effects switch their night-only lights on (`const night = look.lamps >= 0.9` in
 * Konclui/Ambience/phaser/SceneEffects.ts; BenchNight.test.ts reads that line to keep the two equal).
 */
export const NIGHT_ON_LAMPS = 0.9;

/** The hour whose look has no lamps and the whole day's light. */
const DAY_HOUR = 12;

// [hour, lamps] of the evening keyframes of Konclui/Ambience/domain/timeOfDay.ts: the afternoon's end, golden hour,
// sunset and dusk. Between two of them the look eases with a smoothstep.
const EVENING: readonly (readonly [hour: number, lamps: number])[] = [
    [16.3, 0],
    [17.4, 0.8],
    [18.3, 0.9],
    [19.3, 1],
];

/** The t in 0..1 whose smoothstep 3t^2 - 2t^3 is `s` (the inverse of the easing between two keyframes). */
function inverseSmoothstep(s: number): number {
    return 0.5 - Math.sin(Math.asin(1 - 2 * s) / 3);
}

/** The decimal hour at which the lamps are at `level` (0 to 1). Throws for a level that is not in that range. */
export function hourForNightLevel(level: number): number {
    if (!Number.isFinite(level) || level < 0 || level > 1) {
        throw new Error(`The night level must be a number from 0 to 1 (got ${String(level)}).`);
    }
    if (level === 0) {
        return DAY_HOUR;
    }
    for (let i = 1; i < EVENING.length; i++) {
        const [fromHour, fromLamps] = EVENING[i - 1];
        const [toHour, toLamps] = EVENING[i];
        if (level <= toLamps) {
            return fromHour + (toHour - fromHour) * inverseSmoothstep((level - fromLamps) / (toLamps - fromLamps));
        }
    }
    return EVENING[EVENING.length - 1][0];
}

export interface BenchNightStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface BenchNightResult {
    /** The level asked for, or null when the clock was given back. */
    level: number | null;
    /** The hour now fixed, or null when the clock was given back. */
    hour: number | null;
    /** Whether the effects light their night-only lights at this level (false when the clock was given back). */
    nightOn: boolean;
}

/**
 * Fixes the effects' clock at the hour of `level`, or gives the clock back (`null`) with whatever the key held before
 * the first call. The effects take it within a second: the caller waits that long before it measures.
 */
export function createBenchNight(storage: BenchNightStorage) {
    let before: { value: string | null } | undefined;

    return function setBenchNight(level: number | null): BenchNightResult {
        if (level === null) {
            if (before !== undefined) {
                if (before.value === null) {
                    storage.removeItem(FIXED_HOUR_KEY);
                } else {
                    storage.setItem(FIXED_HOUR_KEY, before.value);
                }
                before = undefined;
            }
            return { level: null, hour: null, nightOn: false };
        }
        const hour = hourForNightLevel(level);
        before ??= { value: storage.getItem(FIXED_HOUR_KEY) };
        storage.setItem(FIXED_HOUR_KEY, hour.toFixed(4));
        return { level, hour: Number(hour.toFixed(4)), nightOn: level >= NIGHT_ON_LAMPS };
    };
}
