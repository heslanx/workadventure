<script lang="ts">
    import type { Component } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { openCompanionEditor, openNameEditor, openWokaEditor } from "../../Preferences/stores/gameCommands";
    import { openPreferences } from "../../Preferences/stores/preferencesStore";
    import {
        entryKey,
        rowAfter,
        type MenuActionId,
        type MenuEntry,
        type MenuGroupId,
        type StatusChoice,
    } from "../domain/officeMenu";
    import { openCameraScene } from "../stores/cameraScene";
    import { broadcastModeStore, openGlobalMessage } from "../stores/globalMessage";
    import { mapEditorOnStore, mapExplorerOnStore, toggleMapEditor, toggleMapExplorer } from "../stores/mapTools";
    import { menuGroupsStore } from "../stores/menuGroupsStore";
    import { chooseStatus, dotColorOf, statusStateStore } from "../stores/menuStatus";
    import { copyOfficeLink } from "../stores/officeLink";
    import { closeOfficeMenu, isOfficeMenuOpener, officeMenuOpenStore } from "../stores/officeMenuStore";
    import {
        IconCamera,
        IconCheck,
        IconLink,
        IconMapEditor,
        IconMapSearch,
        IconPencil,
        IconSettings,
        IconSpeakerPhone,
        IconUserEdit,
        IconUserPlus,
    } from "@wa-icons";

    // The menu the logo opens (the reference's `kmh-menu`): your status, your profile, the settings and the tools of
    // the room, in one place. Each row does what the upstream screen it comes from does. The panel is a menu: the
    // arrow keys, Home and End move between the rows, Esc and Tab close it and hand the focus back to the logo, and a
    // press anywhere else closes it. The box carries upstream's `block-user-action`: while the focus is inside it,
    // the game's keys are held, so an arrow moves the row and not the player.

    const id = $props.id();
    let panel: HTMLDivElement | undefined = $state();
    // The row that is in the tab order; the arrow keys move it (a roving tabindex).
    let active = $state(0);
    let feedback: "copied" | "failed" | undefined = $state();
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

    let t = $derived($LL.konclui.menu);
    let keys = $derived($menuGroupsStore.flatMap((group) => group.entries.map(entryKey)));
    let locked = $derived($statusStateStore.locked);

    let groupTitles = $derived<Record<MenuGroupId, string>>({
        status: t.statusGroup(),
        profile: t.profileGroup(),
        settings: t.settingsGroup(),
        tools: t.toolsGroup(),
    });
    let statusLabels = $derived<Record<StatusChoice, string>>({
        online: t.online(),
        busy: t.busy(),
        away: t.away(),
        doNotDisturb: t.doNotDisturb(),
    });
    let feedbackText = $derived(
        feedback === "copied" ? t.linkCopied() : feedback === "failed" ? t.linkCopyFailed() : "",
    );

    function rows(): HTMLElement[] {
        return [...(panel?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    }

    function focusRow(index: number): void {
        active = index;
        rows()[index]?.focus();
    }

    // The menu opens on its first row, and what it showed (a notice, the row that had the focus) is forgotten as it
    // closes.
    $effect(() => {
        if (panel === undefined) return;
        focusRow(0);
        return () => {
            clearTimeout(feedbackTimer);
            feedback = undefined;
        };
    });

    // The rows can change while the menu is open (the map's editor is switched on, a permission arrives).
    $effect(() => {
        if (active >= keys.length) active = Math.max(0, keys.length - 1);
    });

    function showFeedback(result: "copied" | "failed"): void {
        feedback = result;
        clearTimeout(feedbackTimer);
        // The notice stays 5 s, as the preferences dialog's copy button keeps its confirmation.
        feedbackTimer = setTimeout(() => {
            feedback = undefined;
        }, 5000);
    }

    async function shareLink(): Promise<void> {
        try {
            await copyOfficeLink();
            showFeedback("copied");
        } catch (error: unknown) {
            console.error("[konclui] office menu: could not copy the office link", error);
            showFeedback("failed");
        }
    }

    /** Closes the menu and hands the focus back to the logo before what the row opens takes the focus its own way. */
    function leave(): HTMLElement | undefined {
        return closeOfficeMenu({ returnFocus: true });
    }

    function leaveThen(open: () => void): () => void {
        return () => {
            leave();
            open();
        };
    }

    // One entry per action row: what it says, its icon, what it does, and for a switch whether it is on. The type
    // keeps the table exhaustive: a new MenuActionId does not compile until it has its entry.
    interface ActionRow {
        label: () => string;
        icon: Component;
        run: () => void;
        on?: () => boolean;
    }
    const actionRows: Record<MenuActionId, ActionRow> = {
        editName: { label: () => t.editName(), icon: IconPencil, run: leaveThen(openNameEditor) },
        avatar: { label: () => t.avatar(), icon: IconUserEdit, run: leaveThen(openWokaEditor) },
        companion: { label: () => t.companion(), icon: IconUserPlus, run: leaveThen(openCompanionEditor) },
        // The screen upstream's profile menu opens for "Edit cam / mic", with the preview and the save button.
        cameraMicrophone: { label: () => t.cameraMicrophone(), icon: IconCamera, run: leaveThen(openCameraScene) },
        settings: { label: () => t.allSettings(), icon: IconSettings, run: () => openPreferences(undefined, leave()) },
        shareLink: {
            label: () => t.shareLink(),
            icon: IconLink,
            run: () => {
                shareLink().catch((error: unknown) => console.error(error));
            },
        },
        mapEditor: {
            label: () => t.mapEditor(),
            icon: IconMapEditor,
            run: leaveThen(toggleMapEditor),
            on: () => $mapEditorOnStore,
        },
        explore: {
            label: () => t.explore(),
            icon: IconMapSearch,
            run: leaveThen(toggleMapExplorer),
            on: () => $mapExplorerOnStore,
        },
        broadcast: {
            label: () => t.broadcast(),
            icon: IconSpeakerPhone,
            run: leaveThen(() => {
                const mode = $broadcastModeStore;
                if (mode !== undefined) openGlobalMessage(mode);
            }),
        },
    };

    function activate(entry: MenuEntry): void {
        if (entry.kind === "status") {
            // The row that was chosen shows its mark at once; the menu stays so the change can be seen.
            chooseStatus(entry.choice);
            return;
        }
        actionRows[entry.id].run();
    }

    function onkeydown(event: KeyboardEvent): void {
        if (!$officeMenuOpenStore || event.defaultPrevented) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeOfficeMenu({ returnFocus: true });
            return;
        }
        if (!(event.target instanceof Node) || !panel?.contains(event.target)) return;
        // The focus leaves the menu with Tab, so the menu has no reason to stay open behind it.
        if (event.key === "Tab") {
            closeOfficeMenu({ returnFocus: true });
            return;
        }
        const focused = rows().indexOf(event.target as HTMLElement);
        const next = rowAfter(focused === -1 ? active : focused, event.key, rows().length);
        if (next === undefined) return;
        event.preventDefault();
        focusRow(next);
    }

    function onpointerdown(event: PointerEvent): void {
        if (!$officeMenuOpenStore || !(event.target instanceof Node)) return;
        if (panel?.contains(event.target) || isOfficeMenuOpener(event.target)) return;
        closeOfficeMenu({ returnFocus: false });
    }
</script>

<svelte:window {onkeydown} {onpointerdown} />

{#if $officeMenuOpenStore}
    <div class="office-menu k-chrome block-user-action" bind:this={panel} data-testid="office-menu">
        <div role="menu" aria-label={$LL.konclui.officeMenu()}>
            {#each $menuGroupsStore as group (group.id)}
                <div class="group" role="group" aria-label={groupTitles[group.id]}>
                    <span class="group-title" aria-hidden="true">{groupTitles[group.id]}</span>
                    {#if group.id === "status" && locked}
                        <span class="reason" id="{id}-locked">{t.statusLocked()}</span>
                    {/if}
                    {#each group.entries as entry (entryKey(entry))}
                        {@const index = keys.indexOf(entryKey(entry))}
                        {#if entry.kind === "status"}
                            <button
                                type="button"
                                class="row"
                                role="menuitemradio"
                                aria-checked={$statusStateStore.choice === entry.choice}
                                aria-disabled={locked}
                                aria-describedby={locked ? `${id}-locked` : undefined}
                                tabindex={index === active ? 0 : -1}
                                data-testid="office-menu-status-{entry.choice}"
                                onfocus={() => (active = index)}
                                onclick={() => activate(entry)}
                            >
                                <span class="lead" aria-hidden="true">
                                    <i class="dot" style="background-color: {dotColorOf(entry.choice)}"></i>
                                </span>
                                <span class="label">{statusLabels[entry.choice]}</span>
                                {#if $statusStateStore.choice === entry.choice}
                                    <IconCheck class="mark" font-size="16" aria-hidden="true" />
                                {/if}
                            </button>
                        {:else}
                            {@const row = actionRows[entry.id]}
                            {@const Icon = row.icon}
                            {@const toggle = row.on !== undefined}
                            {@const on = row.on?.() ?? false}
                            <button
                                type="button"
                                class="row"
                                role={toggle ? "menuitemcheckbox" : "menuitem"}
                                aria-checked={toggle ? on : undefined}
                                tabindex={index === active ? 0 : -1}
                                data-testid="office-menu-{entry.id}"
                                onfocus={() => (active = index)}
                                onclick={() => activate(entry)}
                            >
                                <span class="lead" aria-hidden="true"><Icon font-size="18" /></span>
                                <span class="label">{row.label()}</span>
                                {#if toggle && on}
                                    <IconCheck class="mark" font-size="16" aria-hidden="true" />
                                {/if}
                            </button>
                        {/if}
                    {/each}
                </div>
            {/each}
        </div>
        <p class="feedback" class:failed={feedback === "failed"} role="status">{feedbackText}</p>
    </div>
{/if}

<style>
    /* The menu stands beside the rail, over the map, in the chrome material (the dock's fill and rim). On a phone the
       rail is hidden and the logo is in the top row, so it hangs under that row. */
    .office-menu {
        position: fixed;
        z-index: 50;
        top: calc(var(--frame-gap, 6px) + 8px);
        left: calc(var(--rail-width, 60px) + 4px);
        box-sizing: border-box;
        width: min(264px, calc(100vw - 16px));
        max-height: calc(100dvh - 24px);
        padding: 6px;
        overflow-y: auto;
        border-radius: var(--k-radius-surface);
        color: var(--k-fg);
        font-family: Urbanist, system-ui, sans-serif;
        animation: k-office-menu-in var(--k-dur-fast) var(--k-ease-out-expo) backwards;
    }
    @keyframes k-office-menu-in {
        from {
            opacity: 0;
            transform: translateX(-6px);
        }
    }
    .group + .group {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid var(--k-border-subtle);
    }
    .group {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .group-title {
        padding: 6px 12px 2px;
        color: var(--k-fg-muted);
        font-size: 12px;
        font-weight: 600;
        line-height: 1.5;
    }
    .reason {
        padding: 0 12px 4px;
        color: var(--k-fg-2);
        font-size: 12px;
        line-height: 1.5;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        color: var(--k-fg-2);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
    }
    .row:hover {
        background: var(--k-hover);
        color: var(--k-fg);
    }
    /* Inside the box, so the panel's scroll does not clip the ring. */
    .row:focus-visible {
        outline: 2px solid var(--k-accent);
        outline-offset: -2px;
    }
    .row[aria-checked="true"],
    .row[aria-checked="true"]:hover {
        color: var(--k-accent);
    }
    /* A status the place decides stays in the list and keeps its focus; the reason is above it. */
    .row[aria-disabled="true"] {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .row[aria-disabled="true"]:hover {
        background: transparent;
        color: var(--k-fg-2);
    }
    .lead {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
    }
    .dot {
        display: block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
    }
    .label {
        flex: 1;
        min-width: 0;
    }
    .row :global(.mark) {
        flex: none;
    }
    .feedback {
        margin: 0;
        padding: 0 12px;
        color: var(--k-success-text);
        font-size: 12px;
        line-height: 1.5;
    }
    .feedback:not(:empty) {
        margin-top: 6px;
        padding-block: 6px;
    }
    .feedback.failed {
        color: var(--k-danger-text);
    }
    @media (max-width: 767px) {
        .office-menu {
            top: 64px;
            left: 8px;
            /* The top moved down by 50px: the box keeps 12px above the bottom edge, or its last row is off the screen. */
            max-height: calc(100dvh - 64px - 12px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .office-menu {
            animation: none;
        }
    }
</style>
