<script lang="ts">
    import type { Snippet } from "svelte";
    import { onDestroy, onMount } from "svelte";
    import { fly } from "../../Utils/reducedMotion";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconX } from "@wa-icons";

    interface Props {
        extraClasses: string;
        duration?: number;
        toastUuid?: string;
        theme: "success" | "error" | "secondary";
        /** Replaces the default close action (removing the toast) for toasts whose dismissal has side effects. */
        onClose?: () => void;
        children?: Snippet;
        buttons?: Snippet;
    }

    let {
        extraClasses = "",
        duration = undefined,
        toastUuid = undefined,
        theme = "success",
        onClose = undefined,
        children,
        buttons,
    }: Props = $props();

    // An error must stay long enough to be read: short durations set by callers are raised to this floor.
    const ERROR_MIN_DURATION_MS = 10000;

    let effectiveDuration = $derived(
        duration !== undefined && theme === "error" ? Math.max(duration, ERROR_MIN_DURATION_MS) : duration,
    );
    let canClose = $derived(onClose !== undefined || (toastUuid !== undefined && toastUuid !== ""));

    let toastElement: HTMLDivElement | undefined = $state(undefined);
    let isHovered = false;
    let hasFocusInside = false;
    let isTimerPaused = $state(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let remainingMs = 0;
    let timerStartedAt = 0;

    function closeToast(): void {
        if (onClose !== undefined) {
            onClose();
            return;
        }
        if (toastUuid !== undefined && toastUuid !== "") {
            toastStore.removeToast(toastUuid);
        }
    }

    function startTimer(theToastUuid: string): void {
        timerStartedAt = Date.now();
        timeout = setTimeout(() => {
            toastStore.removeToast(theToastUuid);
        }, remainingMs);
    }

    function pauseTimer(): void {
        if (timeout === undefined) return;
        clearTimeout(timeout);
        timeout = undefined;
        remainingMs = Math.max(0, remainingMs - (Date.now() - timerStartedAt));
    }

    // Hover or keyboard focus inside the toast holds the auto-dismiss, so it is never removed while being read.
    function updateTimerPause(): void {
        if (toastUuid === undefined) return;
        const shouldPause = isHovered || hasFocusInside;
        isTimerPaused = shouldPause;
        if (shouldPause) {
            pauseTimer();
        } else if (timeout === undefined) {
            startTimer(toastUuid);
        }
    }

    function onPointerEnter(): void {
        isHovered = true;
        updateTimerPause();
    }

    function onPointerLeave(): void {
        isHovered = false;
        updateTimerPause();
    }

    function onFocusIn(): void {
        hasFocusInside = true;
        updateTimerPause();
    }

    function onFocusOut(event: FocusEvent): void {
        if (toastElement && event.relatedTarget instanceof Node && toastElement.contains(event.relatedTarget)) return;
        hasFocusInside = false;
        updateTimerPause();
    }

    onMount(() => {
        if (duration !== undefined && toastUuid === undefined) {
            throw new Error("ToastContainer: if duration is set, toastUuid must be defined");
        }

        if (effectiveDuration !== undefined && toastUuid !== undefined && toastElement !== undefined) {
            const theToastUuid = toastUuid;
            remainingMs = effectiveDuration;
            startTimer(theToastUuid);

            // Only a running timer is held by hover and focus, so the listeners exist only with it.
            const element = toastElement;
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
        }
        return undefined;
    });

    onDestroy(() => {
        clearTimeout(timeout);
    });
</script>

<div class="toast-container flex flex-row flex-nowrap items-stretch gap-1" bind:this={toastElement}>
    <div
        class="w-2 rounded-lg my-3"
        class:bg-danger={theme === "error"}
        class:bg-success={theme === "success"}
        class:bg-secondary={theme === "secondary"}
    ></div>
    <div
        class="bg-contrast/95 flex flex-col backdrop-blur-md text-white min-w-60 min-h-12 rounded-lg overflow-hidden transition-all responsive z-20 {extraClasses}"
        transition:fly={{ x: 900, duration: 500 }}
    >
        <!-- Progress bar -->
        {#if effectiveDuration !== undefined}
            <div class="progress-bar-container" class:success={theme === "success"} class:error={theme === "error"}>
                <div
                    class="progress-bar"
                    class:success={theme === "success"}
                    class:error={theme === "error"}
                    class:secondary={theme === "secondary"}
                    style="animation-duration: {effectiveDuration}ms; animation-play-state: {isTimerPaused
                        ? 'paused'
                        : 'running'};"
                ></div>
            </div>
        {/if}

        <div class="flex items-center gap-2 p-4 pointer-events-auto justify-center grow">
            <!-- Only the message is the live region: the close button must not be read as part of it. -->
            <div class="text-center leading-6 responsive-message grow" role={theme === "error" ? "alert" : "status"}>
                {@render children?.()}
            </div>
            {#if canClose}
                <button
                    type="button"
                    class="hit-area-lg m-0 -my-2 -me-2 p-0 h-8 w-8 shrink-0 self-start flex items-center justify-center rounded bg-transparent text-white/80 hover:bg-white/10 hover:text-white cursor-pointer"
                    aria-label={$LL.notification.closeToast()}
                    title={$LL.notification.closeToast()}
                    data-testid="toast-close-button"
                    onclick={(event) => {
                        event.stopPropagation();
                        closeToast();
                    }}
                >
                    <IconX font-size="1.125rem" aria-hidden="true" />
                </button>
            {/if}
        </div>
        {#if buttons}
            <!-- Design-system secondary hover (4.0:1) and danger label (3.1:1) fail 4.5: darker hover, dark label. -->
            <div
                class="buttons-wrapper flex items-center justify-center p-2 space-x-2 bg-contrast/60 pointer-events-auto [&_.btn-secondary:hover:enabled]:bg-secondary-800 [&_.btn-danger]:text-contrast-900 [&_.btn-danger_.btn-label]:text-contrast-900"
            >
                {@render buttons()}
            </div>
        {/if}
    </div>
</div>

<style>
    .progress-bar-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 3px;
        overflow: hidden;
    }

    .progress-bar-container.success {
        background: rgba(34, 197, 94, 0.1);
    }

    .progress-bar-container.error {
        background: rgba(239, 68, 68, 0.1);
    }

    .progress-bar {
        height: 100%;
        transform-origin: left center;
        animation-name: progress-fill;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
        will-change: transform;
    }

    .progress-bar.success {
        background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
    }

    .progress-bar.error {
        background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
        transition: width 0.05s linear;
    }

    .progress-bar.secondary {
        background: hsl(var(--secondary));
        transition: width 0.05s linear;
    }

    @keyframes progress-fill {
        from {
            transform: scaleX(0);
        }
        to {
            transform: scaleX(1);
        }
    }

    /* The countdown bar shows the time left. Without motion it would sit full from the start, so it is hidden. */
    @media (prefers-reduced-motion: reduce) {
        .progress-bar-container {
            display: none;
        }
    }
</style>
