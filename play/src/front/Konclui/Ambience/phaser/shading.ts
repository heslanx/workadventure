// The shading of a room (konclui.fx.rim): the cast texture and its bake, the key light, the marks on the people and the
// stamps under them. SceneEffects owns one while the flag is on and asks it for four things: set the pieces when they
// change, set the hour, run a frame, and write its uniforms. Everything here is counted in frames and items, never in
// wall-clock time: `frame(now)` takes the effects' own frame time, so a test drives it with numbers.
import type { CasterKind, KindInput } from "../domain/casterKind";
import { classifyPiece, kindFromKey } from "../domain/casterKind";
import type { EffectsManifest } from "../domain/effectsManifest";
import { keyLightAt, newKeyLight, type KeyLight } from "../domain/keyLight";
import { casterLampsFrom } from "../domain/lamps";
import { specKey, type Light } from "../domain/lights";
import { newPersonShadow, pickStamp, type PersonShadow } from "../domain/personShadow";
import type { Pixels } from "../domain/pixelMaps";
import { CastBake, type BakeInput, type BakePiece } from "../domain/shadeBake";
import { hasPaintedShadow, placedSilhouette, silhouetteOf, type Silhouette } from "../domain/shadeShapes";
import { newShadeUniforms, shadeUniformsInto } from "../domain/shadeUniforms";
import type { ShadingLevel } from "../domain/shadingLevel";
import { CastTexture, type CastRenderer } from "./castTexture";
import { PeopleMarks, type MarkRenderer } from "./peopleMark";
import type { PeopleStamps } from "./peopleShadow";
import type { UniformValue } from "./postFilter";

/** Casters worked out in one frame: a count of items, never a time. */
export const BAKE_SLICE = 64;
/** Sprites measured in one frame at load. */
export const MEASURE_SLICE = 24;
/** The bake waits this long (in the effects' frame time) after the last change to a piece: a piece being dragged is not baked. */
export const STABLE_MS = 1000;
/** A bake's result goes up at most this often. */
export const UPLOAD_EVERY_MS = 250;
/** A person who moves has their stamp picked again on every this many frames. */
export const PICK_EVERY = 4;
/**
 * With more people than this drawn, only this many carry a mark: the player and the nearest to the view's centre. A mark
 * is a blend mode of its own, so each marked avatar among the props breaks the draw into batches: measured in a real
 * Phaser 4.2.1 game (WebGL 1, ANGLE on an M1 Max), 4 draw calls more for each marked avatar, 324 more for 80. 20 is
 * about the plan's gate of 80 more calls; at level 1 half of that.
 */
export const MARKED_AT_LEVEL_2 = 20;
export const MARKED_AT_LEVEL_1 = 10;
/**
 * The avatars drawn in full beyond the marks' cap that the shader is told about (`uCrowd`): the nearest to the view's centre. The
 * rest take a prop's relief when they stand in front of one (an unmarked avatar is a pixel of the picture like any other); the
 * eight slots are what the uniform budget leaves (209 vectors of the 212 the tests allow).
 */
export const CROWD_SLOTS = 8;

/** A placed picture as the shading reads it: Phaser's Image has all of this. */
export interface ShadePlaced {
    readonly texture: { readonly key: string; getSourceImage(): unknown };
    readonly x: number;
    readonly y: number;
    readonly flipX: boolean;
    readonly displayWidth: number;
    readonly displayHeight: number;
    getPrefab?(): KindInput | undefined;
}

/** A person drawn in full, as the effects keep them: feet and the shadow's state. */
export interface ShadePerson {
    x: number;
    y: number;
    /** The player: always marked. */
    readonly me?: boolean;
    readonly shadow: PersonShadow;
}

/** A character's body: its sprites and its depth. */
export interface ShadeBody {
    readonly list: readonly unknown[];
    readonly depth?: number;
}

export interface ShadingOptions {
    readonly renderer: CastRenderer & MarkRenderer;
    readonly manifest: EffectsManifest;
    readonly level: ShadingLevel;
    /** Whether a map pixel is a wall: the masks' bit. */
    readonly isWall: (x: number, y: number) => boolean;
    /** The RGBA of a texture's source picture, or undefined when it cannot be read. */
    readonly readPixels: (source: unknown) => Pixels | undefined;
    /** The stamps under the people; undefined where the scene cannot make them. */
    readonly stamps?: PeopleStamps;
}

