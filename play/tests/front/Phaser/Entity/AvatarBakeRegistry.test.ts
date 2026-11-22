import { describe, expect, it } from "vitest";
import type { BakeBackend, BakeOutcome } from "../../../../src/front/Phaser/Entity/AvatarBakeRegistry";
import {
    AvatarBakeRegistry,
    BAKED_AVATAR_BYTES,
    canonicalRecipeKey,
    DEFAULT_MAX_BAKED_RECIPES,
    DEFAULT_MAX_IDLE_BAKED_RECIPES,
} from "../../../../src/front/Phaser/Entity/AvatarBakeRegistry";

class FakeBackend implements BakeBackend {
    public readonly baked = new Set<string>();
    public readonly bakes: string[] = [];
    public readonly disposed: string[] = [];
    public outcome: BakeOutcome = "baked";
    public failWith: Error | undefined;
    /** How many textures existed at the moment each bake created its own, the new one included. */
    public readonly sizeAtCreation: number[] = [];
    public failAfterRoom = false;

    bake(key: string, _layers: readonly string[], makeRoom: () => void): BakeOutcome {
        if (this.failWith) throw this.failWith;
        if (this.outcome !== "baked") return this.outcome;
        makeRoom();
        if (this.failAfterRoom) throw new Error("created too late");
        this.baked.add(key);
        this.bakes.push(key);
        this.sizeAtCreation.push(this.baked.size);
        return "baked";
    }

    dispose(key: string): void {
        this.baked.delete(key);
        this.disposed.push(key);
    }
}

function recipe(n: number): string[] {
    return [`body_${n}`, `eyes_${n}`];
}

function setup(options: ConstructorParameters<typeof AvatarBakeRegistry>[1] = {}) {
    const backend = new FakeBackend();
    const warnings: string[] = [];
    const registry = new AvatarBakeRegistry(backend, { warn: (message) => warnings.push(message), ...options });
    return { backend, registry, warnings };
}

describe("canonicalRecipeKey", () => {
    it("depends on the order of the layers, since the order is the z-order", () => {
        expect(canonicalRecipeKey(["a", "b"])).not.toBe(canonicalRecipeKey(["b", "a"]));
    });

    it("keeps one layer id with a separator in it apart from two layer ids", () => {
        expect(canonicalRecipeKey(["a|b"])).not.toBe(canonicalRecipeKey(["a", "b"]));
        expect(canonicalRecipeKey(['a","b'])).not.toBe(canonicalRecipeKey(["a", "b"]));
    });
});

describe("AvatarBakeRegistry leases", () => {
    it("bakes a recipe once for any number of holders, and counts a lease per holder", () => {
        const { backend, registry } = setup();

        const leases = [registry.acquire(recipe(1)), registry.acquire(recipe(1)), registry.acquire(recipe(1))];

        expect(backend.bakes).toEqual([canonicalRecipeKey(recipe(1))]);
        expect(registry.stats()).toMatchObject({ cached: 1, active: 1, idle: 0, hits: 2, misses: 1 });
        leases[0]?.release();
        leases[1]?.release();
        expect(registry.stats()).toMatchObject({ cached: 1, active: 1 });
        leases[2]?.release();
        expect(registry.stats()).toMatchObject({ cached: 1, active: 0, idle: 1 });
    });

    it("lets go once however many times a lease is released", () => {
        const { registry } = setup();
        const first = registry.acquire(recipe(1));
        const second = registry.acquire(recipe(1));

        first?.release();
        first?.release();
        first?.release();

        expect(registry.stats().active).toBe(1);
        second?.release();
        expect(registry.stats().active).toBe(0);
    });

    it("gives an idle recipe back without baking it again", () => {
        const { backend, registry } = setup();
        registry.acquire(recipe(1))?.release();

        const lease = registry.acquire(recipe(1));

        expect(lease?.key).toBe(canonicalRecipeKey(recipe(1)));
        expect(backend.bakes).toHaveLength(1);
        expect(registry.stats()).toMatchObject({ active: 1, idle: 0, hits: 1 });
    });

    it("never bakes fewer than two layers", () => {
        const { backend, registry } = setup();

        expect(registry.acquire(["male1"])).toBeUndefined();
        expect(registry.acquire([])).toBeUndefined();

        expect(backend.bakes).toEqual([]);
        expect(registry.stats().declines.singleLayer).toBe(2);
    });
});

