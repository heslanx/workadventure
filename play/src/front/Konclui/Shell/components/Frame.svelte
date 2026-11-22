<script lang="ts">
    import { onMount, type Snippet } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { shellActiveStore } from "../stores/shellStore";
    import {
        closeRosterNotice as endRosterNotice,
        closeSidePanel,
        followShell,
        showPeople,
        sidePanelStore,
        toggleChat,
        togglePeople,
    } from "../stores/sidePanelStore";
    import { gameViewportBounds } from "../../../ExternalModule/ClientExtensionPoints";
    import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";
    import { toGameViewport } from "../domain/gameViewport";
    import {
        focusAfterClose,
        isWideScreen,
        panelButtonFor,
        type PanelButton,
        type SidePanelView,
    } from "../domain/sidePanel";
    import { chatVisibilityStore, forceRefreshChatStore } from "../../../Stores/ChatStore";
    import { openPreferences, preferencesStore } from "../../Preferences/stores/preferencesStore";
    import OfficeMenu from "../../OfficeMenu/components/OfficeMenu.svelte";
    import { officeMenuOpenStore, toggleOfficeMenu } from "../../OfficeMenu/stores/officeMenuStore";
    import ChatSidebar from "../../../Chat/ChatSidebar.svelte";
    import PeoplePanel from "../../Presence/components/PeoplePanel.svelte";
    import PeoplePill from "../../Presence/components/PeoplePill.svelte";
    import PlaceChip from "../../Presence/components/PlaceChip.svelte";
    import WalkNotice from "../../Presence/components/WalkNotice.svelte";
    import { isSearchShortcut } from "../../Presence/domain/peopleSearch";
    import { requestSearchFocus } from "../../Presence/stores/peopleSearchStore";
    import { combinationKeys } from "../../Preferences/domain/shortcutKeys";
    import { isMac } from "../../../WebRtc/DeviceUtils";
    import { IconUsersGroup, IconSettings, IconMessageCircle2, IconChevronLeft, IconSearch } from "@wa-icons";

    let { children }: { children: Snippet } = $props();
    let viewport: HTMLDivElement | undefined = $state();
    let panel: HTMLElement | undefined = $state();
    let peopleButton: HTMLButtonElement | undefined = $state();
    let chatButton: HTMLButtonElement | undefined = $state();
    let mobilePeopleButton: HTMLButtonElement | undefined = $state();

    let view = $derived($sidePanelStore.view);
    let rosterNoticeOpen = $derived($sidePanelStore.rosterNoticeOpen);
    let peopleShown = $derived(view === "people");
    // The people panel, or the notice that the room has no people list: both are the people view.
    let peopleListShown = $derived(peopleShown && !rosterNoticeOpen);
    let conversationShown = $derived(view === "conversation");

    // The key of the search shortcut as it reads on this keyboard: ⌘K on a Mac, Ctrl K elsewhere.
    const searchKeys = combinationKeys(
        { label: "K", mod: true, alt: false, shift: false },
        { mac: isMac(), shift: "" },
    );
    const searchShortcutLabel = searchKeys.join(searchKeys[0] === "⌘" ? "" : " ");

    onMount(() => followShell(() => isWideScreen(window.innerWidth)));

    // Whether the focus is inside the panel as it closes. This runs before the update that removes the chat, so
    // it must stay above the template: afterwards the focus is on the page whether it was in the panel or not.
    let focusWasInPanel = false;
    $effect.pre(() => {
        focusWasInPanel = view === "closed" && (panel?.contains(document.activeElement) ?? false);
    });

    // Closing the panel removes the element that had the focus; hand it to the button that reopens that view.
    let lastOpenView: SidePanelView = "closed";
    $effect(() => {
        if (view !== "closed") {
            lastOpenView = view;
            return;
        }
        const button = focusAfterClose({
            closedView: lastOpenView,
            focusWasInPanel,
            focusIsOnPage: document.activeElement === document.body,
            wideScreen: isWideScreen(window.innerWidth),
        });
        // A close is handled once: the rail drawn again after a loader is not another close.
        lastOpenView = "closed";
        if (button !== undefined) elementOf(button)?.focus();
    });

    $effect(() => {
        if (!$shellActiveStore || !viewport) {
            gameViewportBounds.set(undefined);
            return;
        }
        const element = viewport;
        let published: ViewportBounds | undefined;
        const measure = () => {
            const { width, height, left, top } = element.getBoundingClientRect();
            const measurement = toGameViewport({ width, height, left, top }, published);
            if (measurement.kind === "publish") {
                published = measurement.bounds;
                gameViewportBounds.set(measurement.bounds);
            }
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => {
            observer.disconnect();
            gameViewportBounds.set(undefined);
        };
    });

    function elementOf(button: PanelButton): HTMLButtonElement | undefined {
        if (button === "mobilePeople") return mobilePeopleButton;
        return button === "chat" ? chatButton : peopleButton;
    }

    function focusPeopleButton() {
        elementOf(panelButtonFor("people", isWideScreen(window.innerWidth)))?.focus();
    }

    // "Ir até" on a phone: the sheet covers the map, and the walk it just started cannot be seen under it. It closes as the
    // walk starts. The focus, if it was on the row that was pressed, goes to the pill that reopens the panel (the close
    // effect above); the words about the walk are announced by the live region below, which the closing does not remove.
    function leaveSheetForWalk() {
        if (!isWideScreen(window.innerWidth)) closeSidePanel();
    }

    function closeRosterNotice() {
        endRosterNotice();
        focusPeopleButton();
    }

    // Opens the people panel and puts the caret in its search field: the rail's search button and the shortcut both do it.
    // A room without a people list gets its notice instead, and has no field to focus.
    function searchPeople() {
        if (showPeople()) requestSearchFocus();
    }

    // Ctrl+K or ⌘K, from anywhere in the shell: the canvas, the chat's composer, the field itself (where it selects the
    // text). It is taken in the capture phase, before anything below can use the key, and the browser does not get it.
    // Behind the preferences dialog, which is modal, it leaves the key alone.
    function onkeydowncapture(event: KeyboardEvent) {
        if (!$shellActiveStore || !isSearchShortcut(event) || $preferencesStore.open) return;
        event.preventDefault();
        searchPeople();
    }

    function onkeydown(event: KeyboardEvent) {
        if (!$shellActiveStore || event.key !== "Escape" || event.defaultPrevented) return;
        if (!(event.target instanceof Node) || !panel?.contains(event.target)) return;
        const closed = closeSidePanel();
        if (closed === undefined) return;
        if (closed === "notice") focusPeopleButton();
        event.preventDefault();
    }
</script>

<svelte:window {onkeydown} {onkeydowncapture} />

<!-- The Konclui logo opens the office menu (status, profile, settings, tools); the gear opens the preferences. It is in
     the rail, and on a phone, where the rail is hidden, at the start of the top row. -->
{#snippet logoButton(chrome: boolean)}
    <button
        class="logo"
        class:k-chrome={chrome}
        type="button"
        aria-label={$LL.konclui.officeMenu()}
        aria-haspopup="menu"
        aria-expanded={$officeMenuOpenStore}
        onclick={(event) => toggleOfficeMenu(event.currentTarget)}
    >
        <svg viewBox="0 0 162 162" fill="currentColor" aria-hidden="true">
            <path
                d="M152.548 0.0123053C158.963 0.0123053 162.165 7.7812 157.609 12.2997L42.0282 126.912C37.0039 131.887 30.8592 134.103 24.8376 134.103C12.1541 134.103 0 124.253 0 109.392V43.129C0 39.1646 3.21399 35.9388 7.19145 35.9388H35.4401C39.4052 35.9388 42.6315 39.1523 42.6315 43.129V72.838L113.721 2.09305C115.063 0.75103 116.886 0 118.794 0H152.572L152.548 0.0123053Z"
            />
            <path
                d="M157.617 149.434C162.164 153.943 158.993 161.708 152.591 161.709H118.884C116.979 161.709 115.16 160.959 113.821 159.62L65.7827 111.812L92.7343 85.0928L157.617 149.434Z"
            />
            <path
                d="M0 127.637C5.86924 135.38 15.253 139.906 24.7757 139.906C30.8917 139.906 37.0985 138.066 42.528 134.103V155.025C42.2945 158.782 39.1716 161.748 35.3662 161.748H7.1766C3.20745 161.748 7.61852e-06 158.529 0 154.573V127.637Z"
            />
        </svg>
    </button>
{/snippet}

<div
    class="office-frame"
    class:konclui={$shellActiveStore}
    class:panel-open={view !== "closed"}
    data-testid={$shellActiveStore ? "konclui-shell" : undefined}
>
    {#if $shellActiveStore}
        <nav class="rail" aria-label={$LL.konclui.office()}>
            {@render logoButton(false)}
            <button
                type="button"
                aria-label={$LL.konclui.peopleList.searchLabel()}
                title={$LL.konclui.peopleList.searchShortcut({ keys: searchShortcutLabel })}
                onclick={searchPeople}
            >
                <IconSearch font-size="20" />
            </button>
            <button
                type="button"
                aria-label={$LL.konclui.people()}
                aria-pressed={peopleShown}
                onclick={togglePeople}
                bind:this={peopleButton}
            >
                <IconUsersGroup font-size="20" />
            </button>
            <button
                type="button"
                aria-label={$LL.konclui.chat()}
                aria-pressed={conversationShown}
                onclick={toggleChat}
                bind:this={chatButton}
            >
                <IconMessageCircle2 font-size="20" />
            </button>
            <button
                class="settings"
                type="button"
                aria-label={$LL.konclui.settings()}
                onclick={(event) => openPreferences(undefined, event.currentTarget)}
            >
                <IconSettings font-size="20" />
            </button>
        </nav>
        <!-- The top of the map: the place you are in at every width, and on a phone the pill that opens the panel. -->
        <div class="top-row">
            <div class="logo-slot">{@render logoButton(true)}</div>
            <div class="people-slot">
                <PeoplePill
                    bind:button={mobilePeopleButton}
                    expanded={peopleShown}
                    controls="konclui-side-panel"
                    onclick={togglePeople}
                />
            </div>
            <PlaceChip />
        </div>
        <aside
            id="konclui-side-panel"
            bind:this={panel}
            class="side-panel k-enter"
            data-konclui-panel
            class:closed={view === "closed"}
            aria-label={conversationShown ? $LL.konclui.chat() : $LL.konclui.peoplePanel()}
        >
            {#if $chatVisibilityStore}
                {#key $forceRefreshChatStore}
                    <ChatSidebar embedded />
                {/key}
            {:else if peopleListShown}
                <PeoplePanel onCollapse={togglePeople} onWalk={leaveSheetForWalk} />
            {:else if rosterNoticeOpen}
                <header>
                    <strong>{$LL.konclui.people()}</strong><button
                        type="button"
                        aria-label={$LL.konclui.collapsePanel()}
                        onclick={closeRosterNotice}><IconChevronLeft font-size="18" /></button
                    >
                </header>
                <p class="notice" role="status">{$LL.konclui.rosterUnavailable()}</p>
            {/if}
        </aside>
        <WalkNotice live />
        <OfficeMenu />
    {/if}
    <div class="viewport" bind:this={viewport}>
        {@render children()}
    </div>
</div>

<style>
    .office-frame {
        width: 100dvw;
        height: 100dvh;
    }
    .viewport {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
    }
    .konclui {
        /* The grid's measures, which the top row reads to stand at the map's corner. */
        --rail-width: 60px;
        --panel-width: 296px;
        --frame-gap: 6px;
        display: grid;
        grid-template-columns: var(--rail-width) minmax(0, 1fr);
        gap: 0;
        padding: var(--frame-gap) var(--frame-gap) var(--frame-gap) 0;
        box-sizing: border-box;
        background: var(--k-page);
        color: var(--k-fg);
        font-family: Urbanist, system-ui, sans-serif;
    }
    .konclui.panel-open {
        grid-template-columns: var(--rail-width) var(--panel-width) minmax(0, 1fr);
    }
    .konclui .viewport {
        border-radius: var(--k-radius-surface);
        background: var(--k-card);
    }
    .konclui :global(#game > canvas) {
        border-radius: var(--k-radius-surface);
    }
    /* Upstream's map zoom column (ExplorerMenu.svelte) is fixed to the window and ignores the dock: here it stands on
       the dock's line, 14 px above the map's bottom edge. The column is 48 px wide and 8 px in; beside an open panel
       (rail 60 + panel 296 + gap 6) the centred dock leaves it room on its side only from 1024 px up, so below that it
       stands 8 px above the whole dock stack, whose height Dock.svelte publishes. */
    .konclui :global([data-testid="actions-explorer"]) {
        bottom: calc(var(--frame-gap) + 14px);
    }
    @media (max-width: 1023px) {
        .konclui.panel-open :global([data-testid="actions-explorer"]) {
            bottom: calc(var(--frame-gap) + var(--konclui-dock-stack-height, 76px) + 8px);
        }
    }
    .rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 14px 0;
    }
    button {
        color: inherit;
        cursor: pointer;
        border: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    button:focus-visible {
        outline: 2px solid var(--k-accent);
        outline-offset: 2px;
    }
    .rail button {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: transparent;
    }
    .rail button:hover,
    .rail button[aria-pressed="true"] {
        background: var(--k-elevated);
    }
    .rail button[aria-pressed="true"] {
        color: var(--k-accent);
    }
    .logo svg {
        width: 24px;
        height: 24px;
    }
    .rail .logo {
        margin-bottom: 18px;
    }
    .rail .settings {
        margin-top: auto;
    }
    /* It slides in from the rail. The grid switches at once and only this card moves (opacity and transform): a column
       that animated re-fitted the map's canvas every frame and blanked it mid-slide, measured 2026-11-20. */
    .side-panel {
        --k-enter-x: -24px;
        --k-enter-y: 0px;
        --k-enter-dur: var(--k-dur-settle);
        --k-enter-ease: var(--k-ease-sheet);
        position: relative;
        margin-right: var(--frame-gap);
        min-width: 0;
        min-height: 0;
        border-radius: var(--k-radius-surface);
        background: var(--k-card);
        overflow: hidden;
    }
    .side-panel.closed {
        display: none;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 18px 12px;
    }
    header strong {
        font-size: 20px;
    }
    header button {
        width: 30px;
        height: 30px;
        border-radius: var(--k-radius-inner);
        background: transparent;
    }
    header button:hover {
        background: var(--k-hover);
    }
    .notice {
        margin: 0 18px 18px;
        color: var(--k-fg-2);
        font-size: 13px;
        line-height: 1.5;
    }
    /* The row stands 12 px inside the map's corner: past the rail, and past the panel when it is open. It lets a click
       through to the map; its controls take it back. */
    .top-row {
        position: absolute;
        z-index: 30;
        top: calc(var(--frame-gap) + 12px);
        left: calc(var(--rail-width) + 12px);
        right: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        pointer-events: none;
    }
    .konclui.panel-open .top-row {
        left: calc(var(--rail-width) + var(--panel-width) + var(--frame-gap) + 12px);
    }
    /* Beside the rail the people button and the logo are the rail's; the pill and the logo's chip are for the phone. */
    .people-slot,
    .logo-slot {
        display: none;
        flex: none;
        pointer-events: auto;
    }
    .logo-slot .logo {
        width: 44px;
        height: 44px;
        border-radius: 22px;
    }
    .logo-slot .logo:hover {
        background-color: var(--k-hover);
    }
    @media (max-width: 767px) {
        .konclui,
        .konclui.panel-open {
            display: block;
            padding: 0;
        }
        .rail {
            display: none;
        }
        .konclui .viewport,
        .konclui :global(#game > canvas) {
            border-radius: 0;
        }
        .top-row,
        .konclui.panel-open .top-row {
            top: 12px;
            left: 12px;
        }
        .people-slot,
        .logo-slot {
            display: block;
        }
        /* On a phone it is a card over the map: it rises instead. It stops 6 px above the whole dock stack, whose height
           Dock.svelte publishes: the dock wraps into rows while a conversation is on, and a bottom fixed at one row
           covered the first of them (the 76 px fallback is one row, so the card is where it was while none is measured).
           A short window with the chips and a wrapped dock would leave it no height at all: it keeps a floor, and past
           the floor it gives way at the bottom (it reaches into the dock) rather than vanish. */
        .side-panel {
            --k-enter-x: 0px;
            --k-enter-y: 16px;
            position: absolute;
            inset: 58px 8px calc(var(--konclui-dock-stack-height, 76px) + 6px);
            min-height: 144px;
            margin-right: 0;
            z-index: 35;
            box-shadow: 0 8px 32px #0008;
        }
        /* The map reaches the window's edge and the dock wraps under the column: it stands above the dock stack. */
        .konclui :global([data-testid="actions-explorer"]) {
            bottom: calc(var(--konclui-dock-stack-height, 76px) + 8px);
        }
        /* While the card covers the map the column has nothing to zoom: it is not drawn, so no stub of it shows
           under the card's corner and none of its buttons can take the focus unseen. It is back when the card closes. */
        .konclui.panel-open :global([data-testid="actions-explorer"]) {
            display: none;
        }
    }
</style>