/** What `frame` is given: the people drawn in full this frame, their bodies, and the lights in view. */
export interface PeopleFrame {
    readonly count: number;
    readonly people: readonly ShadePerson[];
    readonly bodies: readonly ShadeBody[];
    /** DrawnPeople looked at every character again since the last frame: marks are made again. */
    readonly rebuilt: boolean;
    readonly pools: readonly Light[];
    /** The night's strength, 0 by day. */
    readonly lamps: number;
    readonly centre: readonly [x: number, y: number];
}

interface Measured {
    readonly silhouette: Silhouette | null;
    readonly painted: boolean;
}

export class Shading {
    readonly key: KeyLight = newKeyLight();
    readonly uniforms = newShadeUniforms();
    readonly cast: CastTexture;
    private readonly marks: PeopleMarks;
    private current: ShadingLevel;
    private keyState = -1;
    private placed: readonly ShadePlaced[] = [];
    private readonly measured = new Map<string, Measured>();
    private unmeasured: ShadePlaced[] = [];
    private dirtyFixed = true;
    private dirtyKey = true;
    private changedAt = Number.NEGATIVE_INFINITY;
    private uploadedAt = Number.NEGATIVE_INFINITY;
    private job: CastBake | undefined;
    private jobFinishedNeedsUpload = false;
    private marksNeeded = true;
    // what a stamp is picked in: the lights drawn now, the night, and the key (one record, rewritten each frame)
    private readonly light: { pools: readonly Light[]; lamps: number; key: KeyLight } = {
        pools: [],
        lamps: 0,
        key: this.key,
    };
    private tick = 0;
    private readonly nearest = new Int32Array(MARKED_AT_LEVEL_2);
    // the unmarked avatars the shader is told about: their indices among the people, kept between rebuilds, and the flags that
    // say who is marked (made again only when the crowd outgrows them)
    private readonly crowdIndex = new Int32Array(CROWD_SLOTS);
    private readonly crowdRank = new Float64Array(CROWD_SLOTS);
    private crowdCount = 0;
    private markedFlags = new Uint8Array(64);
    /** `uCrowd`: x, y, 1 of each of those avatars' feet, rewritten each frame; z 0 ends the list. */
    readonly crowd = new Float32Array(CROWD_SLOTS * 4);
    private readonly nearestRank = new Float64Array(MARKED_AT_LEVEL_2);
    private readonly width: number;
    private readonly height: number;
    /** Counts for tests and the lab: whole bakes finished, slices run, silhouettes measured. */
    bakes = 0;
    slices = 0;
    measures = 0;

    constructor(private readonly options: ShadingOptions) {
        this.current = options.level;
        [this.width, this.height] = options.manifest.map;
        this.cast = new CastTexture(options.renderer, this.width, this.height);
        this.marks = new PeopleMarks(options.renderer);
        shadeUniformsInto(this.uniforms, this.key, this.current);
    }

    get level(): ShadingLevel {
        return this.current;
    }

    /** A change of level: 0 takes the marks off and parks the stamps; above 0 marks are made again at the next frame. */
    setLevel(level: ShadingLevel): void {
        if (level === this.current) return;
        this.current = level;
        if (level === 0) {
            this.marks.unmark();
            this.crowdCount = 0;
            this.crowd.fill(0);
            this.options.stamps?.hideFrom(0);
        } else {
            this.marksNeeded = true;
        }
        shadeUniformsInto(this.uniforms, this.key, this.current);
    }

    /** The cast texture's GPU side, for the camera pass's unit 3. */
    get glTexture(): CastTexture["glTexture"] {
        return this.cast.glTexture;
    }

    /**
     * The map's placed pieces changed: the bake starts again once they hold still. `settled` is the build's first read of
     * pieces that are all there already: nothing is being moved, so the bake need not wait.
     */
    setPieces(placed: readonly ShadePlaced[], now: number, settled = false): void {
        // the effects' own images (a TV's slide) are in the scene's list too: they are not pieces of the map
        this.placed = placed.filter((p) => !p.texture.key.startsWith("kfx-"));
        this.changedAt = settled ? Number.NEGATIVE_INFINITY : now;
        this.dirtyFixed = true;
        this.dirtyKey = true;
        this.job = undefined;
        this.unmeasured = this.placed.filter((p) => !this.measured.has(this.keyOf(p)));
    }

    /** The hour changed: true when the key's snapped state did, which is when only its channel is baked again. */
    setHour(hour: number): boolean {
        const state = keyLightAt(hour, this.key);
        shadeUniformsInto(this.uniforms, this.key, this.current);
        if (state === this.keyState) return false;
        this.keyState = state;
        this.dirtyKey = true;
        // a job in progress was made for the old key: start it again with this one, keeping its fixed part if it had one
        if (this.job?.parts.key) {
            if (this.job.parts.fixed) this.dirtyFixed = true;
            this.job = undefined;
        }
        return true;
    }

