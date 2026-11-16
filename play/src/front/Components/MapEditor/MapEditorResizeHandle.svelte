<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";

    interface Props {
        minWidth: number;
        maxWidth: number;
        currentWidth: number;
        onResize: (width: number) => void;
    }

    let { minWidth, maxWidth, currentWidth, onResize }: Props = $props();

    let dragHandle: HTMLElement;

    let isDragging = false;
    let startX: number;
    let startWidth: number;

    const startDragging = (e: MouseEvent | TouchEvent) => {
        isDragging = true;
        startX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
        startWidth = currentWidth;

        document.addEventListener("mousemove", handleDragging, { passive: true });
        document.addEventListener("mouseup", stopDragging, { passive: true });
        document.addEventListener("touchmove", handleDragging, { passive: true });
        document.addEventListener("touchend", stopDragging, { passive: true });
    };

    function handleDragging(e: MouseEvent | TouchEvent) {
        if (!isDragging) return;

        const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
        let deltaX = startX - clientX;
        if (document.documentElement.dir === "rtl") {
            deltaX = -deltaX;
        }
        const newWidth = startWidth + deltaX;
        onResize(Math.min(Math.max(newWidth, minWidth), maxWidth));
    }

    const KEYBOARD_STEP = 16;

    // Keyboard alternative to dragging. The panel grows towards the start of the screen, like the drag does.
    function handleKeyDown(e: KeyboardEvent) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const growKey = document.documentElement.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
        const delta = e.key === growKey ? KEYBOARD_STEP : -KEYBOARD_STEP;
        onResize(Math.min(Math.max(currentWidth + delta, minWidth), maxWidth));
    }

    function stopDragging() {
        isDragging = false;
        document.removeEventListener("mousemove", handleDragging);
        document.removeEventListener("mouseup", stopDragging);
        document.removeEventListener("touchmove", handleDragging);
        document.removeEventListener("touchend", stopDragging);
    }

    onMount(() => {
        dragHandle.addEventListener("mousedown", startDragging, { passive: true });
        dragHandle.addEventListener("touchstart", startDragging, { passive: true });
    });

    onDestroy(() => {
        document.removeEventListener("mousemove", handleDragging);
        document.removeEventListener("mouseup", stopDragging);
        document.removeEventListener("touchmove", handleDragging);
        document.removeEventListener("touchend", stopDragging);

        dragHandle.removeEventListener("mousedown", startDragging);
        dragHandle.removeEventListener("touchstart", startDragging);
    });
</script>

<!-- A focusable separator is the WAI-ARIA window splitter, an interactive widget Svelte sees as a structure role. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
    bind:this={dragHandle}
    role="separator"
    aria-orientation="vertical"
    aria-label={$LL.a11y.mapEditorResizePanel()}
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    aria-valuenow={Math.round(currentWidth)}
    tabindex="0"
    onkeydown={handleKeyDown}
    class="relative drag-handle my-auto mr-3 w-1 h-20 outline outline-4 outline-contrast focus-visible:outline-secondary-300 bg-white cursor-col-resize transition-colors rounded-lg select-none"
></div>

<style>
    .drag-handle {
        pointer-events: auto;
    }

    /* We make the drag handle bigger than it really is to make it more easily selectable (especially on mobile) */
    .drag-handle:after {
        content: "";
        position: absolute;
        top: -20px;
        inset-inline-start: -20px;
        width: 45px;
        height: 122px;
        /*background-color: rgba(255, 0, 0, 0.5);*/
        border-radius: 4px;
    }
</style>
