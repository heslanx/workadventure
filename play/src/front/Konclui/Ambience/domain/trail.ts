export type WalkerId = string | number;

export interface TrailStep {
    readonly x: number;
    readonly y: number;
    readonly at: number;
    readonly angle: number;
    /** 0 none, 1 right, 2 left. */
    readonly foot: 0 | 1 | 2;
}

export interface TrailOptions {
    readonly spacing?: number;
    readonly life?: number;
    readonly max?: number;
}

/**
 * Pressed grass behind walkers: a step every `spacing` px walked on the lawn, each fading over `life` ms, the newest
 * `max` drawn. Every third step is a footprint, left and right in turn; each step keeps the walking direction.
 */
export class Trail {
    readonly spacing: number;
    readonly life: number;
    readonly max: number;
    steps: TrailStep[] = [];
    private readonly last = new Map<WalkerId, { x: number; y: number; count: number }>();

    constructor({ spacing = 6, life = 3000, max = 48 }: TrailOptions = {}) {
        this.spacing = spacing;
        this.life = life;
        this.max = max;
    }

    step(id: WalkerId, x: number, y: number, now: number, onLawn: boolean): boolean {
        const prev = this.last.get(id);
        if (prev && Math.hypot(x - prev.x, y - prev.y) < this.spacing) return false;
        const count = (prev?.count || 0) + 1;
        const angle = prev ? Math.atan2(y - prev.y, x - prev.x) : 0;
        if (prev) {
            // the walker's record is rewritten, not replaced: a step is made for each few px of each walker
            prev.x = x;
            prev.y = y;
            prev.count = count;
        } else {
            this.last.set(id, { x, y, count });
        }
        if (!prev || !onLawn) return false; // the first sighting is where someone stands, not a step
        const foot = count % 3 === 0 ? (count % 6 === 0 ? 1 : 2) : 0;
        this.steps.push({ x, y, at: now, angle, foot });
        if (this.steps.length > this.max) this.steps.splice(0, this.steps.length - this.max);
        return true;
    }

    alive(now: number): boolean {
        // the oldest come first: drop them in place, a frame asks this and no array is made
        let expired = 0;
        while (expired < this.steps.length && now - this.steps[expired].at >= this.life) expired += 1;
        if (expired > 0) this.steps.splice(0, expired);
        return this.steps.length > 0;
    }

    /** [x, y, age 0..1 + 2 * foot, angle] per step, `max` slots, and the step count, for the shader. */
    uniforms(now: number): [data: Float32Array, count: number] {
        const data = new Float32Array(this.max * 4);
        return [data, this.uniformsInto(data, now)];
    }

    /** `uniforms` written into `out` (`max` x 4 numbers, cleared first), which allocates nothing: the step count. */
    uniformsInto(out: Float32Array, now: number): number {
        this.alive(now);
        out.fill(0);
        for (let i = 0; i < this.steps.length; i++) {
            const s = this.steps[i];
            out[i * 4] = s.x;
            out[i * 4 + 1] = s.y;
            out[i * 4 + 2] = Math.min(0.999, (now - s.at) / this.life) + 2 * s.foot;
            out[i * 4 + 3] = s.angle;
        }
        return this.steps.length;
    }

    forget(ids: ReadonlySet<WalkerId>): void {
        this.forgetUnless((id) => ids.has(id));
    }

    /** Forgets the walkers `known` does not know, without making a set of them. */
    forgetUnless(known: (id: WalkerId) => boolean): void {
        this.last.forEach((_record, id) => {
            if (!known(id)) this.last.delete(id);
        });
    }

    /** Forgets one walker, who left the view: back in it, the first sighting is where they stand, not a step. */
    release(id: WalkerId): void {
        this.last.delete(id);
    }
}
