<script lang="ts">
    import { onDestroy } from "svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { mapEditorModeStore } from "../../Stores/MapEditorStore";
    import { cameraDetachedStore } from "../../Stores/CameraStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { BUTTON_ZOOM_FACTOR_PER_SECOND, BUTTON_ZOOM_STEP_FACTOR } from "../../Phaser/Game/CameraZoomUtils";
    import LL from "../../../i18n/i18n-svelte";
    import { gameViewportBounds } from "../../ExternalModule/ClientExtensionPoints";
    import { IconFocusCentered, IconMapSearch, IconMinus, IconPlus } from "@wa-icons";

    interface Props {
        mapEditorRightOffset?: number;
    }

    let { mapEditorRightOffset = 0 }: Props = $props();

    // An extension may draw the game in less than the window (a frame with panels and a gutter): the controls then
    // keep their 0.5rem from the game's own edge, not from the window's.
    let windowWidth = $state(window.innerWidth);
    let rightGutter = $derived(
        $gameViewportBounds ? Math.max(0, windowWidth - ($gameViewportBounds.left + $gameViewportBounds.width)) : 0,
    );

    // Keep click and long-press as the same gesture: a press always starts with one smooth zoom step,
    // then turns into continuous zoom if the user keeps the pointer down.
    const ZOOM_HOLD_DELAY = 180;

    // Track one active pointer so a second finger/button cannot start a competing zoom loop.
    let zoomHoldTimeout: ReturnType<typeof setTimeout> | undefined;
    let activeZoomPointerId: number | undefined;

    function getCameraManager() {
        return gameManager.getCurrentGameScene().getCameraManager();
    }

    function clearZoomHoldTimeout() {
        if (zoomHoldTimeout === undefined) {
            return;
        }

        clearTimeout(zoomHoldTimeout);
        zoomHoldTimeout = undefined;
    }

    function isPointerEvent(event?: Event): event is PointerEvent {
        return event !== undefined && "pointerId" in event;
    }

    // Keyboard presses share the pointer gesture state; -1 is the pointer id the spec reserves for non-pointer input.
    const KEYBOARD_ZOOM_ID = -1;

    /**
     * Starts the zoom gesture for mouse, touch, and stylus.
     */
    function startZoom(direction: "in" | "out", event: PointerEvent) {
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }

        event.preventDefault();
        beginZoom(direction, event.pointerId);
    }

    /**
     * Keyboard equivalent of press-and-hold: Enter or Space use the button's direction, + and - pick one explicitly.
     * Holding the key keeps zooming until keyup, like holding the pointer.
     */
    function startKeyboardZoom(direction: "in" | "out", event: KeyboardEvent) {
        const keyDirection = getKeyboardZoomDirection(direction, event.key);
        if (keyDirection === undefined) {
            return;
        }

        event.preventDefault();
        if (event.repeat) {
            return;
        }
        beginZoom(keyDirection, KEYBOARD_ZOOM_ID);
    }

    function stopKeyboardZoom(event: KeyboardEvent) {
        if (getKeyboardZoomDirection("in", event.key) === undefined) {
            return;
        }

        event.preventDefault();
        stopZoom();
    }

    function getKeyboardZoomDirection(direction: "in" | "out", key: string): "in" | "out" | undefined {
        if (key === "Enter" || key === " ") {
            return direction;
        }
        if (key === "+" || key === "=") {
            return "in";
        }
        if (key === "-") {
            return "out";
        }
        return undefined;
    }

    /**
     * Analytics is emitted once here so a long press does not create one event per animation frame.
     */
    function beginZoom(direction: "in" | "out", gestureId: number) {
        if (activeZoomPointerId !== undefined) {
            return;
        }

        activeZoomPointerId = gestureId;
        const cameraManager = gameManager.getCurrentGameScene().getCameraManager();
        const zoomFactor = direction === "in" ? BUTTON_ZOOM_STEP_FACTOR : 1 / BUTTON_ZOOM_STEP_FACTOR;
        const continuousZoomFactor =
            direction === "in" ? BUTTON_ZOOM_FACTOR_PER_SECOND : 1 / BUTTON_ZOOM_FACTOR_PER_SECOND;

        if (direction === "in") {
            analyticsClient.trackAdminEvent("map_explorer.zoom_in_clicked");
        } else {
            analyticsClient.trackAdminEvent("map_explorer.zoom_out_clicked");
        }

        cameraManager?.smoothZoomByFactor(zoomFactor);

        // If the pointer is still down after the delay, the same gesture becomes continuous zoom.
        clearZoomHoldTimeout();
        zoomHoldTimeout = setTimeout(() => {
            if (activeZoomPointerId === gestureId) {
                getCameraManager()?.startContinuousZoom(continuousZoomFactor);
            }
        }, ZOOM_HOLD_DELAY);
    }

    /**
     * Stops the gesture from all exit paths: release, cancel, leaving the button, window blur, or component destroy.
     */
    function stopZoom(event?: Event) {
        if (isPointerEvent(event) && activeZoomPointerId !== undefined && activeZoomPointerId !== event.pointerId) {
            return;
        }

        const hadActiveZoom = activeZoomPointerId !== undefined || zoomHoldTimeout !== undefined;
        clearZoomHoldTimeout();
        activeZoomPointerId = undefined;
        if (hadActiveZoom) {
            getCameraManager()?.stopContinuousZoom();
        }
    }

    function openMapExplorer() {
        analyticsClient.trackAdminEvent("map_explorer.top_button_clicked");

        mapEditorModeStore.switchMode(true);
        gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.ExploreTheRoom);
    }

    function centerToUser() {
        analyticsClient.trackAdminEvent("map_explorer.center_to_user_clicked");

        const scene = gameManager.getCurrentGameScene();
        // In the map editor, bring the view back to the avatar and stay in the editor.
        if ($mapEditorModeStore) scene.getCameraManager().centerCameraOn(scene.CurrentPlayer);
        else getCameraManager()?.resumePlayerFollow();
    }

    onDestroy(() => {
        stopZoom();
    });
