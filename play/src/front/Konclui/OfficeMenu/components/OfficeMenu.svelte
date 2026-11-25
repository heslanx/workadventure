<script lang="ts">
    import type { Component } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { glide } from "../../../Utils/glide";
    import { surface } from "../../../Utils/surfaceTransition";
    import MenuGroup from "../../Controls/components/MenuGroup.svelte";
    import MenuRow from "../../Controls/components/MenuRow.svelte";
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
    // The last notice shown. The line it is in shuts when `feedback` clears, and the text stays in it for the length of
    // that, so the notice is seen to leave and not cut to an empty strip; it is forgotten when the menu opens again.
    let lastFeedback: "copied" | "failed" | undefined = $state();
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
    let noticeShown = $derived(feedback ?? lastFeedback);
    let noticeText = $derived(
        noticeShown === "copied" ? t.linkCopied() : noticeShown === "failed" ? t.linkCopyFailed() : "",
    );

    function rows(): HTMLElement[] {
        return [...(panel?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    }

    function focusRow(index: number): void {
        active = index;
        rows()[index]?.focus();
    }

    // The menu opens on its first row, and what it showed (a notice, the row that had the focus) is forgotten as it
    // closes. It follows the store as well as the panel: the panel stays in the page for the length of its exit, and a
    // menu that is opened again in that time is the same panel, which still has to take the focus.
    $effect(() => {
        if (panel === undefined || !$officeMenuOpenStore) return;
        lastFeedback = undefined;
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
        lastFeedback = result;
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
    <div
        class="office-menu k-chrome rounded-lg p-1.5 block-user-action"
        bind:this={panel}
        data-testid="office-menu"
        transition:surface
    >
        <!-- The list scrolls, not the panel: the scroller's edge fade would fade the panel's rim and shadow. -->
        <div
            class="list k-scroll-y k-glide"
            role="menu"
            aria-label={$LL.konclui.officeMenu()}
            {@attach glide({ item: ".k-menu-row" })}
        >
            {#each $menuGroupsStore as group, groupIndex (group.id)}
                {#if groupIndex > 0}
                    <hr class="k-divider" />
                {/if}
                <MenuGroup title={groupTitles[group.id]}>
                    {#if group.id === "status" && locked}
                        <span class="reason" id="{id}-locked">{t.statusLocked()}</span>
                    {/if}
                    {#each group.entries as entry (entryKey(entry))}
                        {@const index = keys.indexOf(entryKey(entry))}
                        {#if entry.kind === "status"}
                            <MenuRow
                                role="menuitemradio"
                                aria-checked={$statusStateStore.choice === entry.choice}
                                aria-disabled={locked}
                                aria-describedby={locked ? `${id}-locked` : undefined}
                                tabindex={index === active ? 0 : -1}
                                data-testid="office-menu-status-{entry.choice}"
                                onfocus={() => (active = index)}
                                onclick={() => activate(entry)}
                                label={statusLabels[entry.choice]}
                                marked={$statusStateStore.choice === entry.choice}
                            >
                                {#snippet lead()}
                                    <i
                                        class="block size-2.5 rounded-full"
                                        style="background-color: {dotColorOf(entry.choice)}"
                                    ></i>
                                {/snippet}
                            </MenuRow>
                        {:else}
                            {@const row = actionRows[entry.id]}
                            {@const Icon = row.icon}
                            {@const toggle = row.on !== undefined}
                            {@const on = row.on?.() ?? false}
                            <MenuRow
                                role={toggle ? "menuitemcheckbox" : "menuitem"}
                                aria-checked={toggle ? on : undefined}
                                tabindex={index === active ? 0 : -1}
                                data-testid="office-menu-{entry.id}"
                                onfocus={() => (active = index)}
                                onclick={() => activate(entry)}
                                label={row.label()}
                                marked={toggle && on}
                            >
                                {#snippet lead()}
                                    <Icon width="18" height="18" />
                                {/snippet}
                            </MenuRow>
                        {/if}
                    {/each}
                </MenuGroup>
            {/each}
        </div>
        <!-- The one change of size inside the menu: the line grows in and out. The live region is the slot itself, which
             stays visible, so the text reaches a screen reader as it appears; the body hides what is inside while shut,
             and the text is kept in it while it shuts so the line is seen to leave. -->
        <div class="feedback-slot k-disclosure" class:is-open={feedback !== undefined} role="status">
            <div class="k-disclosure-body">
                <p class="feedback" class:failed={noticeShown === "failed"}>{noticeText}</p>
            </div>
        </div>
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
        display: flex;
        flex-direction: column;
        width: min(264px, calc(100vw - 16px));
        max-height: calc(100dvh - 24px);
        color: var(--k-fg);
        font-family: Urbanist, system-ui, sans-serif;
        /* It comes from the rail, on its left. */
        --k-enter-x: -6px;
        --k-enter-y: 0px;
    }
    .list {
        flex: 1 1 auto;
        min-height: 0;
    }
    .reason {
        padding: 0 12px 4px;
        color: var(--k-fg-2);
        font-size: 12px;
        line-height: 1.5;
    }
    /* The slot is never squeezed by the menu's height: the list is what scrolls. */
    .feedback-slot {
        flex: none;
    }
    /* Its margin and padding are the line's own, inside the body that clips: shut, none of it shows. */
    .feedback {
        margin: 6px 0 0;
        padding: 6px 12px;
        color: var(--k-success-text);
        font-size: 12px;
        line-height: 1.5;
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
</style>
