import * as Phaser from "phaser";
import { waScaleManager, WaScaleManagerEvent } from "../Services/WaScaleManager";
import { DEPTH_INGAME_TEXT_INDEX } from "./DepthIndexes";
import type { GameScene } from "./GameScene";

// Side of the square probe used to measure the ancestor scale. Large enough that sub-pixel rounding
// on the measured on-screen size is negligible.
const SCALE_PROBE_SIZE = 100;

const CORRECTION_RATE = 0.65; // When one game pixel is smaller than one screen pixel (zoomed-out), we zoom out the Woka name, but only up to CORRECTION_RATE. After that, the Woka name will stay at its current screen size even if we zoom out more (to keep the text readable)

// How long the zoom must stay still before the names are laid out again at their final size.
const ZOOM_SETTLE_DELAY_MS = 150;

// Both variables are set on the DOM layer and inherited by every name tag (and by the badges inside it), so a zoom
// step is one write per variable instead of a set of writes per tag.
// The layout scale: multiplies the font size, the padding and the other lengths of the pill.
export const DOM_SCALE_VARIABLE = "--username-dom-scale";
// The scale of each tag's own CSS `transform`.
export const TRANSFORM_SCALE_VARIABLE = "--username-transform-scale";

function getDisplayScale(zoomModifier: number): number {
    return Math.max(zoomModifier > 0 ? CORRECTION_RATE / zoomModifier : 1, 1);
}

/**
 * The DOM element that holds the name tags of a scene, and the scale they share.
 *
 * While the zoom moves, only `--username-transform-scale` follows it: the tags keep the layout they had when the zoom
 * last settled, so the browser does not lay out and rasterize every pill again on every frame. Once the zoom has been
 * still for a moment, the tags are laid out again at the size they are shown at (see getTransformScale()).
 *
 * The layer follows the zoom from its creation to its destruction.
 */
export class UsernameDomLayer {
    private readonly container: HTMLDivElement;
    private readonly domElement: Phaser.GameObjects.DOMElement;
    // A hidden, fixed-size element living in the same container as the usernames. Phaser scales this
    // container to follow the camera, so the probe's measured on-screen width divided by its layout
    // width gives the exact scale the DOM layer applies on screen (`ancestorScale`). We measure it
    // rather than derive it from zoomModifier/actualZoom because the real value depends on the camera
    // zoom AND devicePixelRatio in a way those numbers do not capture (see UsernameDisplay).
    private readonly scaleProbe: HTMLDivElement;
    private ancestorScale = 1;
    private ancestorScaleStale = true;
    private displayScale: number;
    // The scales the tags are laid out with: the zoom was last still with these.
    private settledDisplayScale: number;
    private settledTransformScale = 1;
    private settleTimeout: number | undefined;

    /**
     * @param hideBelowZoomModifier Below this zoom modifier the whole layer is hidden, as one write: a zoomed-out view
     * draws no name tag. Undefined keeps the tags at every zoom.
     */
    constructor(
        private readonly scene: GameScene,
        private readonly hideBelowZoomModifier?: number,
    ) {
        this.container = document.createElement("div");
        this.container.style.position = "relative";
        this.container.style.pointerEvents = "none";
        this.container.style.overflow = "visible";

        this.scaleProbe = document.createElement("div");
        this.scaleProbe.style.position = "absolute";
        this.scaleProbe.style.top = "0";
        this.scaleProbe.style.left = "0";
        this.scaleProbe.style.width = `${SCALE_PROBE_SIZE}px`;
        this.scaleProbe.style.height = `${SCALE_PROBE_SIZE}px`;
        this.scaleProbe.style.visibility = "hidden";
        this.scaleProbe.style.pointerEvents = "none";
        this.container.appendChild(this.scaleProbe);

        this.domElement = scene.add.dom(0, 0, this.container).setOrigin(0, 0).setDepth(DEPTH_INGAME_TEXT_INDEX);

        this.domElement.pointerEvents = "none";

        this.displayScale = getDisplayScale(waScaleManager.zoomModifier);
        this.hideBelowZoom(waScaleManager.zoomModifier);
        this.settledDisplayScale = this.displayScale;
        this.applySettledScale();
        this.settleAtRender();
        scene.game.events.on(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
    }

    public setVisible(visible: boolean): void {
        this.domElement.setVisible(visible);
    }

    public addUsername(usernameDisplayElement: HTMLDivElement): void {
        this.container.appendChild(usernameDisplayElement);
    }

    public destroy(): void {
        this.scene.game.events.off(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
        this.scene.events.off(Phaser.Scenes.Events.RENDER, this.applySettledScale);
        window.clearTimeout(this.settleTimeout);
        this.domElement.destroy();
    }

    private hideBelowZoom(zoomModifier: number): void {
        if (this.hideBelowZoomModifier === undefined) {
            return;
        }
        const display = zoomModifier < this.hideBelowZoomModifier ? "none" : "";
        if (this.container.style.display !== display) {
            this.container.style.display = display;
        }
    }

    private readonly onZoomChanged = (zoomModifier: number): void => {
        this.hideBelowZoom(zoomModifier);
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
        this.invalidateAncestorScale();
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
        return Math.min(1 / this.getAncestorScale(), 1);
    }

    /**
     * Marks the measured ancestor scale as stale so it is re-measured on the next read. Call this
     * whenever the camera zoom or the display (resize, device pixel ratio change) may have changed.
     */
    private invalidateAncestorScale(): void {
        this.ancestorScaleStale = true;
    }

    /**
     * The scale the DOM layer currently applies to its children on screen, measured from the probe.
     * Measurement is lazy and cached: the (potentially layout-forcing) `getBoundingClientRect` runs
     * at most once per invalidation, shared by every username. Read it at render time, once Phaser
     * has applied the layer's transform for the current frame.
     */
    private getAncestorScale(): number {
        if (this.ancestorScaleStale) {
            const width = this.scaleProbe.getBoundingClientRect().width;
            // Guard against a 0 measurement (layer not laid out yet): keep the previous value and
            // stay stale so we re-measure later.
            if (width > 0) {
                this.ancestorScale = width / SCALE_PROBE_SIZE;
                this.ancestorScaleStale = false;
            }
        }
        return this.ancestorScale;
    }

    private setVariable(name: string, value: number): void {
        const text = value.toString();
        if (this.container.style.getPropertyValue(name) !== text) {
            this.container.style.setProperty(name, text);
        }
    }
}
