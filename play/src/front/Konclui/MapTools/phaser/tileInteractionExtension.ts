import * as Phaser from "phaser";
import type { Readable, Unsubscriber } from "svelte/store";
import type { SceneExtension } from "../../../ExternalModule/ClientExtensionPoints";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import {
    TileInteractionController,
    type TileInteractionState,
    type TilePointer,
} from "../../../Phaser/Game/TileInteractionController";
import { NOT_WALKING, type WalkState } from "../domain/walk";
import { isEscapeForOpenSurface, isEscapeForTextEntry } from "./escapeClaim";
import { createSceneTileHost } from "./sceneTileHost";
import { createTileMarks } from "./tileMarks";

export interface TileInteractionExtension extends SceneExtension {
    /** Ends the walk in progress. It answers whether the player was walking. */
    cancelWalk(): boolean;
}

export interface TileInteractionOptions {
    /** Whether the office shell is on: selecting a tile and walking there by clicking the floor is part of its design. */
    readonly active: Readable<boolean>;
    /** Hands the tools whether the player walks, and what a live region says about it. */
    readonly publish: (state: WalkState) => void;
}

interface Session {
    readonly scene: GameScene;
    readonly controller: TileInteractionController;
    refresh(): void;
    /** Acts on the Escape key pressed since the last frame, if no other handler used it. */
    settleEscape(): void;
    end(): void;
}

/** The theme's accent when the room does not set a primary colour (`--secondary` in `libs/tailwind/style/konclui.css`). */
const DEFAULT_COLOR = "#53FFC8";
const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

function pointerOf(pointer: Phaser.Input.Pointer): TilePointer {
    return {
        id: pointer.id,
        x: pointer.x,
        y: pointer.y,
        button: pointer.button === LEFT_BUTTON ? "left" : pointer.button === RIGHT_BUTTON ? "right" : "other",
        touch: pointer.wasTouch,
        time: pointer.event?.timeStamp ?? 0,
    };
}

/**
 * Lets the player select a tile of the floor and walk there with a double click, and shows a walk's end to the tools.
 *
 * The controller (`Phaser/Game/TileInteractionController.ts`) holds the rules; this extension plugs it into one scene:
 * it reads the pointer and the Escape key from the scene's input (Escape ends the walk, then drops the selection, unless a menu or a dialog used the key), draws the marks on the floor and follows the walk
 * on each frame. It does nothing until the scene has created the player and the shell is on, and it takes its
 * listeners off when the scene shuts down. An interactive object under the pointer (an avatar, a piece of furniture with an action) keeps the
 * click, as it does for the scene's own handler.
 */
export function createTileInteractionExtension(options: TileInteractionOptions): TileInteractionExtension {
    let session: Session | undefined;

    // Followed from the scene's first frame to its shutdown, so the game loop reads a boolean and never opens the store.
    let active = false;
    let unfollowActive: Unsubscriber | undefined;

    function begin(scene: GameScene): Session {
        const color = Phaser.Display.Color.ValueToColor(scene.room.primaryColor ?? DEFAULT_COLOR).color;
        const marks = createTileMarks(scene, () => scene.getGameMapFrontWrapper().getTileDimensions(), color);
        const host = createSceneTileHost(scene, { isActive: () => active, paint: (next) => marks.paint(next) });
        const controller = new TileInteractionController(host, (state: TileInteractionState) =>
            options.publish({ walking: state.walking, walkStatus: state.walkStatus }),
        );
        const onDown = (pointer: Phaser.Input.Pointer): void => controller.pointerDown(pointerOf(pointer));
        const onMove = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void =>
            controller.pointerMove(pointerOf(pointer), over.length > 0);
        const onUp = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void =>
            controller.pointerUp(pointerOf(pointer), over.length > 0);
        const onOut = (): void => controller.pointerOut();
        const onCancel = (): void => controller.pointerCancel();
        // Phaser hands the key over from inside the window's own listener, before the shell's menus and dialogs have
        // seen it. Their Escape marks it handled (`preventDefault`), so the key waits for the next frame to be read.
        let escape: KeyboardEvent | undefined;
        const onEscape = (event: KeyboardEvent): void => {
            // A held key repeats: it ends the walk once, and the selection goes on a later press. A field keeps its
            // own Escape, and so does a menu that is open (it closes itself without marking the key). A button does
            // not: it keeps the focus after a click, and Escape must still end the walk then.
            if (!event.repeat && !isEscapeForTextEntry(event) && !isEscapeForOpenSurface()) escape = event;
        };
        scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
        scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
        scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
        scene.input.on(Phaser.Input.Events.GAME_OUT, onOut);
        scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onCancel);
        scene.game.events.on(Phaser.Core.Events.BLUR, onCancel);
        scene.input.keyboard?.on("keydown-ESC", onEscape);
        return {
            scene,
            controller,
            refresh: () => marks.refresh(),
            settleEscape() {
                const event = escape;
                escape = undefined;
                if (event !== undefined && !event.defaultPrevented) controller.escape();
            },
            end() {
                scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
                scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
                scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
                scene.input.off(Phaser.Input.Events.GAME_OUT, onOut);
                scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onCancel);
                scene.game.events.off(Phaser.Core.Events.BLUR, onCancel);
                scene.input.keyboard?.off("keydown-ESC", onEscape);
                escape = undefined;
                controller.dispose();
                marks.destroy();
            },
        };
    }

    return {
        id: "konclui.tileInteraction",
        onFrame(context) {
            if (context.currentPlayer === undefined) return;
            unfollowActive ??= options.active.subscribe((value) => {
                active = value;
            });
            // A room whose shell is off is left as upstream has it: nothing listens and nothing is drawn there.
            if (session === undefined && !active) return;
            if (session === undefined || session.scene !== context.scene) {
                session?.end();
                session = begin(context.scene);
            }
            session.controller.update(context.time);
            session.settleEscape();
            session.refresh();
        },
        onShutdown() {
            session?.end();
            session = undefined;
            unfollowActive?.();
            unfollowActive = undefined;
            // The next scene must not show the walk of this one.
            options.publish(NOT_WALKING);
        },
        cancelWalk: () => session?.controller.cancelWalk() ?? false,
    };
}
