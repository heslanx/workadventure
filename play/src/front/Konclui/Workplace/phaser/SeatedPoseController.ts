type SeatDirection = "up" | "down" | "left" | "right";

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

interface SeatPose {
    direction: SeatDirection;
    crop: number;
    dy: number;
    front?: { source: string; x: number; y: number };
}

interface SpriteOrigin {
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

const DEFAULT_POSE: Record<SeatDirection, { crop: number; dy: number }> = {
    up: { crop: 10, dy: -3 },
    down: { crop: 0, dy: -3 },
    left: { crop: 0, dy: -3 },
    right: { crop: 0, dy: -3 },
};

function isSeatDirection(value: unknown): value is SeatDirection {
    return value === "up" || value === "down" || value === "left" || value === "right";
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function parseFront(value: unknown, baseUrl: string): SeatPose["front"] {
    if (typeof value !== "object" || value === null || !("src" in value) || !("x" in value) || !("y" in value)) {
        return undefined;
    }
    if (
        typeof value.src !== "string" ||
        !isNumberInRange(value.x, -100_000, 100_000) ||
        !isNumberInRange(value.y, -100_000, 100_000)
    ) {
        return undefined;
    }

    try {
        const base = new URL(baseUrl);
        const source = new URL(value.src, base);
        if (
            source.origin !== base.origin ||
            !source.pathname.startsWith("/map-storage/") ||
            !source.pathname.endsWith(".png")
        ) {
            return undefined;
        }
        return { source: source.href, x: Math.round(value.x), y: Math.round(value.y) };
    } catch {
        return undefined;
    }
}

function parseSeatPose(value: unknown, baseUrl: string): SeatPose | undefined {
    if (typeof value !== "object" || value === null || !("v" in value) || value.v !== 1) {
        return undefined;
    }
    if (!("direction" in value) || !isSeatDirection(value.direction)) {
        return undefined;
    }

    const defaults = DEFAULT_POSE[value.direction];
    const crop =
        "crop" in value && Number.isInteger(value.crop) && isNumberInRange(value.crop, 0, 16)
            ? value.crop
            : defaults.crop;
    const dy = "dy" in value && isNumberInRange(value.dy, -16, 16) ? Math.round(value.dy) : defaults.dy;
    const front = "front" in value ? parseFront(value.front, baseUrl) : undefined;
    return { direction: value.direction, crop, dy, front };
}

export class SeatedPoseController {
    private readonly spriteOrigins = new Map<SeatCharacter, Map<SeatSprite, SpriteOrigin>>();
    private readonly frontLayers = new Map<SeatCharacter, FrontLayer>();
    private disabled = false;

    public update(context: SeatedPoseUpdate): void {
        if (this.disabled) {
            return;
        }

        try {
            const live = new Set<SeatCharacter>();
            this.apply(context.scene, context.currentPlayer, context.currentSeat, context.baseUrl, live);
            for (const [id, character] of context.remoteCharacters) {
                const player = context.remotePlayers.get(id);
                this.apply(context.scene, character, player?.variables.get("officeSeat"), context.baseUrl, live);
            }

            let dirty = false;
            for (const character of this.spriteOrigins.keys()) {
                if (!live.has(character)) {
                    dirty = this.clearCharacter(context.scene, character) || dirty;
                }
            }
            for (const character of this.frontLayers.keys()) {
                if (!live.has(character)) {
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
            console.error("[konclui] seated pose disabled:", error);
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

    private apply(
        scene: SeatedPoseScene,
        character: SeatCharacter,
        value: unknown,
        baseUrl: string,
        live: Set<SeatCharacter>,
    ): void {
        live.add(character);
        const pose = parseSeatPose(value, baseUrl);
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

        const currentSprites = new Set(character.sprites.values());
        for (const [texture, sprite] of character.sprites) {
            let origin = origins.get(sprite);
            if (!origin) {
                origin = { y: sprite.y, cropHeight: undefined };
                origins.set(sprite, origin);
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
            if (!currentSprites.has(sprite)) {
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
