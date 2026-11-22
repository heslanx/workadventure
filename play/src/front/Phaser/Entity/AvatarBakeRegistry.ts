/**
 * The bookkeeping of baked avatar textures: which recipes are baked, who holds them, which one goes when there is no
 * room. It holds no Phaser object: the backend creates and destroys the textures, so this file is tested with a fake.
 *
 * A recipe is the ordered list of layer texture ids of an avatar (the order is the z-order, so it is never sorted).
 * A lease is one holder of a recipe. An entry with no lease is idle: it stays baked, so the next avatar with the same
 * recipe costs nothing, and it is the only kind that is evicted, least recently used first.
 */

/**
 * DERIVED, not measured: GL texture (96 x 128 x 4 B = 49,152 B) plus the canvas that backs it and is kept for context
 * restore (same size). A browser run (plan milestone M5) has to measure the real GPU and JS memory.
 */
export const BAKED_AVATAR_BYTES = 98_304;
/** The most baked recipes at once, leased or idle. A recipe that does not fit stays on its layers. */
export const DEFAULT_MAX_BAKED_RECIPES = 192;
/** The most idle recipes kept for a next avatar. The oldest ones go as an avatar lets go of its recipe. */
export const DEFAULT_MAX_IDLE_BAKED_RECIPES = 64;

/**
 * What a bake came to. Each refusal leaves nothing behind and has a cause of its own, so that the report says which:
 * - "ineligible": a layer is not loaded, is not a 96x128 sheet or has another frame count.
 * - "noRenderer": the game has no renderer yet, so there is nothing to upload a texture to.
 * - "taken": the key is already a texture that the registry does not know (somebody else made it).
 */
export type BakeOutcome = "baked" | "ineligible" | "noRenderer" | "taken";

export interface BakeBackend {
    /**
     * Creates the texture `key` from the layers. A refusal other than "baked" leaves nothing behind. May throw, and
     * then leaves nothing behind either.
     *
     * `makeRoom` frees the room the new texture needs (it evicts an idle recipe when the cap is reached). The backend
     * calls it once, after it has checked and drawn everything that can fail, right before it creates the texture:
     * a bake that was going to fail costs no cached texture, and the cap still holds at every moment.
     */
    bake(key: string, layers: readonly string[], makeRoom: () => void): BakeOutcome;
    /** Destroys the texture `key` and what depends on it (animations). */
    dispose(key: string): void;
}

export interface BakeLease {
    readonly key: string;
    /** Lets go of the recipe. Calling it again does nothing. */
    release(): void;
    /**
     * Lets go of the recipe because the holder could not use its sheet (its sprite failed to build). The recipe is
     * reported once, and not baked again for a while: the next avatar with it stays on its layers at once. The sheet is
     * destroyed as soon as nobody holds it. Calling it, or release(), again does nothing.
     */
    discard(error: unknown): void;
}

export interface BakeRegistryStats {
    /** Baked recipes now, leased or idle. */
    readonly cached: number;
    /** Recipes with at least one lease. */
    readonly active: number;
    readonly idle: number;
    /** DERIVED: `cached` x BAKED_AVATAR_BYTES. Not a measure of GPU or JS memory. */
    readonly bytesDerived: number;
    readonly hits: number;
    /** Recipes baked. */
    readonly misses: number;
    readonly evictions: number;
    readonly declines: {
        readonly singleLayer: number;
        readonly ineligible: number;
        readonly cap: number;
        readonly error: number;
        readonly taken: number;
        readonly noRenderer: number;
        /** Recipes that failed lately and wait out their retry delay (see FAILED_RECIPE_RETRY_MS). */
        readonly failed: number;
    };
    readonly bakeMsTotal: number;
    readonly bakeMsMax: number;
    /** Recipes that are waiting out their retry delay now. */
    readonly failedRecipes: number;
}

export interface BakeRegistryOptions {
    maxRecipes?: number;
    maxIdle?: number;
    bytesPerRecipe?: number;
    now?: () => number;
    /** How long a recipe that failed is left alone, in ms. */
    failedRetryMs?: number;
    /** Where a failed or refused bake is reported. */
    warn?: (message: string, detail?: unknown) => void;
}

