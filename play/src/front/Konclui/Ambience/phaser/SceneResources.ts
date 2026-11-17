import { asError } from "catch-unknown";

export interface Destroyable {
    destroy(): void;
}

export interface TextureStore {
    exists(key: string): boolean;
    remove(key: string): unknown;
}

/**
 * What the effects hold in a scene: the game objects, the textures and the rest (listeners, the camera filter), so
 * that one release gives all of it back. A failure to give one thing back is reported and the rest still goes.
 */
export class SceneResources {
    private readonly objects = new Set<Destroyable>();
    private readonly textureKeys = new Set<string>();
    private readonly cleanups: (() => void)[] = [];
    private released = false;

    constructor(private readonly textures: TextureStore) {}

    get isReleased(): boolean {
        return this.released;
    }

    /** Keeps a game object until the release. */
    object<T extends Destroyable>(object: T): T {
        this.objects.add(object);
        return object;
    }

    /** Destroys a game object now and forgets it. */
    drop(object: Destroyable): void {
        this.objects.delete(object);
        object.destroy();
    }

    /** Keeps a texture key until the release, which removes it from the scene's textures. */
    texture(key: string): string {
        this.textureKeys.add(key);
        return key;
    }

    /** Runs `cleanup` at the release, before the objects and textures go, in the order they were added. */
    onRelease(cleanup: () => void): void {
        this.cleanups.push(cleanup);
    }

    /** Gives everything back. A second call does nothing. */
    release(): void {
        if (this.released) return;
        this.released = true;
        for (const cleanup of this.cleanups) this.attempt("cleanup", cleanup);
        for (const object of this.objects) this.attempt("object", () => object.destroy());
        for (const key of this.textureKeys) {
            this.attempt(`texture ${key}`, () => {
                if (this.textures.exists(key)) this.textures.remove(key);
            });
        }
        this.cleanups.length = 0;
        this.objects.clear();
        this.textureKeys.clear();
    }

    private attempt(what: string, run: () => void): void {
        try {
            run();
        } catch (error: unknown) {
            console.error(`[konclui] effects: could not release a ${what}:`, asError(error));
        }
    }
}
