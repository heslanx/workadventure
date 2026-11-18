import * as Phaser from "phaser";
import { AvailabilityStatus } from "@workadventure/messages";
import type { GameScene } from "../Game/GameScene";
import type { UsernameDomLayer } from "../Game/UsernameDomLayer";
import { waScaleManager, WaScaleManagerEvent } from "../Services/WaScaleManager";
import { readableTextColor } from "../../Components/Video/readableTextColor";
import { PLAYER_NAME_GAP, PLAYER_NAME_HEIGHT } from "./UsernameDisplaySizes";
import { UsernameMegaphoneDisplay } from "./UsernameMegaphoneDisplay";
import { UsernameRaisedHandDisplay } from "./UsernameRaisedHandDisplay";
import { UsernameStatusDisplay } from "./UsernameStatusDisplay";

const CORRECTION_RATE = 0.65; // When one game pixel is smaller than one screen pixel (zoomed-out), we zoom out the Woka name, but only up to CORRECTION_RATE. After that, the Woka name will stay at its current screen size even if we zoom out more (to keep the text readable)
const USERNAME_FONT_FAMILY = "Roboto";
// In game pixels, scaled with the camera zoom like the whole pill. 11 is the smallest legible text size.
const USERNAME_FONT_SIZE = 11;
const USERNAME_FONT_WEIGHT = 500;

// Dark enough for the white name to keep 4.5:1 or better over any map, even a white one.
const PLAYER_NAME_BACKGROUND_COLOR = "rgba(27, 42, 65, 0.7)";
const PLAYER_NAME_BACKGROUND_RADIUS = 8;
const PLAYER_NAME_PADDING = 4;

// How long the zoom must stay still before the names are laid out again at their final size.
const ZOOM_SETTLE_DELAY_MS = 150;

// Both variables are set on the DOM layer and inherited by every name tag (and by the badges inside it), so a zoom
// step is one write per variable instead of a set of writes per tag.
// The layout scale: multiplies the font size, the padding and the other lengths of the pill.
const DOM_SCALE_VARIABLE = "--username-dom-scale";
// The scale of each tag's own CSS `transform`.
const TRANSFORM_SCALE_VARIABLE = "--username-transform-scale";

/** A length in game pixels, scaled like the rest of the pill. */
const scaled = (pixels: number): string => `calc(${pixels}px * var(${DOM_SCALE_VARIABLE}, 1))`;

function getDisplayScale(zoomModifier: number): number {
    return Math.max(zoomModifier > 0 ? CORRECTION_RATE / zoomModifier : 1, 1);
}

/**
 * The scale shared by all the name tags of one DOM layer.
 *
 * While the zoom moves, only `--username-transform-scale` follows it: the tags keep the layout they had when the
 * zoom last settled, so the browser does not lay out and rasterize every pill again on every frame. Once the zoom has
 * been still for a moment, the tags are laid out again at the size they are shown at (see getTransformScale()).
 */
class UsernameLayerScale {
    private static readonly byLayer = new WeakMap<UsernameDomLayer, UsernameLayerScale>();

    public static acquire(scene: GameScene, layerElement: HTMLElement): UsernameLayerScale {
        let layerScale = UsernameLayerScale.byLayer.get(scene.usernameDomLayer);
        if (layerScale === undefined) {
            layerScale = new UsernameLayerScale(scene, layerElement);
            UsernameLayerScale.byLayer.set(scene.usernameDomLayer, layerScale);
        }
        layerScale.tagCount++;
        return layerScale;
    }

    private tagCount = 0;
    private displayScale: number;
    // The scales the tags are laid out with: the zoom was last still with these.
    private settledDisplayScale: number;
    private settledTransformScale = 1;
    private settleTimeout: number | undefined;