/** How long a recipe whose bake or sprite failed stays on its layers before it is tried again, in ms. */
export const FAILED_RECIPE_RETRY_MS = 60_000;

interface Entry {
    readonly key: string;
    leases: number;
    lastUsed: number;
    /** A holder could not use the sheet: it is destroyed when the last lease goes, and no new lease is given. */
    discarded: boolean;
}

const DECLINE_MESSAGES = {
    ineligible: "An avatar is not baked: a layer is missing or is not a 96x128 sheet",
    noRenderer: "An avatar is not baked: the game has no renderer yet",
    taken: "An avatar is not baked: its texture key is already taken by a texture that is not a baked avatar",
} as const;

/** The key of a recipe. JSON keeps ["a|b"] and ["a", "b"] apart, and the order of the layers in it. */
export function canonicalRecipeKey(layers: readonly string[]): string {
    return `kbake:${JSON.stringify(layers)}`;
}

export class AvatarBakeRegistry {
    private readonly entries = new Map<string, Entry>();
    private readonly maxRecipes: number;
    private readonly maxIdle: number;
    private readonly bytesPerRecipe: number;
    private readonly failedRetryMs: number;
    private readonly now: () => number;
    private readonly warn: (message: string, detail?: unknown) => void;
    private readonly reported = new Set<string>();
    /** The recipes that failed, and when they may be tried again. */
    private readonly failedUntil = new Map<string, number>();
    private clock = 0;
    private hits = 0;
    private misses = 0;
    private evictions = 0;
    private declines = { singleLayer: 0, ineligible: 0, cap: 0, error: 0, taken: 0, noRenderer: 0, failed: 0 };
    private bakeMsTotal = 0;
    private bakeMsMax = 0;

    constructor(
        private readonly backend: BakeBackend,
        options: BakeRegistryOptions = {},
    ) {
        this.maxRecipes = Math.max(1, Math.floor(options.maxRecipes ?? DEFAULT_MAX_BAKED_RECIPES));
        this.maxIdle = Math.max(0, Math.floor(options.maxIdle ?? DEFAULT_MAX_IDLE_BAKED_RECIPES));
        this.bytesPerRecipe = options.bytesPerRecipe ?? BAKED_AVATAR_BYTES;
        this.failedRetryMs = options.failedRetryMs ?? FAILED_RECIPE_RETRY_MS;
        this.now = options.now ?? (() => performance.now());
        this.warn = options.warn ?? ((message, detail) => console.warn(message, detail));
    }

    /**
     * A lease on the baked recipe, baking it when it is not. Undefined (and counted in `declines`) when the avatar
     * stays on its layers: fewer than two layers, a recipe that failed lately, a layer the backend refuses, a failed
     * bake, or no room. Never throws.
     */
    public acquire(layers: readonly string[]): BakeLease | undefined {
        if (layers.length < 2) {
            this.declines.singleLayer += 1;
            return undefined;
        }
        const key = canonicalRecipeKey(layers);
        if (this.isFailed(key)) {
            this.declines.failed += 1;
            return undefined;
        }
        const existing = this.entries.get(key);
        if (existing?.discarded) {
            // A holder failed with it and others still hold it, so its key is not free to bake again yet.
            this.declines.failed += 1;
            return undefined;
        }
        if (existing !== undefined) {
            this.hits += 1;
            return this.lease(existing);
        }
        if (this.entries.size >= this.maxRecipes && !this.hasIdle()) {
            this.declines.cap += 1;
            return undefined;
        }
        const start = this.now();
        let outcome: BakeOutcome;
        try {
            // Only the backend knows when the texture is about to be created, which is when the room is needed.
            outcome = this.backend.bake(key, layers, () => this.makeRoom());
        } catch (error) {
            this.declines.error += 1;
            this.markFailed(key);
            this.report(key, "Could not bake an avatar, it stays on its layers", error);
            return undefined;
        }
        if (outcome !== "baked") {
            this.declines[outcome] += 1;
            this.report(key, DECLINE_MESSAGES[outcome], layers);
            return undefined;
        }
        const elapsed = this.now() - start;
        this.bakeMsTotal += elapsed;
        this.bakeMsMax = Math.max(this.bakeMsMax, elapsed);
        this.misses += 1;
        const entry: Entry = { key, leases: 0, lastUsed: 0, discarded: false };
        this.entries.set(key, entry);
        return this.lease(entry);
    }

