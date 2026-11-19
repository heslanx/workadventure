import * as Phaser from "phaser";
import { AvailabilityStatus } from "@workadventure/messages";
import type { GameScene } from "../Game/GameScene";
import { DOM_SCALE_VARIABLE, TRANSFORM_SCALE_VARIABLE } from "../Game/UsernameDomLayer";
import { readableTextColor } from "../../Components/Video/readableTextColor";
import { PLAYER_NAME_GAP, PLAYER_NAME_HEIGHT } from "./UsernameDisplaySizes";
import { UsernameMegaphoneDisplay } from "./UsernameMegaphoneDisplay";
import { UsernameRaisedHandDisplay } from "./UsernameRaisedHandDisplay";
import { UsernameStatusDisplay } from "./UsernameStatusDisplay";

const USERNAME_FONT_FAMILY = "Roboto";
// In game pixels, scaled with the camera zoom like the whole pill. 11 is the smallest legible text size.
const USERNAME_FONT_SIZE = 11;
const USERNAME_FONT_WEIGHT = 500;

// Dark enough for the white name to keep 4.5:1 or better over any map, even a white one.
const PLAYER_NAME_BACKGROUND_COLOR = "rgba(27, 42, 65, 0.7)";
const PLAYER_NAME_BACKGROUND_RADIUS = 8;
const PLAYER_NAME_PADDING = 4;

/** A length in game pixels, scaled like the rest of the pill. */
const scaled = (pixels: number): string => `calc(${pixels}px * var(${DOM_SCALE_VARIABLE}, 1))`;

export class UsernameDisplay {
    private static nextDomUsernameId = 0;
    private readonly domUsernameId = UsernameDisplay.nextDomUsernameId++;
    private readonly element: HTMLDivElement;
    private readonly playerNameElement: HTMLParagraphElement;
    private readonly playerName: string;
    private playerNameOutlineColor: number | undefined;
    private readonly statusDisplay: UsernameStatusDisplay;
    private readonly megaphoneDisplay: UsernameMegaphoneDisplay;
    private readonly raisedHandDisplay: UsernameRaisedHandDisplay;

    private toForeFront: boolean = false;
    private depth: number = 0;
    // A hidden tag keeps where it is and its depth, but writes nothing until it is shown again (see setHidden()).
    private hidden = false;

    constructor(
        private scene: GameScene,
        private x: number,
        private y: number,
        playerName: string,
        outlineColor: number | undefined,
    ) {
        this.playerName = playerName;

        this.playerNameOutlineColor = outlineColor;
        this.statusDisplay = new UsernameStatusDisplay();
        this.megaphoneDisplay = new UsernameMegaphoneDisplay();
        this.raisedHandDisplay = new UsernameRaisedHandDisplay();
        this.playerNameElement = this.createPlayerNameElement();

        this.element = document.createElement("div");

        this.element.ariaHidden = "true";
        this.element.className = "username-display";
        this.element.style.background = PLAYER_NAME_BACKGROUND_COLOR;

        this.applyLayout();
        this.applyTransform();
        this.updatePlayerDepth();
        this.element.append(
            this.statusDisplay.element,
            this.playerNameElement,
            this.megaphoneDisplay.element,
            this.raisedHandDisplay.element,
        );
        this.updateUsernameBackgroundColor(outlineColor);

        // The layer holds the scale the tags share (see UsernameDomLayer).
        this.gameScene.usernameDomLayer.addUsername(this.element);
    }

    public setPlayerNameOutlineColor(outlineColor: number | undefined): void {
        if (this.playerNameOutlineColor === outlineColor) {
            return;
        }
        this.playerNameOutlineColor = outlineColor;

        this.updateUsernameBackgroundColor(outlineColor);
    }

    public setAvailabilityStatus(availabilityStatus: AvailabilityStatus, instant = false): void {
        this.statusDisplay.setAvailabilityStatus(availabilityStatus, instant);
        if (availabilityStatus === AvailabilityStatus.UNCHANGED) {
            // UNCHANGED is 0, so it would compare unequal to SPEAKER and hide the megaphone, while
            // the status dot correctly ignores it.
            return;
        }
        this.megaphoneDisplay.show(availabilityStatus === AvailabilityStatus.SPEAKER, instant);
    }

