import { mapDragThreshold } from "../UserInput/MapDragGesture";

/**
 * Selecting a floor tile and walking there with the mouse, and the state a walk leaves behind.
 *
 * The left button belongs to the map drag (`GameSceneUserInputHandler`), so a single left click moves nothing: the
 * controller makes it select a tile instead, and a second click on that tile walks there. A right click and a touch
 * tap already walk through `GameScene.moveTo` in that handler, so the controller issues no walk of its own for them:
 * it only notices the walk and drops the selection, which the walk's own destination marker replaces.
 *
 * The controller knows no Phaser type: the scene's camera, map, pathfinding and drawing come in through
 * `TileInteractionHost`, and the pointer arrives as plain `TilePointer`s, so the rules run in a unit test.
 */

export interface Point {
    readonly x: number;
    readonly y: number;
}

/** A tile of the map, by column and row. */
export interface Tile {
    readonly tileX: number;
    readonly tileY: number;
}

/** A rectangle in game pixels, the unit the pointer uses. */
export interface ScreenRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** One pointer event as the controller reads it. `x` and `y` are in game pixels, `time` in milliseconds. */
export interface TilePointer {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly button: "left" | "right" | "other";
    readonly touch: boolean;
    readonly time: number;
}

/** The marks the controller asks the host to draw. A mark is absent when its tile is `undefined`. */
export interface TileMarks {
    readonly selected: Tile | undefined;
    readonly hovered: Tile | undefined;
}

export interface TileInteractionHost {
    /** The size of a tile, in world pixels. */
    tileSize(): { readonly width: number; readonly height: number };
    /** The size of the map, in tiles: a click outside it selects nothing. */
    mapSize(): { readonly width: number; readonly height: number };
    screenToWorld(point: Point): Point;
    worldToScreen(point: Point): Point;
    /** Whether the player may use the map now: controls on, no map editor, and the host's own conditions. */
    canSelect(): boolean;
    /** Whether the room lets the player move by clicking. */
    canWalk(): boolean;
    /**
     * Walks to a world point through the scene's pathfinding. The promise settles when the walk ends, however it ends,
     * and never rejects: the host reports a failure itself.
     */
    walkTo(destination: Point): Promise<void>;
    /** Whether the player follows a path now, whoever started it. */
    isWalking(): boolean;
    /** Ends the walk in progress where the player stands. */
    cancelWalk(): void;
    /** Draws the marks. Called only when one of them changed. */
    paint(marks: TileMarks): void;
}

/** What a live region says about the walk. It changes at most once a second, so a reader is never flooded. */
export type WalkStatus = "idle" | "going" | "cancelled";

export interface TileInteractionState extends TileMarks {
    /** Whether a walk is in progress now, whoever started it. It follows the walk with no delay of its own. */
    readonly walking: boolean;
    readonly walkStatus: WalkStatus;
}

/** The longest time between the two clicks of a double click, as the reference office measured it. */
export const DOUBLE_CLICK_MS = 450;
/** How often `update` asks the host whether the player walks: well inside the 100 ms a control may take to answer. */
export const WALK_POLL_MS = 50;
/** The least time between two changes of the walk status. */
export const WALK_STATUS_INTERVAL_MS = 1000;

interface Press {
    readonly pointer: TilePointer;
    dragged: boolean;
}

interface Click {
    readonly tile: Tile;
    readonly time: number;
}

const sameTile = (a: Tile | undefined, b: Tile | undefined): boolean =>
    a === b || (a !== undefined && b !== undefined && a.tileX === b.tileX && a.tileY === b.tileY);

export class TileInteractionController {
    private selected: Tile | undefined;
    private hovered: Tile | undefined;
    private walking = false;
    private walkStatus: WalkStatus = "idle";
    private wantedStatus: WalkStatus = "idle";
    private statusChangedAt = Number.NEGATIVE_INFINITY;
    private lastPollAt = Number.NEGATIVE_INFINITY;
    /** The time of the last frame, for the changes that no frame causes. */
    private now = 0;
    /** Walks this controller started whose pathfinding or path has not ended: the host cannot say it walks before. */
    private pendingWalks = 0;
    private press: Press | undefined;
    private lastClick: Click | undefined;
    private disposed = false;

    constructor(
        private readonly host: TileInteractionHost,
        private readonly onChange: (state: TileInteractionState) => void,
    ) {}

    public get state(): TileInteractionState {
        return {
            selected: this.selected,
            hovered: this.hovered,
            walking: this.walking,
            walkStatus: this.walkStatus,
        };
    }

    public pointerDown(pointer: TilePointer): void {
        if (pointer.button === "left" && !pointer.touch) this.press = { pointer, dragged: false };
        else this.press = undefined;
    }

    public pointerMove(pointer: TilePointer, overObject: boolean): void {
        if (pointer.touch) return;
        const press = this.press;
        if (press !== undefined && press.pointer.id === pointer.id) {
            press.dragged ||= this.movedPastThreshold(press.pointer, pointer);
            if (press.dragged) this.setHovered(undefined);
            return;
        }
        this.setHovered(overObject || !this.host.canSelect() ? undefined : this.tileAt(pointer));
    }