describe("AvatarBakeRegistry LRU and cap", () => {
    it("evicts the least recently released idle recipe first, and destroys its texture", () => {
        const { backend, registry } = setup({ maxIdle: 2 });
        const leases = [1, 2, 3].map((n) => registry.acquire(recipe(n)));

        leases[1]?.release();
        leases[0]?.release();
        leases[2]?.release();

        // Idle in release order: 2, 1, 3. A cap of 2 idle recipes evicts the oldest, 2.
        expect(backend.disposed).toEqual([canonicalRecipeKey(recipe(2))]);
        expect(registry.stats()).toMatchObject({ cached: 2, idle: 2, evictions: 1 });
    });

    it("treats acquiring an idle recipe as using it", () => {
        const { backend, registry } = setup({ maxIdle: 2 });
        registry.acquire(recipe(1))?.release();
        registry.acquire(recipe(2))?.release();
        registry.acquire(recipe(1))?.release(); // 1 is now more recent than 2

        registry.acquire(recipe(3))?.release();

        expect(backend.disposed).toEqual([canonicalRecipeKey(recipe(2))]);
    });

    it("never evicts a recipe somebody holds", () => {
        const { backend, registry } = setup({ maxIdle: 0 });
        const held = registry.acquire(recipe(1));
        registry.acquire(recipe(2))?.release();

        expect(backend.disposed).toEqual([canonicalRecipeKey(recipe(2))]);
        expect(backend.baked.has(canonicalRecipeKey(recipe(1)))).toBe(true);
        held?.release();
    });

    it("never holds more recipes than the cap: with every recipe held, the next avatar stays on its layers", () => {
        const { backend, registry } = setup({ maxRecipes: 3 });
        const held = [1, 2, 3].map((n) => registry.acquire(recipe(n)));

        const refused = registry.acquire(recipe(4));

        expect(refused).toBeUndefined();
        expect(registry.stats()).toMatchObject({ cached: 3, declines: { cap: 1 } });
        expect(backend.baked.size).toBe(3);
        held[0]?.release();
        // One is idle now: it makes room.
        expect(registry.acquire(recipe(4))).toBeDefined();
        expect(backend.baked.size).toBe(3);
    });

    it("accounts 98,304 bytes a recipe and caps the whole at 18 MiB", () => {
        const { registry } = setup();
        registry.acquire(recipe(1));
        registry.acquire(recipe(2));

        expect(BAKED_AVATAR_BYTES).toBe(96 * 128 * 4 * 2);
        expect(registry.stats().bytesDerived).toBe(2 * 98_304);
        expect(DEFAULT_MAX_BAKED_RECIPES * BAKED_AVATAR_BYTES).toBe(18_874_368);
        expect(DEFAULT_MAX_IDLE_BAKED_RECIPES).toBeLessThan(DEFAULT_MAX_BAKED_RECIPES);
    });

    it("destroys every texture on disposeAll, and a lease that outlives it releases nothing, even for a recipe baked again", () => {
        const { backend, registry } = setup();
        const old = registry.acquire(recipe(1));
        registry.acquire(recipe(2))?.release();

        registry.disposeAll();

        expect(backend.baked.size).toBe(0);
        expect(registry.stats()).toMatchObject({ cached: 0, active: 0 });
        const fresh = registry.acquire(recipe(1));
        old?.release();
        expect(registry.stats()).toMatchObject({ cached: 1, active: 1 });
        fresh?.release();
        expect(registry.stats().active).toBe(0);
    });
});

