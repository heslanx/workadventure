/**
 * The uniforms of the camera pass for a given hour, view and crowd. The pure parts of the runtime are imported, not
 * copied (lookAt, lightsFrom, staticLights, visibleLights, visibleRects, touchesView, EMISSIVE_TINTS). SceneEffects
 * itself is too entangled with Phaser to import, so the few lines of its `postUniforms` that pack those results are
 * mirrored here; each mirrored line is listed in shader-lab/README.md ("Mirrored from the runtime") so a drift shows.
 * When the runtime exports `lightUniformsInto` (plan 1d) the lab calls it instead of its own mirror of the pool packing.
 */
import {
    EMISSIVE_TINTS,
    lightsFrom,
    staticLights,
    touchesView,
    visibleLights,
    visibleRects,
    type EmissiveRect,
    type Light,
    type SpriteSpec,
} from "../../play/src/front/Konclui/Ambience/domain/lights";
import { lookAt, type Look } from "../../play/src/front/Konclui/Ambience/domain/timeOfDay";
import type { Rect } from "../../play/src/front/Konclui/Ambience/domain/geometry";
import type { Point } from "./args";
import type { Placement } from "./placements";

export type UniformValue = number | number[] | Float32Array;
export type UniformRecord = Record<string, UniformValue>;

/** The slice of fx/manifest.json the uniforms need. */
export interface ManifestSlice {
    readonly map: readonly [number, number];
    readonly lights: Readonly<Partial<Record<string, SpriteSpec>>>;
    readonly spaces?: readonly Rect[];
    readonly staticLights?: readonly unknown[];
    readonly ink: readonly [number, number, number];
}

export const MAX_POOLS = 32;
export const MAX_GLOW = 24;
export const GLOW_CANDIDATES = 64;
export const MAX_PEOPLE = 8;

/** Optional exports of the runtime lane (plan 1d), handed in by the bundle entry when their files exist. */
export interface RuntimeHooks {
    lightUniformsInto?: (
        lit: readonly Light[],
        look: Look,
        L: Float32Array,
        LC: Float32Array,
        LClip: Float32Array,
    ) => void;
    // method syntax on purpose: the runtime's own records have more fields than the lab reads, and a method's
    // parameters are checked bivariantly
    keyLightAt?(hour: number, out: KeyLightLike): number;
    newKeyLight?(): KeyLightLike;
    newShadeUniforms?(): ShadeUniformsLike;
    shadeUniformsInto?(out: ShadeUniformsLike, key: KeyLightLike, level: 0 | 1 | 2): void;
}

/** The runtime's KeyLight record: the lab reads dirIndex and length for its report and hands the rest through. */
export interface KeyLightLike {
    dirIndex: number;
    length: number;
    strength: number;
}

export interface ShadeUniformsLike {
    shade: number[];
    key: number[];
    keyShade: number[];
}

export interface Lights {
    readonly pools: Light[];
    readonly emissive: EmissiveRect[];
}

/** The lights of the built map: lamps and screens of the placed pieces, then the manifest's static lights. */
export function mapLights(manifest: ManifestSlice, placements: readonly Placement[]): Lights {
    const { pools, emissive } = lightsFrom(
        placements.map((p) => ({ key: `/entities/${p.key}`, x: p.x, y: p.y })),
        manifest.lights,
        manifest.spaces,
        () => false,
    );
    const statics = staticLights(manifest.staticLights as never);
    return { pools: [...pools, ...statics], emissive };
}

export interface PostInput {
    readonly manifest: ManifestSlice;
    readonly lights: Lights;
    readonly hour: number;
    readonly view: readonly [number, number, number, number];
    readonly resolution: readonly [number, number];
    readonly people: readonly Point[];
    readonly clouds: boolean;
    /** The legacy rim (uRimOn) and the normals texture (uNormalsOn). */
    readonly rim: 0 | 1;
    readonly normalsOn: 0 | 1;
    readonly hooks?: RuntimeHooks;
}

export interface PostUniforms {
    readonly look: Look;
    readonly values: UniformRecord;
    readonly lit: Light[];
    /** What was left out and why: printed by the lab. */
    readonly notes: string[];
}

/**
 * Every uniform POST declares. Arrays are flattened (`uL[0]` is the name a GL driver reports for the first element,
 * which is how SceneEffects names them too).
 */
