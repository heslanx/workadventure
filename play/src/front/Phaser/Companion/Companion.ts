import * as Phaser from "phaser";
import type { Readable } from "svelte/store";
import { readable } from "svelte/store";
import type { CancelablePromise } from "cancelable-promise";
import { PositionMessage_Direction } from "@workadventure/messages";
import type { PictureStore } from "../../Stores/PictureStore";
import { TexturesHelper } from "../Helpers/TexturesHelper";
import { PlayerAnimationTypes } from "../Player/Animation";
import { ProtobufClientUtils } from "../../Network/ProtobufClientUtils";
import { debugRepo } from "../../Utils/Debuggers";

import Sprite = Phaser.GameObjects.Sprite;
import Container = Phaser.GameObjects.Container;
import Body = Phaser.Physics.Arcade.Body;

export interface CompanionStatus {
    x: number;
    y: number;
    name: string;
    moving: boolean;
    direction: PositionMessage_Direction;
}

export class Companion extends Container {
    public sprites: Map<string, Sprite>;

    private delta: number;
    private invisible: boolean;
    // See setSuspended().
    private suspended = false;
    private updateListener: (time: number, delta: number) => void;
    private target: { x: number; y: number; direction: PositionMessage_Direction };

    private direction: PositionMessage_Direction;
    private animationType: PlayerAnimationTypes;
    private readonly _pictureStore: Readable<string | undefined>;
    private texturePromise: CancelablePromise<string | void> | undefined;
    // The picture of the companion, read back once (see takePicture()).
    private picture: Promise<string | undefined> | undefined;

    constructor(scene: Phaser.Scene, x: number, y: number, texturePromise: CancelablePromise<string>) {
        super(scene, x + 14, y + 4);

        this.sprites = new Map<string, Sprite>();

        this.delta = 0;
        this.invisible = true;
        this.target = { x, y, direction: PositionMessage_Direction.DOWN };

        this.direction = PositionMessage_Direction.DOWN;
        this.animationType = PlayerAnimationTypes.Idle;

        // Reading the picture back from the GPU takes about 16 ms, and most companions are never looked at: it is read
        // when the first subscriber asks for it, and kept.
        this._pictureStore = readable<string | undefined>(undefined, (set) => {
            this.takePicture()
                .then((src) => {
                    if (src !== undefined) {
                        set(src);
                    }
                })
                .catch((_) => debugRepo("No companion picture for this player"));
        });

        this.texturePromise = texturePromise
            .then((resource) => {
                this.addResource(resource);
                this.invisible = false;
            })
            .catch((_) => debugRepo("No companion texture for this player"));

        this.scene.physics.world.enableBody(this);

        this.getBody().setImmovable(true);
        this.getBody().setCollideWorldBounds(false);
        this.setSize(16, 16);
        this.getBody().setSize(16, 16);
        this.getBody().setOffset(0, 8);

        this.setDepth(-1);

        this.updateListener = this.step.bind(this);
        this.scene.events.addListener("update", this.updateListener);

        this.scene.add.existing(this);
    }

    public setTarget(x: number, y: number, direction: PositionMessage_Direction) {
        this.target = { x, y: y + 4, direction };
    }

    /**
     * Stops the companion while its owner is not drawn in full (a remote player drawn as a dot): it no longer follows
     * its target nor plays an animation, and a sprite whose texture loads meanwhile is created inactive. Started again,
     * it stands next to its target at once, in the target's pose.
     */
    public setSuspended(suspended: boolean): void {
        if (suspended === this.suspended) {
            return;
        }
        this.suspended = suspended;
        if (suspended) {
            this.scene.events.removeListener("update", this.updateListener);
            this.getBody().stop();
            return;
        }
        this.scene.events.addListener("update", this.updateListener);
        this.setPosition(this.target.x + 14, this.target.y);
        this.setDepth(this.y);
        this.delta = 0;
        this.direction = this.target.direction;
        this.animationType = PlayerAnimationTypes.Idle;
        this.playAnimation(this.direction, this.animationType);
    }

