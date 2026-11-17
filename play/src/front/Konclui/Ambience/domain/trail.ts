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
        this.last.set(id, { x, y, count });
        if (!prev || !onLawn) return false; // the first sighting is where someone stands, not a step
        const foot = count % 3 === 0 ? (count % 6 === 0 ? 1 : 2) : 0;
        this.steps.push({ x, y, at: now, angle: Math.atan2(y - prev.y, x - prev.x), foot });
        if (this.steps.length > this.max) this.steps.splice(0, this.steps.length - this.max);
        return true;
    }

    alive(now: number): boolean {
        this.steps = this.steps.filter((s) => now - s.at < this.life);
        return this.steps.length > 0;
    }

    /** [x, y, age 0..1 + 2 * foot, angle] per step, `max` slots, and the step count, for the shader. */
    uniforms(now: number): [data: Float32Array, count: number] {
        this.alive(now);
        const data = new Float32Array(this.max * 4);
        this.steps.forEach((s, i) =>
            data.set([s.x, s.y, Math.min(0.999, (now - s.at) / this.life) + 2 * s.foot, s.angle], i * 4),
        );
        return [data, this.steps.length];
    }

    forget(ids: ReadonlySet<WalkerId>): void {
        for (const id of [...this.last.keys()]) if (!ids.has(id)) this.last.delete(id);
    }
}