    private keyOf(p: ShadePlaced): string {
        return specKey(p.texture.key) ?? p.texture.key;
    }

    /** What a piece is to the shading: the build's word, else its prefab's, else its folder's. */
    private kindOf(p: ShadePlaced): CasterKind {
        const key = this.keyOf(p);
        const built = this.options.manifest.kinds?.[key];
        if (built) return built;
        const prefab = p.getPrefab?.();
        return prefab ? classifyPiece({ ...prefab, key }) : kindFromKey(key);
    }

    private measure(p: ShadePlaced): Measured {
        const key = this.keyOf(p);
        const pixels = this.options.readPixels(p.texture.getSourceImage());
        const silhouette = pixels ? silhouetteOf(pixels, pixels.width, pixels.height) : null;
        const built = key in this.options.manifest.lights || key in (this.options.manifest.shadows ?? {});
        // a piece the build knows is told by its `painted` list; one the editor added is read from its picture
        const painted = built
            ? (this.options.manifest.painted ?? []).includes(key)
            : Boolean(pixels && silhouette && hasPaintedShadow(pixels, pixels.width, pixels.height, silhouette));
        const m = { silhouette, painted };
        this.measured.set(key, m);
        this.measures += 1;
        return m;
    }

    /** One frame: measure some sprites, run a slice of the bake, put a finished bake on the GPU, mark and stamp people. */
    frame(now: number, people: PeopleFrame): void {
        if (this.current === 0) return;
        this.advance(now);
        this.dress(people);
    }

    private advance(now: number): void {
        let n = 0;
        while (this.unmeasured.length > 0 && n < MEASURE_SLICE) {
            const p = this.unmeasured.pop();
            if (p && !this.measured.has(this.keyOf(p))) {
                this.measure(p);
                n += 1;
            }
        }
        if (
            !this.job &&
            this.unmeasured.length === 0 &&
            (this.dirtyFixed || this.dirtyKey) &&
            now - this.changedAt >= STABLE_MS
        ) {
            this.job = new CastBake(
                this.bakeInput(),
                this.cast.pixels,
                {},
                { fixed: this.dirtyFixed, key: this.dirtyKey },
            );
            this.dirtyFixed = false;
            this.dirtyKey = false;
        }
        if (this.job) {
            this.slices += 1;
            if (this.job.step(BAKE_SLICE)) {
                this.job = undefined;
                this.jobFinishedNeedsUpload = true;
            }
        }
        if (this.jobFinishedNeedsUpload && !this.job && now - this.uploadedAt >= UPLOAD_EVERY_MS) {
            this.cast.upload();
            this.uploadedAt = now;
            this.jobFinishedNeedsUpload = false;
            this.bakes += 1;
        }
    }

    /** The input of a bake: every placed piece with its kind, its shape as it is drawn, and the lamps among them. */
    private bakeInput(): BakeInput {
        const { manifest } = this.options;
        const pieces: BakePiece[] = this.placed.map((p) => {
            const m = this.measured.get(this.keyOf(p));
            const sil =
                m?.silhouette && p.displayWidth > 0 && p.displayHeight > 0
                    ? placedSilhouette(m.silhouette, p.displayWidth, p.displayHeight, p.flipX)
                    : (m?.silhouette ?? null);
            return {
                key: this.keyOf(p),
                x: Math.round(p.x),
                y: Math.round(p.y),
                kind: sil ? this.kindOf(p) : "hang", // a picture that could not be read casts nothing and hides nothing
                silhouette: sil,
                painted: m?.painted ?? false,
            };
        });
        return {
            width: this.width,
            height: this.height,
            pieces,
            spaces: manifest.spaces ?? [],
            building: manifest.building ?? null,
            lamps: casterLampsFrom(
                this.placed.map((p) => ({ key: p.texture.key, x: p.x, y: p.y })),
                manifest.lights,
                manifest.spaces ?? [],
            ),
            key: { ...this.key },
            isWall: this.options.isWall,
        };
    }

    /** Marks the people's sprites and puts a stamp under each. */
    private dress(frame: PeopleFrame): void {
        const { count, people, bodies } = frame;
        if (frame.rebuilt || this.marksNeeded) {
            this.marksNeeded = false;
            this.markPeople(frame);
        }
        this.placeCrowd(frame);
        const stamps = this.options.stamps;
        if (!stamps) return;
        const light = this.light;
        this.tick += 1;
        light.pools = frame.pools;
        light.lamps = frame.lamps;
        for (let i = 0; i < count; i++) {
            const p = people[i];
            // A person moving is picked for every PICK_EVERY-th frame, each on its own turn: a shadow that follows the light
            // 50 ms late is not seen, and 20 walkers cost the work of 5. One standing still is not picked again at all.
            if (!p.shadow.picked || (this.tick + i) % PICK_EVERY === 0) pickStamp(p, light);
            stamps.place(i, p, bodies[i]);
        }
        stamps.hideFrom(count);
    }

