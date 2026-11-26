<script lang="ts">
    import { onMount, type Component } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { glide } from "../../../Utils/glide";
    import { surface } from "../../../Utils/surfaceTransition";
    import { paneAfter, PANES, type PaneId } from "../domain/panes";
    import { closePreferences, preferencesStore, showPane } from "../stores/preferencesStore";
    import GeneralPane from "./GeneralPane.svelte";
    import MediaPane from "./MediaPane.svelte";
    import MiniPane from "./MiniPane.svelte";
    import NotificationsPane from "./NotificationsPane.svelte";
    import PerformancePane from "./PerformancePane.svelte";
    import ProfilePane from "./ProfilePane.svelte";
    import ShortcutsPane from "./ShortcutsPane.svelte";
    import SoundsPane from "./SoundsPane.svelte";
    import {
        IconAdjustements,
        IconAppWindow,
        IconBell,
        IconCamera,
        IconHeadphones,
        IconKey,
        IconSettings,
        IconUserEdit,
        IconX,
    } from "@wa-icons";

    // The preferences, in one dialog over the dimmed office (owner, 19/10/2026: the source's settings): the sections
    // on the left, one section on the right; Esc, the close button or a press outside close it.
    // The box carries upstream's `block-user-action`: while the focus is inside it, upstream's form-focus tracking
    // (trackFormFocus in MainLayout.svelte) holds the game's keys, so no arrow, letter or Space moves the player.

    interface Props {
        pane: PaneId;
    }

    let { pane }: Props = $props();
    const id = $props.id();
    let box: HTMLDivElement | undefined = $state();
    let tabs: Partial<Record<PaneId, HTMLButtonElement>> = $state({});
    // On a phone the sections are a row (the max-width block of the style below).
    const narrow = new MediaQuery("max-width: 720px");

    const icons: Record<PaneId, Component> = {
        general: IconSettings,
        media: IconCamera,
        sounds: IconHeadphones,
        notifications: IconBell,
        mini: IconAppWindow,
        performance: IconAdjustements,
        shortcuts: IconKey,
        profile: IconUserEdit,
    };

    let t = $derived($LL.konclui.preferences);
    let titles = $derived<Record<PaneId, string>>({
        general: t.panes.general(),
        media: t.panes.media(),
        sounds: t.panes.sounds(),
        notifications: t.panes.notifications(),
        mini: t.panes.mini(),
        performance: t.panes.performance(),
        shortcuts: t.panes.shortcuts(),
        profile: t.panes.profile(),
    });

    onMount(focusTab);

    /**
     * Puts the focus on the tab of the section that is shown. The dialog does it when it is mounted, and the host does
     * it when the dialog is opened again during its exit: the dialog is then the same one, still mounted, and its own
     * effects are paused for the length of the exit, so it cannot see the store say "open" again.
     */
    export function focusTab(): void {
        tabs[pane]?.focus();
    }

    function tabKeydown(event: KeyboardEvent, current: PaneId): void {
        const next = paneAfter(current, event.key);
        if (next === undefined) return;
        event.preventDefault();
        showPane(next);
        tabs[next]?.focus();
    }

    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    /**
     * Keeps Tab inside the dialog: from the last control it goes back to the first, and the reverse. From anywhere
     * else (the box itself after a click on its text, or the page after a control vanished) it enters at an end.
     */
    function keepFocusInside(event: KeyboardEvent): void {
        const focusable = [...(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
            (element) => element.tabIndex >= 0,
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first === undefined || last === undefined) return;
        const active = document.activeElement;
        const outside = !focusable.some((element) => element === active);
        if (event.shiftKey && (outside || active === first)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (outside || active === last)) {
            event.preventDefault();
            first.focus();
        }
    }

    function keydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closePreferences();
        } else if (event.key === "Tab") {
            keepFocusInside(event);
        }
    }

    /**
     * Esc and Tab while the focus is outside the box, such as on the page after a focused control vanished. The
     * dialog stays on the page for the length of its exit, and the keys of that time are the page's again: the focus
     * went back to the control that opened it, and a Tab there must not be taken to enter an inert box.
     */
    function pageKeydown(event: KeyboardEvent): void {
        if (!get(preferencesStore).open) return;
        if (event.target instanceof Node && box?.contains(event.target)) return;
        keydown(event);
    }
</script>

<svelte:window onkeydown={pageKeydown} />

<!-- The scrim is what takes the press outside the dialog, and it carries no transition: while the dialog leaves, its
     box and its dimming are inert (Svelte sets that on an element that is leaving), and a press on them would fall
     through to the game. The scrim stays under them, whole and not inert, until both have gone. -->