export function postUniforms(input: PostInput): PostUniforms {
    const { manifest, lights, hour, view, resolution } = input;
    const notes: string[] = [];
    // mirrored: SceneEffects.refresh (`lookAt(hour, features)` with the light switch on)
    const look = lookAt(hour, { light: true });
    // mirrored: SceneEffects (night = look.lamps >= 0.9; pools that are night-only count then)
    const night = look.lamps >= 0.9;
    const lit =
        look.lamps > 0
            ? visibleLights(
                  lights.pools.filter((l) => !l.night || night),
                  view,
                  MAX_POOLS,
              )
            : [];
    const L = new Float32Array(128);
    const LC = new Float32Array(128);
    const LClip = new Float32Array(128);
    if (input.hooks?.lightUniformsInto) {
        input.hooks.lightUniformsInto(lit, look, L, LC, LClip);
    } else {
        // mirrored: SceneEffects.postUniforms, the loop over `lit`
        for (let i = 0; i < lit.length; i++) {
            const l = lit[i];
            const o = i * 4;
            L[o] = l.x;
            L[o + 1] = l.y;
            L[o + 2] = l.halo ? -l.reach : l.reach;
            L[o + 3] = l.squash;
            LC[o] = l.color[0];
            LC[o + 1] = l.color[1];
            LC[o + 2] = l.color[2];
            LC[o + 3] = l.power * (l.self ? Math.max(look.lamps, 0.75) : look.lamps);
            if (l.clip) {
                LClip[o] = l.clip[0];
                LClip[o + 1] = l.clip[1];
                LClip[o + 2] = l.clip[2];
                LClip[o + 3] = l.clip[3];
            }
        }
    }
    // mirrored: SceneEffects.postUniforms, the glow rectangles (the tint index rides in the width's fraction)
    const em = new Float32Array(MAX_GLOW * 4);
    let glowCount = 0;
    if (look.lamps > 0) {
        const candidates = visibleRects(lights.emissive, view, GLOW_CANDIDATES);
        for (let i = 0; i < candidates.length && glowCount < MAX_GLOW; i++) {
            const g = candidates[i];
            if (!touchesView(g.rect, view)) continue;
            em[glowCount * 4] = g.rect[0];
            em[glowCount * 4 + 1] = g.rect[1];
            em[glowCount * 4 + 2] = g.rect[2] + g.tint / 8;
            em[glowCount * 4 + 3] = g.rect[3];
            glowCount += 1;
        }
    }
    const tints = new Float32Array(16);
    EMISSIVE_TINTS.forEach((tint, i) => tints.set(tint, i * 4));
    const people = new Float32Array(MAX_PEOPLE * 4);
    const peopleN = Math.min(input.people.length, MAX_PEOPLE);
    for (let i = 0; i < peopleN; i++) {
        people[i * 4] = input.people[i].x;
        people[i * 4 + 1] = input.people[i].y;
    }
    // mirrored: SceneEffects fields `shafts`, `cloud`, `vignetteUniform`, `revealUniform` and the postUniforms writes:
    // the slope 0.84 and the 58/24 widths of the shafts, the cloud scale 236 with no drift, no vignette, no iris
    const values: UniformRecord = {
        uWorld: [view[0], view[1], view[2], view[3]],
        uMap: [manifest.map[0], manifest.map[1]],
        uRes: [resolution[0], resolution[1]],
        uInside: [...look.inside],
        uOutside: [...look.outside],
        uLawn: [...look.lawn],
        uWall: [...look.wall],
        uVivid: [...look.vivid],
        uFacade: [...look.facade],
        uWarm: [...look.warm],
        uToe: look.toe,
        uDarks: look.darks,
        uSat: look.sat,
        uNight: look.lamps,
        "uL[0]": L,
        "uLC[0]": LC,
        "uLClip[0]": LClip,
        uLN: lit.length,
        "uEm[0]": em,
        "uEmT[0]": tints,
        uEmN: glowCount,
        uShafts: [look.shafts, 58, 24, 0.84],
        uCloud: [input.clouds ? look.clouds : 0, 236, 0, 0],
        "uLock[0]": new Float32Array(24),
        uLockN: 0,
        uFrost: [0.59, 0.8, 0.76],
        "uSteps[0]": new Float32Array(128),
        uStepN: 0,
        uLime: [0.78, 0.95, 0.32],
        uCream: [0.97, 0.94, 0.78],
        "uAv[0]": new Float32Array(MAX_PEOPLE * 4),
        uAvN: 0,
        "uPeople[0]": people,
        uPeopleN: peopleN,
        uNormalsOn: input.normalsOn,
        uRimOn: input.rim,
        uVignette: [0, 0.62],
        uReveal: [0, 0, -1, 0],
        uInk: manifest.ink.map((c) => c / 255),
    };
    notes.push(`${lit.length} lights, ${glowCount} glows, ${peopleN} people in the uniform`);
    return { look, values, lit, notes };
}

/**
 * The uniforms only the shaded program has (plan 1b). With the runtime's keyLight.ts and shadeUniforms.ts present the
 * lab calls them; otherwise it sets the plan's sunset key (down-left, 45 degrees) and says so. A call that fails falls
 * back to the constants and the reason goes into the notes, so a mismatch is loud and the run still draws.
 */
export function shadeUniforms(
    level: 1 | 2,
    hour: number,
    look: Look,
    hooks: RuntimeHooks | undefined,
): { values: UniformRecord; source: string; notes: string[]; key: { dirIndex: number; length: number } | null } {
    const notes: string[] = [];
    if (hooks?.keyLightAt && hooks.newKeyLight && hooks.newShadeUniforms && hooks.shadeUniformsInto) {
        try {
            const key = hooks.newKeyLight();
            hooks.keyLightAt(hour, key);
            const out = hooks.newShadeUniforms();
            hooks.shadeUniformsInto(out, key, level);
            return {
                values: { uShade: [...out.shade], uKey: [...out.key], uKeyShade: [...out.keyShade] },
                source: "runtime keyLight.ts + shadeUniforms.ts",
                notes,
                key: { dirIndex: key.dirIndex, length: key.length },
            };
        } catch (error: unknown) {
            notes.push(
                `the runtime's keyLightAt/shadeUniformsInto failed (${String(error)}); the lab's constants are used`,
            );
        }
    }
    const day = [0.5, 0.58, 0.8];
    const night = [0.36, 0.4, 0.66];
    const mix = Math.min(1, look.lamps);
    return {
        values: {
            uShade: [level, 0.42, 0.6, 0.9],
            uKey: [-Math.SQRT1_2, Math.SQRT1_2, 1, 1],
            uKeyShade: day.map((d, i) => d + (night[i] - d) * mix),
        },
        source: "lab constants (plan 2d sunset key)",
        notes,
        key: null,
    };
}
