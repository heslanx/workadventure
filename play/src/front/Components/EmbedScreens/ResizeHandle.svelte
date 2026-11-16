<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";

    interface Props {
        minHeight: number;
        maxHeight: number;
        onResize: (height: number) => void;
        onResizeEnd: () => void;
        dataTestid: string;
    }

    let { minHeight, maxHeight, onResize, onResizeEnd = () => {}, dataTestid = "resize-handle" }: Props = $props();

    let dragHandle: HTMLElement;
    let parentElement: HTMLElement;

    let isDragging = false;
    let startY: number;
    let startParentHeight: number;
    // Height currently reported to the screen readers (see aria-valuenow); read from the layout on focus.
    let currentHeight: number | undefined = $state();

    const startDragging = (e: MouseEvent | TouchEvent) => {
        isDragging = true;
        startY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
        parentElement = dragHandle.parentElement as HTMLElement;
        startParentHeight = dragHandle.offsetTop - parentElement.offsetTop;

        document.addEventListener("mousemove", handleDragging, { passive: true });
        document.addEventListener("mouseup", stopDragging, { passive: true });
        document.addEventListener("touchmove", handleDragging, { passive: true });
        document.addEventListener("touchend", stopDragging, { passive: true });
    };

    function handleDragging(e: MouseEvent | TouchEvent) {
        if (!isDragging) return;

        const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
        const deltaY = clientY - startY;
        const newHeight = startParentHeight + deltaY;
        currentHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);
        onResize(currentHeight);
    }

    function stopDragging() {
        isDragging = false;
        document.removeEventListener("mousemove", handleDragging);
        document.removeEventListener("mouseup", stopDragging);
        document.removeEventListener("touchmove", handleDragging);
        document.removeEventListener("touchend", stopDragging);
        onResizeEnd();
    }

    // Keyboard alternative to dragging the handle (WAI-ARIA window splitter): each arrow press moves it 5%.
    const KEYBOARD_RESIZE_STEP = 0.05;
    let isKeyboardResizing = false;

    function readHeightFromLayout(): number {
        return dragHandle.offsetTop - (dragHandle.parentElement as HTMLElement).offsetTop;
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
        }
        event.preventDefault();
        const step = (maxHeight - minHeight) * KEYBOARD_RESIZE_STEP;
        const newHeight = readHeightFromLayout() + (event.key === "ArrowDown" ? step : -step);
        isKeyboardResizing = true;
        currentHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);
        onResize(currentHeight);
    }

    function handleKeyup(event: KeyboardEvent) {
        if (!isKeyboardResizing || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
            return;
        }
        isKeyboardResizing = false;
        onResizeEnd();
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

<!-- A focusable separator is the WAI-ARIA window splitter pattern, which Svelte's a11y rules don't know. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
    bind:this={dragHandle}
    data-testid={dataTestid}
    role="separator"
    tabindex="0"
    aria-orientation="horizontal"
    aria-label={$LL.a11y.compResizeCameras()}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round((((currentHeight ?? minHeight) - minHeight) / (maxHeight - minHeight || 1)) * 100)}
    onfocus={() => (currentHeight = Math.min(Math.max(readHeightFromLayout(), minHeight), maxHeight))}
    onkeydown={handleKeydown}
    onkeyup={handleKeyup}
    class="group/resize-handle relative drag-handle mx-auto mt-3 w-40 h-1 outline outline-4 outline-contrast bg-white cursor-ns-resize transition-colors rounded-lg select-none focus-visible:outline-secondary-300"
>
    <div
        class="absolute bottom-0 bg-contrast/80 backdrop-blur-xl p-2 px-4 rounded-md pointer-events-none w-fit left-1/2 -translate-x-1/2 group-active/resize-handle:opacity-0 group-hover/resize-handle:-translate-y-4 group-hover/resize-handle:opacity-100 opacity-0 transition-all duration-300 z-20 select-none"
    >
        <p class="text-white text-sm text-center whitespace-nowrap m-0 p-0 select-none">
            {$LL.video.click_and_drag_to_resize()}
        </p>
    </div>
</div>

<style>
    .drag-handle {
        pointer-events: auto;
    }

    /* We make the drag handle bigger than it really is to make it more easily selectable (especially on mobile) */
    .drag-handle:after {
        content: "";
        position: absolute;
        top: -20px;
        left: -20px;
        width: 122px;
        height: 45px;
        /*background-color: rgba(255, 0, 0, 0.5);*/
        border-radius: 4px;
    }
</style>