    private constructor(
        private readonly scene: GameScene,
        private readonly layerElement: HTMLElement,
    ) {
        this.displayScale = getDisplayScale(waScaleManager.zoomModifier);
        this.settledDisplayScale = this.displayScale;
        this.applySettledScale();
        this.settleAtRender();
        this.scene.game.events.on(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
    }

    public release(): void {
        if (--this.tagCount > 0) {
            return;
        }
        this.scene.game.events.off(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
        this.scene.events.off(Phaser.Scenes.Events.RENDER, this.applySettledScale);
        window.clearTimeout(this.settleTimeout);
        UsernameLayerScale.byLayer.delete(this.scene.usernameDomLayer);
    }

    private readonly onZoomChanged = (zoomModifier: number): void => {
        this.displayScale = getDisplayScale(zoomModifier);
        // The rendered size of a tag is `displayScale * layerScale`, whatever the layout it was laid out with. The
        // layer's own scale applies by itself, so what the tag's transform has to change by is the part of
        // `displayScale` that the layout does not carry yet.
        this.setVariable(
            TRANSFORM_SCALE_VARIABLE,
            (this.settledTransformScale * this.displayScale) / this.settledDisplayScale,
        );
        window.clearTimeout(this.settleTimeout);
        this.settleTimeout = window.setTimeout(() => {
            this.settleTimeout = undefined;
            this.settleAtRender();
            // The zoom has stopped moving, so nothing else is going to ask for a frame.
            this.scene.markDirty();
        }, ZOOM_SETTLE_DELAY_MS);
    };

    private settleAtRender(): void {
        // The layer scale is measured from the DOM layer, so invalidate it and measure at render time, once Phaser has
        // updated the layer's transform for the zoom. Measuring immediately would read the previous frame's scale.
        this.scene.usernameDomLayer.invalidateAncestorScale();
        this.scene.events.off(Phaser.Scenes.Events.RENDER, this.applySettledScale);
        this.scene.events.once(Phaser.Scenes.Events.RENDER, this.applySettledScale);
    }

    private readonly applySettledScale = (): void => {
        this.settledTransformScale = this.getTransformScale();
        this.settledDisplayScale = this.displayScale;
        // Dividing by the transform scale folds the part of the zoom compensation that getTransformScale() cannot
        // apply without magnifying into the layout size, so the element is laid out — and therefore rasterized — at
        // full resolution. `displayScale / transformScale` keeps the final rendered size independent of the split:
        // the parent Phaser DOM layer re-applies the scale getTransformScale() cancelled, leaving the rendered size
        // at `displayScale * layerScale`.
        this.setVariable(DOM_SCALE_VARIABLE, this.settledDisplayScale / this.settledTransformScale);
        this.setVariable(TRANSFORM_SCALE_VARIABLE, this.settledTransformScale);
    };

    /**
     * The scale applied through the tags' own CSS `transform`.
     *
     * A tag is a promoted compositing layer (`will-change: transform` + `translate3d`). Safari rasterizes such a
     * layer's backing store at full resolution ONLY when the element's own transform is a *minification* (scale < 1);
     * when the own transform is a pure translation (scale === 1) it caches the bitmap at `devicePixelRatio` and lets
     * the parent transform stretch it — blurry on a low-DPI screen, but fine on a 2× Retina screen whose backing store
     * is already twice as dense. That is exactly why the name was blurry at a medium zoom only on the 2K monitor.
     *
     * So we cancel the parent DOM layer's on-screen scale here to bring the layer's total scale to ≤ 1, which makes the
     * own transform a genuine minification whenever the parent magnifies. We MEASURE that parent scale from the DOM
     * (`getAncestorScale`) rather than deriving it from `zoomModifier`/`actualZoom`, because the real value depends on
     * the camera zoom and the device pixel ratio together and does not match either of those numbers.
     *
     * Clamp at 1 so we never magnify: a scale ≥ 1 is the pure-translate/upscale case that blurs on Safari. When the
     * parent is already minifying (ancestorScale < 1, e.g. zoomed out) the clamp leaves the own transform at 1, which
     * is fine — minifying a bitmap stays sharp everywhere.
     *
     * While the zoom moves the tags are not rasterized again, so they are a little soft on a magnifying parent; they
     * sharpen as soon as the zoom settles.
     */
    private getTransformScale(): number {
        return Math.min(1 / this.scene.usernameDomLayer.getAncestorScale(), 1);
    }

    private setVariable(name: string, value: number): void {
        const text = value.toString();
        if (this.layerElement.style.getPropertyValue(name) !== text) {
            this.layerElement.style.setProperty(name, text);
        }
    }
}

export class UsernameDisplay {
    private static nextDomUsernameId = 0;
    private readonly domUsernameId = UsernameDisplay.nextDomUsernameId++;
    private readonly element: HTMLDivElement;
    private readonly playerNameElement: HTMLParagraphElement;
    private readonly playerName: string;
    private playerNameOutlineColor: number | undefined;
    private layerScale: UsernameLayerScale | undefined;
    private readonly statusDisplay: UsernameStatusDisplay;
    private readonly megaphoneDisplay: UsernameMegaphoneDisplay;
    private readonly raisedHandDisplay: UsernameRaisedHandDisplay;

    private toForeFront: boolean = false;
    private depth: number = 0;

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

        this.gameScene.usernameDomLayer.addUsername(this.element);
        // The layer element is where the layer put this tag. The scale lives there, shared by all the tags.
        const layerElement = this.element.parentElement;
        if (layerElement === null) {
            throw new Error("The username DOM layer did not attach the name tag");
        }
        this.layerScale = UsernameLayerScale.acquire(this.scene, layerElement);
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
        this.element.style.zIndex = `${Math.round(this.depth + (this.toForeFront ? 2000000000 : 0))}`;
    }

    public setPosition(x: number, y: number): this {
        if (x === this.x && y === this.y) {
            return this;
        }

        this.x = x;
        this.y = y;
        this.updateDomPosition();
        return this;
    }

    public destroy(): void {
        this.element.remove();
        this.statusDisplay.destroy();
        this.megaphoneDisplay.destroy();
        this.raisedHandDisplay.destroy();
        // Release once: the layer scale counts its tags, and a second destroy() must not take another tag's place.
        this.layerScale?.release();
        this.layerScale = undefined;
    }

    private get gameScene(): GameScene {
        return this.scene;
    }

    private updateDomPosition(): void {
        this.scene.events.once(Phaser.Scenes.Events.RENDER, () => {
            this.applyTransform();
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

    // The sizes are set once: they follow the layer's scale (see UsernameLayerScale).
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
