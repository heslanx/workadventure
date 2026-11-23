/**
 * The people's floor shadows as the scene composites them (plan 2f): one stamp from the runtime's atlas under each
 * person's feet, picked by the runtime's `pickPersonShadow` (strongest lamp at the feet, else the key), blended into the
 * colour frame before the bodies are drawn. The atlas and the pick are the runtime's; this module only places them.
 */
import type { Light } from "../../play/src/front/Konclui/Ambience/domain/lights";
import type { Point } from "./args";
import type { KeyLightLike } from "./uniforms";

/** A person's shadow as the runtime's record holds it. */
export interface PersonShadowLike {
    direction: number;
    lengthClass: number;
    alpha: number;
    picked: boolean;
}

export interface StampHooks {
    personShadowFrames?: () => Uint8ClampedArray;
    pickPersonShadow?: (
        out: PersonShadowLike,
        x: number,
        y: number,
        pools: readonly Light[],
        lamps: number,
        key: never,
        keyStrength: number,
    ) => void;
    newPersonShadow?: () => PersonShadowLike;
    stampFrameAt?: (direction: number, lengthClass: number) => readonly [number, number];
    STAMP_SIZE?: number;
    STAMP_ATLAS_WIDTH?: number;
    STAMP_COLOUR?: readonly [number, number, number];
}

export interface Stamp {
    readonly x: number;
    readonly y: number;
    readonly direction: number;
    readonly lengthClass: number;
    readonly alpha: number;
}

export interface StampPlan {
    readonly stamps: readonly Stamp[];
    readonly atlas: Uint8ClampedArray;
}

const NEEDED = ["personShadowFrames", "pickPersonShadow", "newPersonShadow", "stampFrameAt"] as const;

export function missingStampHooks(hooks: StampHooks): string[] {
    return NEEDED.filter((name) => typeof hooks[name] !== "function");
}

/** One stamp for each person, as the scene would pick them on its first frame (no hysteresis to carry). */
export function planStamps(
    hooks: StampHooks,
    feet: readonly Point[],
    pools: readonly Light[],
    lamps: number,
    key: KeyLightLike,
): StampPlan | null {
    if (missingStampHooks(hooks).length > 0) return null;
    const { personShadowFrames, pickPersonShadow, newPersonShadow } = hooks as Required<
        Pick<StampHooks, "personShadowFrames" | "pickPersonShadow" | "newPersonShadow">
    >;
    const stamps = feet.map((foot): Stamp => {
        const shadow = newPersonShadow();
        pickPersonShadow(
            shadow,
            Math.round(foot.x),
            Math.round(foot.y),
            pools,
            lamps,
            key as never,
            Number(key.strength),
        );
        return {
            x: Math.round(foot.x),
            y: Math.round(foot.y),
            direction: shadow.direction,
            lengthClass: shadow.lengthClass,
            alpha: shadow.alpha,
        };
    });
    return { stamps, atlas: personShadowFrames() };
}

/** Blends the stamps into an RGBA frame (row 0 on top), feet at the middle of each 40 x 40 frame. Returns pixels written. */
export function compositeStamps(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    plan: StampPlan,
    hooks: StampHooks,
): number {
    const size = hooks.STAMP_SIZE ?? 40;
    const atlasWidth = hooks.STAMP_ATLAS_WIDTH ?? size * 16;
    const colour = hooks.STAMP_COLOUR ?? [10, 10, 61];
    const at = hooks.stampFrameAt;
    if (!at) return 0;
    let written = 0;
    for (const stamp of plan.stamps) {
        const [ox, oy] = at(stamp.direction, stamp.lengthClass);
        for (let y = 0; y < size; y++) {
            const my = stamp.y - size / 2 + y;
            if (my < 0 || my >= height) continue;
            for (let x = 0; x < size; x++) {
                const mx = stamp.x - size / 2 + x;
                if (mx < 0 || mx >= width) continue;
                const a = (plan.atlas[((oy + y) * atlasWidth + ox + x) * 4 + 3] / 255) * stamp.alpha;
                if (a <= 0) continue;
                const i = (my * width + mx) * 4;
                for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c] * (1 - a) + colour[c] * a;
                written += 1;
            }
        }
    }
    return written;
}