</script>

<svelte:window onblur={stopZoom} bind:innerWidth={windowWidth} />

<div
    class="fixed bottom-2 mobile:bottom-24 k-chrome rounded-lg pointer-events-auto p-1.5"
    style:right={`calc(${mapEditorRightOffset + rightGutter}px + 0.5rem)`}
    data-testid="actions-explorer"
>
    <div class="k-control-column flex flex-col justify-center gap-1.5">
        <div class="flex flex-col justify-center gap-1.5">
            <button
                type="button"
                aria-label={$LL.mapEditor.explorer.zoomIn()}
                class="group k-control"
                onpointerdown={(event) => startZoom("in", event)}
                onpointerup={stopZoom}
                onpointercancel={stopZoom}
                onpointerleave={stopZoom}
                onkeydown={(event) => startKeyboardZoom("in", event)}
                onkeyup={stopKeyboardZoom}
                onblur={() => stopZoom()}
            >
                <IconPlus aria-hidden="true" />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-100 group-hover:right-11 group-focus-visible:opacity-100 group-focus-visible:right-11 absolute bg-contrast/90 text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.zoomIn()}
                </div>
            </button>
            <button
                type="button"
                aria-label={$LL.mapEditor.explorer.zoomOut()}
                class="group k-control"
                onpointerdown={(event) => startZoom("out", event)}
                onpointerup={stopZoom}
                onpointercancel={stopZoom}
                onpointerleave={stopZoom}
                onkeydown={(event) => startKeyboardZoom("out", event)}
                onkeyup={stopKeyboardZoom}
                onblur={() => stopZoom()}
            >
                <IconMinus aria-hidden="true" />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-100 group-hover:right-11 group-focus-visible:opacity-100 group-focus-visible:right-11 absolute bg-contrast/90 text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.zoomOut()}
                </div>
            </button>
        </div>
        {#if !$mapEditorModeStore && !$cameraDetachedStore}
            <button
                type="button"
                aria-label={$LL.mapEditor.explorer.title()}
                class="group k-control"
                onclick={openMapExplorer}
            >
                <IconMapSearch aria-hidden="true" />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-100 group-hover:right-11 group-focus-visible:opacity-100 group-focus-visible:right-11 absolute bg-contrast/90 text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.title()}
                </div>
            </button>
        {:else}
            <button
                type="button"
                aria-label={$LL.mapEditor.explorer.showMyLocation()}
                data-testid="center-camera-on-player"
                class="group k-control"
                onclick={centerToUser}
            >
                <IconFocusCentered aria-hidden="true" />
                <div
                    class="-right-60 opacity-0 group-hover:opacity-100 group-hover:right-11 group-focus-visible:opacity-100 group-focus-visible:right-11 absolute bg-contrast/90 text-sm px-2 py-1 rounded whitespace-nowrap transition-all text-white pointer-events-none select-none"
                >
                    {$LL.mapEditor.explorer.showMyLocation()}
                </div>
            </button>
        {/if}
    </div>
</div>
