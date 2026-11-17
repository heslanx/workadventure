import { parseSeatPose, type SeatPose } from "../domain/seatPose";

interface SeatSprite {
    y: number;
    width: number;
    height: number;
    isCropped: boolean;
    anims?: {
        currentAnim?: { key?: string } | null;
        play(key: string, ignoreIfPlaying?: boolean): unknown;
    };
    setCrop(x?: number, y?: number, width?: number, height?: number): unknown;
}

interface SeatCharacter {
    depth: number;
    sprites: ReadonlyMap<string, SeatSprite>;
}

interface SeatImage {
    depth: number;
    setOrigin(x: number, y: number): this;
    setDepth(depth: number): this;
    destroy(): void;
}

export interface SeatedPoseScene {
    markDirty(): void;
    anims: { exists(key: string): boolean };
    add: { image(x: number, y: number, key: string): SeatImage };
    textures: { exists(key: string): boolean };
    load: {
        image(key: string, source: string): unknown;
        once(event: string, callback: () => void): unknown;
        on(event: string, callback: (file: { key: string }) => void): unknown;
        off(event: string, callback: (() => void) | ((file: { key: string }) => void)): unknown;
        start(): void;
    };
}

interface RemoteSeatData {
    variables: ReadonlyMap<string, unknown>;
}

export interface SeatedPoseUpdate {
    scene: SeatedPoseScene;
    baseUrl: string;
    currentPlayer: SeatCharacter;
    currentSeat: unknown;
    remoteCharacters: ReadonlyMap<number, SeatCharacter>;
    remotePlayers: ReadonlyMap<number, RemoteSeatData>;
}

interface SpriteOrigin {
    // The key the sprite has in its character's `sprites`, so that a sprite the character dropped is found
    // without collecting the current ones on every frame.
    texture: string;
    y: number;
    cropHeight: number | undefined;
}

interface FrontLayer {
    source: string;
    x: number;
    y: number;
    image: SeatImage | undefined;
    cancelLoad?: () => void;
}

export class SeatedPoseController {
    private readonly spriteOrigins = new Map<SeatCharacter, Map<SeatSprite, SpriteOrigin>>();
    private readonly frontLayers = new Map<SeatCharacter, FrontLayer>();
    // The characters seen on the frame being drawn. One set is kept and emptied after each frame.
    private readonly live = new Set<SeatCharacter>();
    // A variable is replaced by a new object when it changes and never changed in place, so the pose parsed
    // from an object stays right for as long as the page address it was resolved against.
    private poses = new WeakMap<object, SeatPose | null>();
    private posesBaseUrl: string | undefined;
    private disabled = false;

    public update(context: SeatedPoseUpdate): void {
        if (this.disabled) {
            return;
        }

        try {
            this.apply(context.scene, context.currentPlayer, context.currentSeat, context.baseUrl);
            for (const [id, character] of context.remoteCharacters) {
                const player = context.remotePlayers.get(id);
                this.apply(context.scene, character, player?.variables.get("officeSeat"), context.baseUrl);
            }

            let dirty = false;
            for (const character of this.spriteOrigins.keys()) {
                if (!this.live.has(character)) {
                    dirty = this.clearCharacter(context.scene, character) || dirty;
                }
            }
            for (const character of this.frontLayers.keys()) {
                if (!this.live.has(character)) {
                    dirty = this.dropFront(character) || dirty;
                }
            }
            if (dirty) {
                context.scene.markDirty();
            }
        } catch (error: unknown) {
            try {
                this.reset(context.scene);
            } catch (resetError: unknown) {
                console.error("[konclui] seated pose reset incomplete:", resetError);
            }
            this.disabled = true;
            // Rethrown so that the scene reports it once; later frames return at the latch above.
            throw error;
        } finally {
            this.live.clear();
        }
    }

    public reset(scene: SeatedPoseScene): void {
        let dirty = false;
        for (const character of this.spriteOrigins.keys()) {
            dirty = this.clearCharacter(scene, character) || dirty;
        }
        for (const character of this.frontLayers.keys()) {
            dirty = this.dropFront(character) || dirty;
        }
        this.disabled = false;
        if (dirty) {
            scene.markDirty();
        }
    }

    private poseOf(value: unknown, baseUrl: string): SeatPose | undefined {
        if (typeof value !== "object" || value === null) {
            return parseSeatPose(value, baseUrl);
        }
        if (this.posesBaseUrl !== baseUrl) {
            this.poses = new WeakMap<object, SeatPose | null>();
            this.posesBaseUrl = baseUrl;
        }
        let pose = this.poses.get(value);
        if (pose === undefined) {
            pose = parseSeatPose(value, baseUrl) ?? null;
            this.poses.set(value, pose);
        }
        return pose ?? undefined;
    }