<div
    class="k-prefs-scrim"
    role="presentation"
    onpointerdown={(event) => {
        if (event.target === event.currentTarget) closePreferences();
    }}
>
    <div class="k-prefs-dim" aria-hidden="true" transition:surface={{ x: 0, y: 0, scale: 1 }}></div>
    <div
        bind:this={box}
        class="k-prefs block-user-action"
        role="dialog"
        aria-modal="true"
        aria-label={t.dialog()}
        tabindex="-1"
        transition:surface
        onkeydown={keydown}
    >
        <nav class="k-prefs-nav" aria-label={t.sections()}>
            <div
                class="k-prefs-tabs k-glide"
                role="tablist"
                aria-orientation={narrow.current ? "horizontal" : "vertical"}
                aria-label={t.sections()}
                {@attach glide({ item: '[role="tab"]' })}
            >
                {#each PANES as entry, index (entry.id)}
                    {@const Icon = icons[entry.id]}
                    {#if index === 0 || PANES[index - 1].group !== entry.group}
                        <span class="k-prefs-group" aria-hidden="true">
                            {entry.group === "you" ? t.you() : t.title()}
                        </span>
                    {/if}
                    <button
                        bind:this={tabs[entry.id]}
                        id="{id}-tab-{entry.id}"
                        type="button"
                        class="k-press"
                        role="tab"
                        aria-selected={entry.id === pane}
                        aria-controls="{id}-panel"
                        tabindex={entry.id === pane ? 0 : -1}
                        onclick={() => showPane(entry.id)}
                        onkeydown={(event) => tabKeydown(event, entry.id)}
                    >
                        <Icon font-size="18" aria-hidden="true" />
                        <span>{titles[entry.id]}</span>
                    </button>
                {/each}
            </div>
        </nav>
        <section class="k-prefs-body">
            <header class="k-prefs-head">
                <h2>{titles[pane]}</h2>
                <button
                    type="button"
                    class="k-prefs-close k-press"
                    aria-label={t.close()}
                    title={t.close()}
                    onclick={closePreferences}
                >
                    <IconX font-size="20" aria-hidden="true" />
                </button>
            </header>
            <div class="k-prefs-pane" id="{id}-panel" role="tabpanel" aria-labelledby="{id}-tab-{pane}">
                {#if pane === "general"}
                    <GeneralPane />
                {:else if pane === "media"}
                    <MediaPane />
                {:else if pane === "sounds"}
                    <SoundsPane />
                {:else if pane === "notifications"}
                    <NotificationsPane />
                {:else if pane === "mini"}
                    <MiniPane />
                {:else if pane === "performance"}
                    <PerformancePane />
                {:else if pane === "shortcuts"}
                    <ShortcutsPane />
                {:else}
                    <ProfilePane />
                {/if}
            </div>
        </section>
    </div>
</div>

<style>
    /* The dialog: theme.css section 8 and the source's moment-hud.css .kmh-set-*, on the platform tokens. */
    .k-prefs-scrim {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: Urbanist, system-ui, sans-serif;
        color: var(--k-fg);
    }
    /* Dimmed, never blurred: the theme bans blur over the map. It is its own element so that it can fade on its own
       transition while the scrim around it stays; under the box, in the scrim's own stacking context. */
    .k-prefs-dim {
        position: absolute;
        inset: 0;
        z-index: -1;
        /* A press on it is a press on the scrim, which closes the dialog: the scrim must be what the pointer reaches. */
        pointer-events: none;
        background: rgb(3 5 26 / 0.62);
    }
    .k-prefs {
        display: grid;
        grid-template-columns: 232px minmax(0, 1fr);
        width: min(880px, 100%);
        height: min(640px, 100%);
        overflow: hidden;
        border: 1px solid var(--k-border);
        border-radius: var(--k-radius-surface);
        background: var(--k-card);
        box-shadow: var(--k-shadow);
        outline: none;
    }
    .k-prefs-nav {
        overflow: auto;
        padding: 16px 10px;
        background: var(--k-page);
        border-right: 1px solid var(--k-border);
    }
    .k-prefs-tabs {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .k-prefs-group {
        margin: 12px 0 6px;
        padding: 0 10px;
        font:
            500 12px/1.5 Urbanist,
            system-ui,
            sans-serif;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--k-fg-muted);
    }
    .k-prefs-group:first-child {
        margin-top: 0;
    }
    [role="tab"] {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 40px;
        padding: 9px 10px;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        font:
            500 14px/1.3 Urbanist,
            system-ui,
            sans-serif;
        text-align: start;
        color: var(--k-fg-2);
        cursor: pointer;
    }
    [role="tab"]:hover {
        background: var(--k-hover);
        color: var(--k-fg);
    }
    /* While the pill exists (`.k-glide-on`, set by the attachment) it is the hover fill of the tabs that are not the
       selected one, which keeps its own. Without it (a touch screen) every tab keeps the fill above. */
    @media (hover: hover) {
        .k-prefs-tabs:global(.k-glide-on) [role="tab"]:hover:not([aria-selected="true"]) {
            background: transparent;
        }
    }
    [role="tab"][aria-selected="true"] {
        background: var(--k-elevated);
        color: var(--k-accent);
    }
    .k-prefs-body {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
    }
    .k-prefs-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 20px;
        border-bottom: 1px solid var(--k-border);
    }
    .k-prefs-head h2 {
        margin: 0;
        text-transform: none;
        letter-spacing: normal;
        font:
            700 20px/1.25 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg);
    }
    .k-prefs-close {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        color: var(--k-fg-2);
        cursor: pointer;
    }
    .k-prefs-close:hover {
        background: var(--k-hover);
        color: var(--k-fg);
    }
    .k-prefs-pane {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        padding: 20px;
        overflow: auto;
        overscroll-behavior: contain;
    }
    .k-prefs :global(:focus-visible) {
        outline: 2px solid var(--k-accent);
        outline-offset: 2px;
    }

    /* The rows of every section (Pref*.svelte and the panes). */
    .k-prefs :global(.k-pref-lead) {
        margin: 0 0 8px;
        font:
            500 14px/1.5 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-note) {
        margin: 0;
        padding: 0 4px;
        font:
            500 13px/1.4 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-block) {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .k-prefs :global(.k-pref-block + .k-pref-block) {
        margin-top: 10px;
    }
    .k-prefs :global(.k-pref-section) {
        margin: 6px 0 0;
        padding: 0 4px;
        font:
            600 12px/1.5 Urbanist,
            system-ui,
            sans-serif;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-group) {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--k-border);
        border-radius: var(--k-radius-menu);
        background: var(--k-elevated);
    }
    .k-prefs :global(.k-pref-group > * + *) {
        border-top: 1px solid var(--k-border);
    }
    .k-prefs :global(.k-pref-item) {
        display: flex;
        align-items: center;
        gap: 16px;
        min-height: 56px;
        padding: 10px 14px;
    }
    .k-prefs :global(.k-pref-stack) {
        flex-wrap: wrap;
        row-gap: 10px;
    }
    .k-prefs :global(.k-pref-stack > .k-pref-text) {
        flex-basis: 220px;
    }
    .k-prefs :global(.k-pref-text) {
        flex: 1;
        min-width: 0;
    }
    .k-prefs :global(.k-pref-text b) {
        display: block;
        font:
            600 14px/1.3 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg);
    }
    .k-prefs :global(.k-pref-text small) {
        display: block;
        margin-top: 2px;
        font:
            500 13px/1.4 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-text small.k-pref-error),
    .k-prefs :global(.k-pref-text small.k-pref-warning) {
        color: var(--k-danger-text);
    }
    .k-prefs :global(.k-pref-row) {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        padding: 10px 14px;
        border: 0;
        background: transparent;
        text-align: start;
        text-decoration: none;
        color: var(--k-fg);
        cursor: pointer;
    }
    .k-prefs :global(.k-pref-row:hover) {
        background: var(--k-hover);
    }
    .k-prefs :global(.k-pref-row[aria-disabled="true"]) {
        cursor: not-allowed;
    }
    .k-prefs :global(.k-pref-row[aria-disabled="true"]:hover) {
        background: transparent;
    }
    .k-prefs :global(.k-pref-row > svg) {
        flex: none;
        color: var(--k-fg-muted);
    }
    .k-prefs :global(.k-pref-row.danger b) {
        color: var(--k-danger-text);
    }
    /* a row on its own, outside a group, is a card of its own */
    .k-prefs :global(.k-prefs-pane > .k-pref-row) {
        border: 1px solid var(--k-border);
        border-radius: var(--k-radius-menu);
        background: var(--k-elevated);
    }
    .k-prefs :global(.k-pref-group > .k-pref-row:first-child) {
        border-radius: var(--k-radius-menu) var(--k-radius-menu) 0 0;
    }
    .k-prefs :global(.k-pref-group > .k-pref-row:last-child) {
        border-radius: 0 0 var(--k-radius-menu) var(--k-radius-menu);
    }
    .k-prefs :global(.k-pref-group > .k-pref-row:only-child) {
        border-radius: var(--k-radius-menu);
    }
    .k-prefs :global(.k-pref-switch) {
        position: relative;
        flex: none;
        width: 40px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: var(--k-radius-pill);
        background: var(--k-border-strong);
        cursor: pointer;
        transition: background-color var(--k-dur-normal) var(--k-ease-out-expo);
    }
    .k-prefs :global(.k-pref-switch > i) {
        position: absolute;
        left: 3px;
        top: 3px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        transition:
            translate var(--k-dur-normal) var(--k-ease-out-expo),
            background-color var(--k-dur-normal) var(--k-ease-out-expo);
    }
    .k-prefs :global(.k-pref-switch[aria-checked="true"]) {
        background: var(--k-accent);
    }
    /* a dark thumb on the light accent: white on it would barely show where the thumb is */
    .k-prefs :global(.k-pref-switch[aria-checked="true"] > i) {
        translate: 16px 0;
        background: var(--k-page);
    }
    .k-prefs :global(.k-pref-seg) {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 2px;
        padding: 3px;
        border-radius: 10px;
        background: rgb(3 5 26 / 0.45);
    }
    .k-prefs :global(.k-pref-seg button) {
        min-height: 32px;
        padding: 6px 12px;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        font:
            600 13px/1.3 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg-2);
        white-space: nowrap;
        cursor: pointer;
    }
    .k-prefs :global(.k-pref-seg button:hover) {
        color: var(--k-fg);
    }
    .k-prefs :global(.k-pref-seg button[aria-checked="true"]) {
        background: var(--k-hover);
        color: var(--k-accent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--k-accent) 25%, transparent);
    }
    .k-prefs :global(.k-pref-seg button[aria-disabled="true"]),
    .k-prefs :global(.k-pref-select[aria-disabled="true"]),
    .k-prefs :global(.k-pref-switch[aria-disabled="true"]),
    .k-prefs :global(.k-pref-row[aria-disabled="true"] > :not(.k-pref-text)),
    .k-prefs :global(.k-pref-row[aria-disabled="true"] b) {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .k-prefs :global(.k-pref-select),
    .k-prefs :global(.k-pref-field) {
        flex: none;
        max-width: 230px;
        min-height: 36px;
        margin: 0;
        padding: 8px 12px;
        border: 1px solid var(--k-border-strong);
        border-radius: 10px;
        background: rgb(3 5 26 / 0.45);
        font:
            600 13px/1.3 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg);
    }
    /* The reference's list: no native arrow, a muted chevron at the end. */
    .k-prefs :global(.k-pref-select) {
        appearance: none;
        padding-right: 32px;
        background: rgb(3 5 26 / 0.45)
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23b8c4d6' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M7 10l5 5 5-5'/%3E%3C/svg%3E")
            right 10px center / 14px no-repeat;
        cursor: pointer;
    }
    .k-prefs :global(.k-pref-field) {
        flex: 1 1 100%;
        max-width: none;
    }
    .k-prefs :global(.k-pref-select option) {
        background: var(--k-card);
        color: var(--k-fg);
    }
    .k-prefs :global(.k-pref-play),
    .k-prefs :global(.k-pref-button) {
        display: inline-grid;
        place-items: center;
        flex: none;
        min-width: 36px;
        min-height: 36px;
        padding: 0 12px;
        border: 1px solid var(--k-border-strong);
        border-radius: 10px;
        background: transparent;
        font:
            600 13px/1.3 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg);
        cursor: pointer;
    }
    .k-prefs :global(.k-pref-play) {
        padding: 0;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-play:hover),
    .k-prefs :global(.k-pref-button:hover) {
        background: var(--k-hover);
        color: var(--k-fg);
    }
    .k-prefs :global(.k-pref-button.capturing) {
        border-color: var(--k-accent);
        color: var(--k-accent);
    }
    .k-prefs :global(.k-pref-button.quiet) {
        border-color: transparent;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-actions) {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    /* A button under the note of a choice: on a line of its own, apart from the note, and a finger's size on touch. */
    .k-prefs :global(.k-pref-text > .k-pref-button) {
        margin-top: 8px;
    }
    @media (pointer: coarse) {
        .k-prefs :global(.k-pref-text > .k-pref-button) {
            min-height: 44px;
        }
    }
    .k-prefs :global(.k-pref-range) {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1 1 220px;
    }
    .k-prefs :global(.k-pref-range input) {
        flex: 1;
        height: 6px;
        margin: 0;
        border-radius: var(--k-radius-pill);
        appearance: none;
        cursor: pointer;
        background: linear-gradient(
            90deg,
            var(--k-accent) var(--k-pref-fill, 50%),
            var(--k-border-strong) var(--k-pref-fill, 50%)
        );
    }
    .k-prefs :global(.k-pref-range input::-webkit-slider-thumb) {
        width: 18px;
        height: 18px;
        border: 2px solid var(--k-page);
        border-radius: 50%;
        appearance: none;
        background: #fff;
        box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    }
    .k-prefs :global(.k-pref-range input::-moz-range-thumb) {
        width: 18px;
        height: 18px;
        border: 2px solid var(--k-page);
        border-radius: 50%;
        background: #fff;
    }
    .k-prefs :global(.k-pref-range output) {
        min-width: 40px;
        text-align: end;
        font:
            600 13px/1 Urbanist,
            system-ui,
            sans-serif;
        font-variant-numeric: tabular-nums;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-keys) {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        justify-content: flex-end;
    }
    .k-prefs :global(.k-pref-keys kbd) {
        min-width: 24px;
        padding: 4px 7px;
        border: 1px solid var(--k-border-strong);
        border-bottom-width: 2px;
        border-radius: 6px;
        background: var(--k-page);
        font:
            600 12px/1 Urbanist,
            system-ui,
            sans-serif;
        text-align: center;
        color: var(--k-fg);
    }
    .k-prefs :global(.k-pref-muted),
    .k-prefs :global(.k-pref-value) {
        font:
            500 13px/1.4 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-preview) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 200px;
        gap: 12px;
    }
    .k-prefs :global(.k-pref-video) {
        display: grid;
        place-items: center;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border: 1px solid var(--k-border);
        border-radius: var(--k-radius-menu);
        background: var(--k-page);
        font:
            600 13px/1.4 Urbanist,
            system-ui,
            sans-serif;
        color: var(--k-fg-2);
    }
    .k-prefs :global(.k-pref-video video) {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
    }
    .k-prefs :global(.k-pref-mic) {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
        padding: 14px;
        border: 1px solid var(--k-border);
        border-radius: var(--k-radius-menu);
        background: var(--k-elevated);
        font:
            600 13px/1.3 Urbanist,
            system-ui,
            sans-serif;
    }
    .k-prefs :global(.k-pref-meter) {
        height: 8px;
        overflow: hidden;
        border-radius: var(--k-radius-pill);
        background: var(--k-border-strong);
    }
    .k-prefs :global(.k-pref-meter i) {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--k-accent);
    }
    .k-prefs :global(.k-pref-images) {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
        gap: 6px;
        flex: 1 1 100%;
    }
    .k-prefs :global(.k-pref-images button) {
        aspect-ratio: 3 / 2;
        padding: 0;
        overflow: hidden;
        border: 2px solid transparent;
        border-radius: var(--k-radius-inner);
        background: var(--k-page);
        cursor: pointer;
    }
    .k-prefs :global(.k-pref-images button[aria-checked="true"]) {
        border-color: var(--k-accent);
    }
    .k-prefs :global(.k-pref-images img) {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    /* A phone: the dialog takes the screen and the sections become a row to scroll above the section. */
    @media (max-width: 720px) {
        .k-prefs-scrim {
            padding: 0;
        }
        .k-prefs {
            grid-template-columns: 1fr;
            grid-template-rows: auto minmax(0, 1fr);
            width: 100%;
            height: 100%;
            border-radius: 0;
        }
        .k-prefs-nav {
            padding: 8px;
            border-right: 0;
            border-bottom: 1px solid var(--k-border);
        }
        .k-prefs-tabs {
            flex-direction: row;
            /* room for the focus ring, which the scrolling row would clip, and past the faded edge */
            padding: 4px 24px 4px 4px;
            overflow-x: auto;
            scrollbar-width: none;
            /* the faded right edge says the row goes on */
            mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent);
        }
        .k-prefs-group {
            display: none;
        }
        [role="tab"] {
            flex: none;
        }
        .k-prefs-head {
            padding: 12px 16px;
        }
        .k-prefs-pane {
            padding: 16px;
        }
        .k-prefs :global(.k-pref-preview) {
            grid-template-columns: 1fr;
        }
        .k-prefs :global(.k-pref-item) {
            flex-wrap: wrap;
            row-gap: 10px;
        }
        .k-prefs :global(.k-pref-text) {
            flex-basis: 180px;
        }
        .k-prefs :global(.k-pref-select) {
            max-width: 100%;
        }
    }
</style>