    public setRaisedHand(raised: boolean, forceClose = false): void {
        this.raisedHandDisplay.show(raised, forceClose);
    }

    public getAvailabilityStatus(): AvailabilityStatus {
        return this.statusDisplay.availabilityStatus;
    }

    public setPlayerDepth(depth: number): void {
        this.depth = depth;
        this.updatePlayerDepth();
    }

    private updatePlayerDepth(): void {
        if (this.hidden) {
            return;
        }
        this.element.style.zIndex = `${Math.round(this.depth + (this.toForeFront ? 2000000000 : 0))}`;
    }

    public setPosition(x: number, y: number): this {
        if (x === this.x && y === this.y) {
            return this;
        }

        this.x = x;
        this.y = y;
        if (!this.hidden) {
            this.updateDomPosition();
        }
        return this;
    }

    /**
     * Hides the tag, or shows it again, for the avatar it belongs to going out of the camera view and coming back.
     *
     * Hiding it takes one write, and a hidden tag follows no move and no depth change: the avatar can walk about
     * unseen at no cost. Showing it again puts it where the avatar is by then.
     */
    public setHidden(hidden: boolean): void {
        if (this.hidden === hidden) {
            return;
        }
        this.hidden = hidden;
        // An inline `display` wins over the one of the class, so removing it gives the tag its display back.
        this.element.style.display = hidden ? "none" : "";
        if (!hidden) {
            this.updatePlayerDepth();
            this.updateDomPosition();
        }
    }

    public destroy(): void {
        this.element.remove();
        this.statusDisplay.destroy();
        this.megaphoneDisplay.destroy();
        this.raisedHandDisplay.destroy();
    }

    private get gameScene(): GameScene {
        return this.scene;
    }

    private updateDomPosition(): void {
        this.scene.events.once(Phaser.Scenes.Events.RENDER, () => {
            // The tag was hidden since the move: it is placed when it is shown again.
            if (!this.hidden) {
                this.applyTransform();
            }
        });
    }

    private createPlayerNameElement(): HTMLParagraphElement {
        const element = document.createElement("p");

        element.textContent = this.playerName;
        element.style.margin = "0";
        element.style.marginRight = scaled(2);
        element.style.color = "#ffffff";
        element.style.fontFamily = USERNAME_FONT_FAMILY;
        element.style.fontSize = scaled(USERNAME_FONT_SIZE);
        element.style.fontWeight = `${USERNAME_FONT_WEIGHT}`;
        element.style.whiteSpace = "nowrap";
        element.style.pointerEvents = "none";

        return element;
    }

    /**
     * If true, the z-index is updated to be at the very top. Used when we hover over a Woka.
     */
    public setToForeFront(toForeFront: boolean): void {
        this.toForeFront = toForeFront;
        this.updatePlayerDepth();
    }

    private applyTransform(): void {
        // The tag's bottom centre is its anchor, so its position does not depend on the scale.
        this.element.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) translate(-50%, -100%) scale(var(${TRANSFORM_SCALE_VARIABLE}, 1))`;
    }

    // The sizes are set once: they follow the layer's scale (see UsernameDomLayer).
    private applyLayout(): void {
        this.element.style.transformOrigin = "50% 100%";
        this.element.style.height = scaled(PLAYER_NAME_HEIGHT);
        this.element.style.gap = scaled(PLAYER_NAME_GAP);
        this.element.style.padding = `0 ${scaled(PLAYER_NAME_PADDING)}`;
        this.element.style.borderRadius = scaled(PLAYER_NAME_BACKGROUND_RADIUS);
    }

    private updateUsernameBackgroundColor(color: number | undefined): void {
        this.element.style.background =
            color === undefined ? PLAYER_NAME_BACKGROUND_COLOR : `#${color.toString(16).padStart(6, "0")}`;
        // The outline colour can be light: pick the name colour that keeps it readable (4.5:1 or better).
        this.playerNameElement.style.color =
            color === undefined ? "#ffffff" : readableTextColor(`#${color.toString(16).padStart(6, "0")}`);
    }

    public setTalking(talking: boolean, isSpeaker: boolean): void {
        if (talking) {
            this.element.classList.add(isSpeaker ? "speaker" : "talking");
        } else {
            this.element.classList.remove("talking");
            this.element.classList.remove("speaker");
        }
    }
}