    private apply(scene: SeatedPoseScene, character: SeatCharacter, value: unknown, baseUrl: string): void {
        this.live.add(character);
        const pose = this.poseOf(value, baseUrl);
        if (!pose || character.sprites.size === 0 || this.isWalking(character)) {
            this.clearCharacter(scene, character);
            if (this.dropFront(character)) {
                scene.markDirty();
            }
            return;
        }

        let changed = false;
        let origins = this.spriteOrigins.get(character);
        if (!origins) {
            origins = new Map<SeatSprite, SpriteOrigin>();
            this.spriteOrigins.set(character, origins);
        }

        for (const [texture, sprite] of character.sprites) {
            let origin = origins.get(sprite);
            if (!origin) {
                origin = { texture, y: sprite.y, cropHeight: undefined };
                origins.set(sprite, origin);
            } else {
                origin.texture = texture;
            }

            const animation = `${texture}-${pose.direction}-idle`;
            if (sprite.anims && sprite.anims.currentAnim?.key !== animation && scene.anims.exists(animation)) {
                sprite.anims.play(animation, true);
                changed = true;
            }

            const cropHeight = sprite.height - pose.crop;
            if (!sprite.isCropped || origin.cropHeight !== cropHeight) {
                sprite.setCrop(0, 0, sprite.width, cropHeight);
                origin.cropHeight = cropHeight;
                changed = true;
            }

            const y = origin.y + pose.dy;
            if (sprite.y !== y) {
                sprite.y = y;
                changed = true;
            }
        }

        for (const [sprite, origin] of origins) {
            if (character.sprites.get(origin.texture) !== sprite) {
                changed = this.restoreSprite(sprite, origin) || changed;
                origins.delete(sprite);
            }
        }
        if (origins.size === 0) {
            this.spriteOrigins.delete(character);
        }

        if (this.setFront(scene, character, pose.front)) {
            changed = true;
        }
        if (changed) {
            scene.markDirty();
        }
    }

    private isWalking(character: SeatCharacter): boolean {
        for (const sprite of character.sprites.values()) {
            const key = sprite.anims?.currentAnim?.key;
            if (key?.endsWith("-walk")) {
                return true;
            }
        }
        return false;
    }

    private clearCharacter(scene: SeatedPoseScene, character: SeatCharacter): boolean {
        const origins = this.spriteOrigins.get(character);
        if (!origins) {
            return false;
        }
        let changed = false;
        for (const [sprite, origin] of origins) {
            changed = this.restoreSprite(sprite, origin) || changed;
        }
        this.spriteOrigins.delete(character);
        if (changed) {
            scene.markDirty();
        }
        return changed;
    }

    private restoreSprite(sprite: SeatSprite, origin: SpriteOrigin): boolean {
        let changed = false;
        if (sprite.isCropped) {
            sprite.setCrop();
            changed = true;
        }
        if (sprite.y !== origin.y) {
            sprite.y = origin.y;
            changed = true;
        }
        origin.cropHeight = undefined;
        return changed;
    }

    private setFront(scene: SeatedPoseScene, character: SeatCharacter, front: SeatPose["front"]): boolean {
        const current = this.frontLayers.get(character);
        if (!front) {
            return this.dropFront(character);
        }
        if (!current || current.source !== front.source || current.x !== front.x || current.y !== front.y) {
            this.dropFront(character);
            const next: FrontLayer = { ...front, image: undefined };
            this.frontLayers.set(character, next);
            const show = (): void => {
                next.cancelLoad?.();
                if (this.frontLayers.get(character) !== next || next.image) {
                    return;
                }
                next.image = scene.add
                    .image(next.x, next.y, `kseat:${next.source}`)
                    .setOrigin(0, 0)
                    .setDepth(character.depth + 0.5);
                scene.markDirty();
            };

            const key = `kseat:${next.source}`;
            if (scene.textures.exists(key)) {
                show();
            } else {
                const completed = `filecomplete-image-${key}`;
                const onComplete = (): void => next.cancelLoad?.();
                const onError = (file: { key: string }): void => {
                    if (file.key === key) next.cancelLoad?.();
                };
                next.cancelLoad = () => {
                    scene.load.off(completed, show);
                    scene.load.off("loaderror", onError);
                    scene.load.off("complete", onComplete);
                    next.cancelLoad = undefined;
                };
                scene.load.once(completed, show);
                scene.load.on("loaderror", onError);
                scene.load.once("complete", onComplete);
                scene.load.image(key, next.source);
                scene.load.start();
            }
            return true;
        }

        const depth = character.depth + 0.5;
        if (current.image && current.image.depth !== depth) {
            current.image.setDepth(depth);
            return true;
        }
        return false;
    }

    private dropFront(character: SeatCharacter): boolean {
        const front = this.frontLayers.get(character);
        if (!front) {
            return false;
        }
        front.cancelLoad?.();
        front.image?.destroy();
        this.frontLayers.delete(character);
        return true;
    }
}
