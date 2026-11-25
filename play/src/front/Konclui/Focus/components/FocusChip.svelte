<script lang="ts">
    import { untrack } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { surface } from "../../../Utils/surfaceTransition";
    import type { Elapsed } from "../domain/focus";
    import { endFocus, focusChipStore, startFocus } from "../stores/focusStore";

    interface Props {
        /** Moves key focus to the control that owns the user's state, when the chip leaves while it holds the focus. */
        returnFocus?: () => void;
    }

    let { returnFocus }: Props = $props();

    // The chip above the dock for focus mode: seated, it offers focus; running, it says for how long; ended while still
    // seated, it offers the way back. Its button is the one explicit action that starts and ends a focus, so
    // focus never begins by itself. Camera, microphone and the availability status are not touched (domain/focus.ts).
    let chip = $derived($focusChipStore);
    let text = $derived($LL.konclui.focus);

    function timeText(elapsed: Elapsed): string {
        switch (elapsed.kind) {
            case "now":
                return text.justStarted();
            case "minutes":
                return text.minutes({ minutes: elapsed.minutes });
            case "hours":
                return text.hoursMinutes({ hours: elapsed.hours, minutes: String(elapsed.minutes).padStart(2, "0") });
        }
    }

    // What a screen reader is told: the phase, not the minutes, so a tick of the clock is never read out. The region is
    // always mounted: a status that appears already filled is often not announced, one filled while mounted is.
    let announcement = $derived(chip.kind === "active" ? text.active() : chip.kind === "ended" ? text.ended() : "");

    function press(event: MouseEvent): void {
        if (chip.kind === "active") endFocus();
        else startFocus();
        // A pointer click must not keep the key focus here: Space would then press this button, not the game's.
        if (event.detail > 0 && event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    }

    // The game reads Space and Enter from the page to interact with what stands next to the player: on the chip's
    // button they mean "press it" and nothing else.
    function keepKeyForButton(event: KeyboardEvent): void {
        if (event.key === " " || event.key === "Enter") event.stopPropagation();
    }

    let chipElement = $state<HTMLElement>();
    let wasShown = false;
    // The chip leaves when the user stands up or a call starts. Key focus inside it would fall back to the page.
    $effect.pre(() => {
        const shown = chip.kind !== "hidden";
        if (wasShown && !shown && untrack(() => chipElement?.contains(document.activeElement))) returnFocus?.();
        wasShown = shown;
    });
</script>

<div class="focus" data-testid="konclui-focus">
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {#if chip.kind !== "hidden"}
        <div class="chip k-chrome" bind:this={chipElement} data-testid="konclui-focus-chip" transition:surface>
            <span class="icon" aria-hidden="true">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M20 14.6A8 8 0 1 1 9.4 4a6.3 6.3 0 0 0 10.6 10.6z" />
                </svg>
            </span>
            <span class="text">
                {#if chip.kind === "active"}
                    <b class="title">
                        {text.active()} · <span role="timer" aria-live="off">{timeText(chip.elapsed)}</span>
                    </b>
                    <small class="hint">{text.activeHint()}</small>
                {:else if chip.kind === "ended"}
                    <b class="title">{text.ended()}</b>
                    <small class="hint">{text.endedHint()}</small>
                {:else}
                    <b class="title">{text.title()}</b>
                    <small class="hint">{text.offerHint()}</small>
                {/if}
            </span>
            <button class="action k-press" type="button" onclick={press} onkeydown={keepKeyForButton}>
                {chip.kind === "active" ? text.end() : chip.kind === "ended" ? text.resume() : text.start()}
            </button>
        </div>
    {/if}
</div>

<style>
    .focus {
        display: flex;
        justify-content: center;
        width: 100%;
        /* Only the chip takes clicks: the row around it lets them through to the map. */
        pointer-events: none;
    }
    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    .chip {
        display: flex;
        align-items: center;
        gap: 12px;
        /* The map zoom column (upstream ExplorerMenu) stands at the right edge of the screen: 8 px in, 56 px wide. The
           chip is centred in the dock stack, which has 8 px of padding on each side, so a cap of 100% - 128 px keeps it
           8 px short of the column on the narrowest phone, as the call indicator does. A longer sentence wraps. */
        max-width: calc(100% - 128px);
        box-sizing: border-box;
        margin-bottom: 10px;
        padding: 8px 8px 8px 16px;
        border-radius: 22px;
        color: var(--k-fg);
        pointer-events: auto;
    }
    .icon {
        display: flex;
        flex: none;
        color: var(--k-accent);
    }
    .text {
        min-width: 0;
        /* A long phrase in another language wraps inside the cap instead of running past it. */
        overflow-wrap: anywhere;
    }
    .title {
        display: block;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
        text-wrap: balance;
    }
    .hint {
        display: block;
        color: var(--k-fg-2);
        font-size: 12px;
        font-weight: 500;
        line-height: 1.5;
    }
    .action {
        position: relative;
        flex: none;
        min-height: 36px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--k-radius-pill);
        background: var(--k-elevated);
        color: var(--k-fg);
        font: inherit;
        font-size: 13px;
        font-weight: 650;
        white-space: nowrap;
        cursor: pointer;
    }
    .action:hover {
        background: var(--k-hover);
    }
    .action:focus-visible {
        outline: 2px solid var(--k-accent);
        outline-offset: 2px;
    }
    /* A finger needs 44 px: the button is 36 px tall, and its hit area reaches 4 px past it above and below. */
    .action::after {
        content: "";
        position: absolute;
        inset: -4px -2px;
    }
    /* On a phone the chip keeps the title and the button, so it stays on a line or two. */
    @media (max-width: 767px) {
        .hint {
            display: none;
        }
        .chip {
            gap: 8px;
            padding: 6px 6px 6px 12px;
        }
    }
</style>