    /** Destroys every baked texture, leased or not (a scene that shuts down). The leases that remain release nothing. */
    public disposeAll(): void {
        for (const key of [...this.entries.keys()]) {
            this.evict(key);
        }
    }

    public stats(): BakeRegistryStats {
        let active = 0;
        for (const entry of this.entries.values()) {
            if (entry.leases > 0) {
                active += 1;
            }
        }
        let failed = 0;
        for (const key of this.failedUntil.keys()) {
            if (this.isFailed(key)) {
                failed += 1;
            }
        }
        return {
            cached: this.entries.size,
            active,
            idle: this.entries.size - active,
            bytesDerived: this.entries.size * this.bytesPerRecipe,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            declines: { ...this.declines },
            bakeMsTotal: this.bakeMsTotal,
            bakeMsMax: this.bakeMsMax,
            failedRecipes: failed,
        };
    }

    private lease(entry: Entry): BakeLease {
        entry.leases += 1;
        entry.lastUsed = ++this.clock;
        let done = false;
        const letGo = (): void => {
            if (done) {
                return;
            }
            done = true;
            // The entry may have been disposed (scene shutdown) and the same key baked again since.
            if (this.entries.get(entry.key) !== entry) {
                return;
            }
            entry.leases -= 1;
            entry.lastUsed = ++this.clock;
            if (entry.leases > 0) {
                return;
            }
            if (entry.discarded) {
                this.evict(entry.key);
                return;
            }
            this.trimIdle();
        };
        return {
            key: entry.key,
            release: letGo,
            discard: (error) => {
                if (done) {
                    return;
                }
                entry.discarded = true;
                this.markFailed(entry.key);
                this.report(entry.key, "An avatar could not use its baked sheet, it stays on its layers", error);
                letGo();
            },
        };
    }

    private isFailed(key: string): boolean {
        const until = this.failedUntil.get(key);
        if (until === undefined) {
            return false;
        }
        if (this.now() < until) {
            return true;
        }
        // The delay is over: the recipe is tried again, and reported again if it fails again.
        this.failedUntil.delete(key);
        this.reported.delete(key);
        return false;
    }

    private markFailed(key: string): void {
        this.failedUntil.set(key, this.now() + this.failedRetryMs);
    }

    private hasIdle(): boolean {
        for (const entry of this.entries.values()) {
            if (entry.leases === 0) {
                return true;
            }
        }
        return false;
    }

    /** Evicts the oldest idle recipe when the cap is reached. The caller checked that there is one. */
    private makeRoom(): void {
        if (this.entries.size >= this.maxRecipes) {
            this.evictOldestIdle();
        }
    }

    private trimIdle(): void {
        let idle = 0;
        for (const entry of this.entries.values()) {
            if (entry.leases === 0) {
                idle += 1;
            }
        }
        while (idle > this.maxIdle && this.evictOldestIdle()) {
            idle -= 1;
        }
    }

    private evictOldestIdle(): boolean {
        let oldest: Entry | undefined;
        for (const entry of this.entries.values()) {
            if (entry.leases === 0 && (oldest === undefined || entry.lastUsed < oldest.lastUsed)) {
                oldest = entry;
            }
        }
        if (oldest === undefined) {
            return false;
        }
        this.evict(oldest.key);
        return true;
    }

    private evict(key: string): void {
        this.entries.delete(key);
        this.evictions += 1;
        try {
            this.backend.dispose(key);
        } catch (error) {
            this.report(`dispose:${key}`, "Could not destroy a baked avatar texture", error);
        }
    }

    private report(id: string, message: string, detail: unknown): void {
        // One report per recipe: a crowd that shares a recipe would repeat it for each avatar.
        if (this.reported.has(id)) {
            return;
        }
        this.reported.add(id);
        this.warn(message, detail);
    }
}