describe("AvatarBakeRegistry failures", () => {
    it("declines and reports a bake that throws, once per recipe, and does not throw", () => {
        const { backend, registry, warnings } = setup();
        backend.failWith = new Error("boom");

        expect(registry.acquire(recipe(1))).toBeUndefined();
        expect(registry.acquire(recipe(1))).toBeUndefined();

        expect(warnings).toHaveLength(1);
        expect(registry.stats()).toMatchObject({ cached: 0, declines: { error: 1, failed: 1 } });
    });

    it("does not bake a recipe that failed again until its retry delay is over, then tries once more", () => {
        let now = 1_000;
        const { backend, registry, warnings } = setup({ now: () => now, failedRetryMs: 500 });
        let attempts = 0;
        backend.failWith = new Error("boom");
        const bake = backend.bake.bind(backend);
        backend.bake = (key, layers, makeRoom) => {
            attempts++;
            return bake(key, layers, makeRoom);
        };

        registry.acquire(recipe(1));
        registry.acquire(recipe(1));
        registry.acquire(recipe(1));
        expect(attempts).toBe(1);
        expect(registry.stats().failedRecipes).toBe(1);

        now += 500;
        backend.failWith = undefined;
        const lease = registry.acquire(recipe(1));

        expect(attempts).toBe(2);
        expect(lease?.key).toBe(canonicalRecipeKey(recipe(1)));
        expect(registry.stats().failedRecipes).toBe(0);
        // The other recipes were never affected.
        expect(registry.acquire(recipe(2))).toBeDefined();
        expect(warnings).toHaveLength(1);
    });

    it.each(["ineligible", "noRenderer", "taken"] as const)(
        "declines and reports a recipe the backend refuses as %s, with a message of its own, and keeps nothing of it",
        (outcome) => {
            const { backend, registry, warnings } = setup();
            backend.outcome = outcome;

            expect(registry.acquire(recipe(1))).toBeUndefined();

            expect(warnings).toHaveLength(1);
            expect(registry.stats()).toMatchObject({ cached: 0, declines: { [outcome]: 1 } });
            expect(registry.stats().declines.failed).toBe(0);
        },
    );

    it("tells the three refusals apart in what it reports", () => {
        const messages = new Set<string>();
        for (const outcome of ["ineligible", "noRenderer", "taken"] as const) {
            const { backend, registry, warnings } = setup();
            backend.outcome = outcome;
            registry.acquire(recipe(1));
            messages.add(warnings[0]);
        }
        expect(messages.size).toBe(3);
        expect([...messages].filter((message) => message.includes("96x128"))).toHaveLength(1);
    });

    it("does not give up an idle texture for a bake that fails before it creates its own", () => {
        const { backend, registry } = setup({ maxRecipes: 2 });
        registry.acquire(recipe(1))?.release();
        registry.acquire(recipe(2));
        backend.outcome = "ineligible";

        registry.acquire(recipe(3));

        expect(backend.disposed).toEqual([]);
        expect(registry.stats()).toMatchObject({ cached: 2, idle: 1, evictions: 0 });
    });

    it("makes room right before the new texture exists, so the cap holds at every moment", () => {
        const { backend, registry } = setup({ maxRecipes: 2 });
        registry.acquire(recipe(1))?.release();
        registry.acquire(recipe(2));

        registry.acquire(recipe(3));

        // 1 idle texture went before 3 was created: never 3 textures at once.
        expect(backend.sizeAtCreation).toEqual([1, 2, 2]);
        expect(backend.disposed).toEqual([canonicalRecipeKey(recipe(1))]);
    });

    it("loses the idle texture it made room with when the creation itself fails, and still reports the failure", () => {
        const { backend, registry, warnings } = setup({ maxRecipes: 2 });
        registry.acquire(recipe(1))?.release();
        registry.acquire(recipe(2));
        backend.failAfterRoom = true;

        expect(registry.acquire(recipe(3))).toBeUndefined();

        expect(warnings).toHaveLength(1);
        expect(registry.stats()).toMatchObject({ cached: 1, evictions: 1 });
    });

    it("keeps a sheet that a holder discarded for the others that hold it, destroys it at the last release, and bakes no more of it", () => {
        const { backend, registry, warnings } = setup();
        const failing = registry.acquire(recipe(1));
        const other = registry.acquire(recipe(1));

        failing?.discard(new Error("no sprite"));
        failing?.release();
        failing?.discard(new Error("again"));

        expect(warnings).toEqual(["An avatar could not use its baked sheet, it stays on its layers"]);
        expect(backend.disposed).toEqual([]);
        // A new avatar of the recipe stays on its layers, whether the sheet is still held or not.
        expect(registry.acquire(recipe(1))).toBeUndefined();
        other?.release();
        expect(backend.disposed).toEqual([canonicalRecipeKey(recipe(1))]);
        expect(registry.acquire(recipe(1))).toBeUndefined();
        expect(registry.stats()).toMatchObject({ cached: 0, active: 0, declines: { failed: 2 } });
    });

    it("destroys a discarded sheet at once when nobody else holds it", () => {
        const { backend, registry } = setup();

        registry.acquire(recipe(1))?.discard(new Error("no sprite"));

        expect(backend.disposed).toEqual([canonicalRecipeKey(recipe(1))]);
        expect(registry.stats()).toMatchObject({ cached: 0, idle: 0 });
    });

    it("still evicts when the texture cannot be destroyed, and reports it", () => {
        const { backend, registry, warnings } = setup({ maxIdle: 0 });
        backend.dispose = () => {
            throw new Error("gone");
        };

        registry.acquire(recipe(1))?.release();

        expect(registry.stats()).toMatchObject({ cached: 0, evictions: 1 });
        expect(warnings).toHaveLength(1);
    });

    it("measures the bake with its clock", () => {
        let now = 0;
        const backend = new FakeBackend();
        backend.bake = (key) => {
            now += key === canonicalRecipeKey(recipe(1)) ? 2 : 5;
            return "baked";
        };
        const registry = new AvatarBakeRegistry(backend, { now: () => now });

        registry.acquire(recipe(1));
        registry.acquire(recipe(2));

        expect(registry.stats()).toMatchObject({ bakeMsTotal: 7, bakeMsMax: 5 });
    });
});
