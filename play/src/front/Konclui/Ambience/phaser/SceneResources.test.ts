import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneResources } from "./SceneResources";

class TestObject {
    public destroyed = 0;
    public fail = false;

    destroy(): void {
        if (this.fail) throw new Error("destroy failed");
        this.destroyed += 1;
    }
}

class TestTextures {
    public readonly keys = new Set<string>();

    exists(key: string): boolean {
        return this.keys.has(key);
    }

    remove(key: string): void {
        this.keys.delete(key);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("scene resources", () => {
    it("gives back every object, texture and cleanup it holds, cleanups first", () => {
        const textures = new TestTextures();
        textures.keys.add("kfx-1-water").add("kfx-1-occ").add("theirs");
        const resources = new SceneResources(textures);
        const order: string[] = [];
        const object = resources.object(new TestObject());
        resources.texture("kfx-1-water");
        resources.texture("kfx-1-occ");
        resources.onRelease(() => order.push(`listener off, ${object.destroyed} destroyed`));
        resources.onRelease(() => order.push("filter removed"));

        resources.release();

        expect(order).toEqual(["listener off, 0 destroyed", "filter removed"]);
        expect(object.destroyed).toBe(1);
        expect([...textures.keys]).toEqual(["theirs"]);
        expect(resources.isReleased).toBe(true);
    });

    it("gives everything back once", () => {
        const resources = new SceneResources(new TestTextures());
        const object = resources.object(new TestObject());
        const cleanup = vi.fn();
        resources.onRelease(cleanup);

        resources.release();
        resources.release();

        expect(object.destroyed).toBe(1);
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("reports a failure to give one thing back and still gives back the rest", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const textures = new TestTextures();
        textures.keys.add("kfx-1-glass");
        const resources = new SceneResources(textures);
        const broken = resources.object(new TestObject());
        broken.fail = true;
        const healthy = resources.object(new TestObject());
        resources.texture("kfx-1-glass");

        resources.release();

        expect(error).toHaveBeenCalledTimes(1);
        expect(healthy.destroyed).toBe(1);
        expect(textures.keys.size).toBe(0);
    });

    it("destroys a dropped object at once and not again at the release", () => {
        const resources = new SceneResources(new TestTextures());
        const slide = resources.object(new TestObject());

        resources.drop(slide);
        resources.release();

        expect(slide.destroyed).toBe(1);
    });
});