    private markPeople(frame: PeopleFrame): void {
        const { count, bodies, people } = frame;
        this.marks.forgetGone();
        this.crowdCount = 0;
        const cap = this.current === 1 ? MARKED_AT_LEVEL_1 : MARKED_AT_LEVEL_2;
        if (count <= cap) {
            for (let i = 0; i < count; i++) this.marks.mark(bodies[i].list);
            return;
        }
        // fewer marks, fewer batch breaks: the player keeps theirs, and so do the nearest to the view's centre
        this.marks.unmark();
        if (this.markedFlags.length < count)
            this.markedFlags = new Uint8Array(Math.max(count, this.markedFlags.length * 2));
        const flags = this.markedFlags;
        flags.fill(0, 0, count);
        const rank = this.nearestRank;
        const top = this.nearest;
        const room = cap - (people[0].me ? 1 : 0);
        let found = 0;
        for (let i = people[0].me ? 1 : 0; i < count; i++) {
            const dx = people[i].x - frame.centre[0];
            const dy = people[i].y - frame.centre[1];
            const d = dx * dx + dy * dy;
            if (found === room && d >= rank[found - 1]) continue;
            let at = found < room ? found : room - 1;
            while (at > 0 && rank[at - 1] > d) {
                rank[at] = rank[at - 1];
                top[at] = top[at - 1];
                at -= 1;
            }
            rank[at] = d;
            top[at] = i;
            if (found < room) found += 1;
        }
        if (people[0].me) {
            this.marks.mark(bodies[0].list);
            flags[0] = 1;
        }
        for (let k = 0; k < found; k++) {
            this.marks.mark(bodies[top[k]].list);
            flags[top[k]] = 1;
        }
        this.chooseCrowd(frame);
    }

    /** The unmarked avatars nearest the view's centre, up to `CROWD_SLOTS`, kept for the shader's `uCrowd` until the next rebuild. */
    private chooseCrowd(frame: PeopleFrame): void {
        const { count, people } = frame;
        const flags = this.markedFlags;
        const rank = this.crowdRank;
        const top = this.crowdIndex;
        let found = 0;
        for (let i = 0; i < count; i++) {
            if (flags[i] === 1) continue;
            const dx = people[i].x - frame.centre[0];
            const dy = people[i].y - frame.centre[1];
            const d = dx * dx + dy * dy;
            if (found === CROWD_SLOTS && d >= rank[found - 1]) continue;
            let at = found < CROWD_SLOTS ? found : CROWD_SLOTS - 1;
            while (at > 0 && rank[at - 1] > d) {
                rank[at] = rank[at - 1];
                top[at] = top[at - 1];
                at -= 1;
            }
            rank[at] = d;
            top[at] = i;
            if (found < CROWD_SLOTS) found += 1;
        }
        this.crowdCount = found;
    }

    /** `uCrowd`: the feet of the chosen unmarked avatars as they stand now. Nothing is made. */
    private placeCrowd(frame: PeopleFrame): void {
        const data = this.crowd;
        let n = 0;
        for (let k = 0; k < this.crowdCount; k++) {
            const i = this.crowdIndex[k];
            if (i >= frame.count) continue;
            const p = frame.people[i];
            data[n * 4] = p.x;
            data[n * 4 + 1] = p.y;
            data[n * 4 + 2] = 1;
            n += 1;
        }
        // the rest of the list is empty: a zero in z ends it in the shader
        for (let k = n; k < CROWD_SLOTS; k++) data[k * 4 + 2] = 0;
    }

    /** `uShade`, `uKey` and `uKeyShade` into the pass's record. */
    uniformsInto(u: Record<string, UniformValue>): void {
        u.uShade = this.uniforms.shade;
        u.uKey = this.uniforms.key;
        u.uKeyShade = this.uniforms.keyShade;
        u["uCrowd[0]"] = this.crowd;
    }

    /** The people marks in place now: for tests. */
    get marked(): number {
        return this.marks.size;
    }

    destroy(): void {
        this.marks.unmark();
        this.options.stamps?.destroy();
        this.cast.destroy();
        this.job = undefined;
    }
}

export { newPersonShadow };