    public step(time: number, delta: number) {
        if (typeof this.target === "undefined") return;

        this.delta += delta;
        if (this.delta < 128) {
            return;
        }
        this.delta = 0;

        const xDist = this.target.x - this.x;
        const yDist = this.target.y - this.y;

        const distance = Math.pow(xDist, 2) + Math.pow(yDist, 2);

        if (distance < 650) {
            this.animationType = PlayerAnimationTypes.Idle;
            this.direction = this.target.direction;

            this.getBody().stop();
        } else {
            this.animationType = PlayerAnimationTypes.Walk;

            const xDir = xDist / Math.max(Math.abs(xDist), 1);
            const yDir = yDist / Math.max(Math.abs(yDist), 1);

            const speed = 256;
            this.getBody().setVelocity(
                Math.min(Math.abs(xDist * 2.5), speed) * xDir,
                Math.min(Math.abs(yDist * 2.5), speed) * yDir,
            );

            if (Math.abs(xDist) > Math.abs(yDist)) {
                if (xDist < 0) {
                    this.direction = PositionMessage_Direction.LEFT;
                } else {
                    this.direction = PositionMessage_Direction.RIGHT;
                }
            } else {
                if (yDist < 0) {
                    this.direction = PositionMessage_Direction.UP;
                } else {
                    this.direction = PositionMessage_Direction.DOWN;
                }
            }
        }

        this.setDepth(this.y);
        this.playAnimation(this.direction, this.animationType);
    }

    /**
     * The picture of the companion once its texture is loaded, read back once whoever asks: `undefined` if the
     * texture could not be loaded.
     */
    private takePicture(): Promise<string | undefined> {
        this.picture ??= Promise.resolve(this.texturePromise).then(() =>
            this.sprites.size === 0 ? undefined : this.getSnapshot(),
        );
        return this.picture;
    }

    public async getSnapshot(): Promise<string> {
        const sprites = Array.from(this.sprites.values()).map((sprite) => {
            return { sprite, frame: 1 };
        });
        return TexturesHelper.getSnapshot(this.scene, ...sprites).catch((reason) => {
            console.warn(reason);
            for (const sprite of this.sprites.values()) {
                // it can be either cat or dog prefix
                if (sprite.texture.key.includes("cat") || sprite.texture.key.includes("dog")) {
                    return this.scene.textures.getBase64(sprite.texture.key);
                }
            }
            return "cat1";
        });
    }

    private playAnimation(direction: PositionMessage_Direction, type: PlayerAnimationTypes): void {
        if (this.invisible) return;

        const directionStr = ProtobufClientUtils.toDirectionString(direction);
        for (const [resource, sprite] of this.sprites.entries()) {
            sprite.play(`${resource}-${directionStr}-${type}`, true);
        }
    }

    private addResource(resource: string, frame?: string | number): void {
        const sprite = new Sprite(this.scene, 0, 0, resource, frame);
        if (this.suspended) {
            sprite.setActive(false);
        }

        this.add(sprite);

        this.getAnimations(resource).forEach((animation) => {
            if (!animation.key || !this.scene.anims.exists(animation.key)) {
                this.scene.anims.create(animation);
            }
        });

        this.scene.sys.updateList.add(sprite);
        this.sprites.set(resource, sprite);
    }

    private getAnimations(resource: string): Phaser.Types.Animations.Animation[] {
        return [
            {
                key: `${resource}-down-${PlayerAnimationTypes.Idle}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [1] }),
                frameRate: 10,
                repeat: 1,
            },
            {
                key: `${resource}-left-${PlayerAnimationTypes.Idle}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [4] }),
                frameRate: 10,
                repeat: 1,
            },
            {
                key: `${resource}-right-${PlayerAnimationTypes.Idle}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [7] }),
                frameRate: 10,
                repeat: 1,
            },
            {
                key: `${resource}-up-${PlayerAnimationTypes.Idle}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [10] }),
                frameRate: 10,
                repeat: 1,
            },
            {
                key: `${resource}-down-${PlayerAnimationTypes.Walk}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [0, 1, 2] }),
                frameRate: 15,
                repeat: -1,
            },
            {
                key: `${resource}-left-${PlayerAnimationTypes.Walk}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [3, 4, 5] }),
                frameRate: 15,
                repeat: -1,
            },
            {
                key: `${resource}-right-${PlayerAnimationTypes.Walk}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [6, 7, 8] }),
                frameRate: 15,
                repeat: -1,
            },
            {
                key: `${resource}-up-${PlayerAnimationTypes.Walk}`,
                frames: this.scene.anims.generateFrameNumbers(resource, { frames: [9, 10, 11] }),
                frameRate: 15,
                repeat: -1,
            },
        ];
    }

    private getBody(): Body {
        const body = this.body;

        if (!(body instanceof Body)) {
            throw new Error("Container does not have arcade body");
        }

        return body;
    }

    public destroy(): void {
        this.texturePromise?.cancel();
        for (const sprite of this.sprites.values()) {
            if (this.scene) {
                this.scene.sys.updateList.remove(sprite);
            }
        }

        if (this.scene) {
            this.scene.events.removeListener("update", this.updateListener);
        }

        super.destroy();
    }

    public get pictureStore(): PictureStore {
        return this._pictureStore;
    }
}