    /**
     * A release ends a click when it follows a press that did not turn into a drag and lands on the floor. A release
     * over an avatar or an object is theirs: the scene's own handler acts on it.
     */
    public pointerUp(pointer: TilePointer, overObject: boolean): void {
        const press = this.press;
        this.press = undefined;
        if (press === undefined || press.pointer.id !== pointer.id || pointer.button !== "left") return;
        if (press.dragged || this.movedPastThreshold(press.pointer, pointer)) {
            this.lastClick = undefined;
            return;
        }
        if (overObject || !this.host.canSelect()) {
            this.lastClick = undefined;
            return;
        }
        const tile = this.tileAt(pointer);
        if (tile === undefined) return;
        const previous = this.lastClick;
        if (
            previous !== undefined &&
            sameTile(previous.tile, tile) &&
            pointer.time - previous.time <= DOUBLE_CLICK_MS &&
            this.host.canWalk()
        ) {
            this.lastClick = undefined;
            this.setSelected(undefined);
            this.walkTo(tile);
            return;
        }
        this.lastClick = { tile, time: pointer.time };
        this.setSelected(sameTile(this.selected, tile) ? undefined : tile);
    }

    /** The pointer was taken away (a modal opened, the window lost focus): the press is no click. */
    public pointerCancel(): void {
        this.press = undefined;
        this.lastClick = undefined;
    }

    /** The pointer left the game. */
    public pointerOut(): void {
        this.setHovered(undefined);
    }

    /** Escape drops the selection. It answers whether there was one, so the caller knows the key was used. */
    public escape(): boolean {
        if (this.selected === undefined) return false;
        this.setSelected(undefined);
        return true;
    }

    /** Ends the walk in progress. It answers whether there was one. */
    public cancelWalk(): boolean {
        if (!this.walking) return false;
        this.host.cancelWalk();
        this.walking = false;
        this.wantedStatus = "cancelled";
        this.applyStatus(this.now);
        this.emit();
        return true;
    }

    /** Where a tile stands on screen now, whatever the camera does: the hover and the selection follow its zoom and scroll. */
    public project(tile: Tile): ScreenRect {
        const { width, height } = this.host.tileSize();
        const topLeft = this.host.worldToScreen({ x: tile.tileX * width, y: tile.tileY * height });
        const bottomRight = this.host.worldToScreen({ x: (tile.tileX + 1) * width, y: (tile.tileY + 1) * height });
        return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
    }

    /** Called on each frame: it follows the player's walk and drops the marks the player may no longer use. */
    public update(time: number): void {
        if (this.disposed) return;
        this.now = time;
        let changed = false;
        if (!this.host.canSelect()) {
            this.press = undefined;
            this.lastClick = undefined;
            changed = this.clearSelection() || changed;
            changed = this.clearHover() || changed;
        }
        if (time - this.lastPollAt >= WALK_POLL_MS) {
            this.lastPollAt = time;
            changed = this.setWalking(this.pendingWalks > 0 || this.host.isWalking()) || changed;
        }
        changed = this.applyStatus(time) || changed;
        if (changed) this.emit();
    }

    public dispose(): void {
        this.disposed = true;
        this.press = undefined;
        this.lastClick = undefined;
        this.selected = undefined;
        this.hovered = undefined;
        this.host.paint({ selected: undefined, hovered: undefined });
    }

    private walkTo(tile: Tile): void {
        const { width, height } = this.host.tileSize();
        this.pendingWalks += 1;
        this.setWalking(true);
        this.applyStatus(this.now);
        this.emit();
        this.host
            .walkTo({ x: (tile.tileX + 0.5) * width, y: (tile.tileY + 0.5) * height })
            // The host reports a failed walk itself and never rejects; one that does breaks that contract, and is shown.
            .catch((error: unknown) => console.error("[tile interaction] the host's walk rejected", error))
            .finally(() => {
                this.pendingWalks -= 1;
            });
    }

    /** Whoever started a walk (a right click, a tap, a double click), its destination marker takes the selection's place. */
    private setWalking(walking: boolean): boolean {
        if (walking === this.walking) return false;
        this.walking = walking;
        if (walking) this.clearSelection();
        this.wantedStatus = walking ? "going" : "idle";
        return true;
    }

    /** Takes the walk status towards the wanted one, no more than once a second. Answers whether it changed. */
    private applyStatus(time: number): boolean {
        if (this.walkStatus === this.wantedStatus || time - this.statusChangedAt < WALK_STATUS_INTERVAL_MS)
            return false;
        this.walkStatus = this.wantedStatus;
        this.statusChangedAt = time;
        return true;
    }

    private setSelected(tile: Tile | undefined): void {
        if (sameTile(this.selected, tile)) return;
        this.selected = tile;
        this.paintMarks();
        this.emit();
    }

    private setHovered(tile: Tile | undefined): void {
        if (sameTile(this.hovered, tile)) return;
        this.hovered = tile;
        this.paintMarks();
        this.emit();
    }

    private clearSelection(): boolean {
        if (this.selected === undefined) return false;
        this.selected = undefined;
        this.paintMarks();
        return true;
    }

    private clearHover(): boolean {
        if (this.hovered === undefined) return false;
        this.hovered = undefined;
        this.paintMarks();
        return true;
    }

    private paintMarks(): void {
        this.host.paint({ selected: this.selected, hovered: this.hovered });
    }

    private emit(): void {
        this.onChange(this.state);
    }

    private tileAt(pointer: Point): Tile | undefined {
        const world = this.host.screenToWorld(pointer);
        const { width, height } = this.host.tileSize();
        const tileX = Math.floor(world.x / width);
        const tileY = Math.floor(world.y / height);
        const map = this.host.mapSize();
        return tileX >= 0 && tileY >= 0 && tileX < map.width && tileY < map.height ? { tileX, tileY } : undefined;
    }

    private movedPastThreshold(from: TilePointer, to: Point): boolean {
        return Math.hypot(to.x - from.x, to.y - from.y) >= mapDragThreshold({ wasTouch: from.touch });
    }
}
