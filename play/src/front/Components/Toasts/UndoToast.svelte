<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import ToastContainer from "./ToastContainer.svelte";

    interface Props {
        toastUuid: string;
        /** What just happened, naming what and who. */
        message: string;
        /** The specific verb of the way back, e.g. "Unblock". */
        actionLabel: string;
        onAction: () => void;
        duration?: number;
    }

    let { toastUuid, message, actionLabel, onAction, duration = 10000 }: Props = $props();

    let wrapper: HTMLDivElement | undefined = $state();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let remaining = 0;
    let startedAt = 0;

    function closeToast(): void {
        toastStore.removeToast(toastUuid);
    }

    // The way back must not vanish while someone reaches for it: the countdown pauses under the pointer and
    // while the focus is inside (WCAG 2.2.1).
    function pause(): void {
        if (timeout === undefined) return;
        clearTimeout(timeout);
        timeout = undefined;
        remaining -= Date.now() - startedAt;
    }

    function resume(): void {
        if (timeout !== undefined) return;
        startedAt = Date.now();
        timeout = setTimeout(closeToast, Math.max(remaining, 1000));
    }

    let isHovered = false;
    let hasFocusInside = false;

    // The countdown only resumes once neither the pointer nor the keyboard focus is inside.
    function updatePause(): void {
        if (isHovered || hasFocusInside) {
            pause();
        } else {
            resume();
        }
    }

    function onPointerEnter(): void {
        isHovered = true;
        updatePause();
    }

    function onPointerLeave(): void {
        isHovered = false;
        updatePause();
    }

    function onFocusIn(): void {
        hasFocusInside = true;
        updatePause();
    }

    function onFocusOut(event: FocusEvent): void {
        if (event.relatedTarget instanceof Node && wrapper?.contains(event.relatedTarget)) return;
        hasFocusInside = false;
        updatePause();
    }

    onMount(() => {
        remaining = duration;
        resume();
        const element = wrapper;
        if (!element) return;
        element.addEventListener("pointerenter", onPointerEnter);
        element.addEventListener("pointerleave", onPointerLeave);
        element.addEventListener("focusin", onFocusIn);
        element.addEventListener("focusout", onFocusOut);
        return () => {
            element.removeEventListener("pointerenter", onPointerEnter);
            element.removeEventListener("pointerleave", onPointerLeave);
            element.removeEventListener("focusin", onFocusIn);
            element.removeEventListener("focusout", onFocusOut);
        };
    });

    onDestroy(() => {
        clearTimeout(timeout);
    });
</script>

<div bind:this={wrapper} data-testid="undo-toast">
    <ToastContainer extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" theme="secondary" {toastUuid}>
        <span>{message}</span>
        {#snippet buttons()}
            <button
                type="button"
                class="btn btn-light btn-sm flex-1 cursor-pointer"
                data-testid="undo-toast-action"
                onclick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    closeToast();
                    onAction();
                }}
            >
                {actionLabel}
            </button>
        {/snippet}
    </ToastContainer>
</div>
