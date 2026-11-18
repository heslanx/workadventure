<script lang="ts">
    import { onMount, type Snippet } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { shellActiveStore } from "../stores/shellStore";
    import {
        closeRosterNotice as endRosterNotice,
        closeSidePanel,
        followShell,
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
    import { openPreferences } from "../../Preferences/stores/preferencesStore";
    import ChatSidebar from "../../../Chat/ChatSidebar.svelte";
    import PeoplePill from "../../Presence/components/PeoplePill.svelte";
    import PlaceChip from "../../Presence/components/PlaceChip.svelte";
    import { IconUsersGroup, IconSettings, IconMessageCircle2, IconChevronLeft } from "@wa-icons";

    let { children }: { children: Snippet } = $props();
    let viewport: HTMLDivElement | undefined = $state();
    let panel: HTMLElement | undefined = $state();
    let peopleButton: HTMLButtonElement | undefined = $state();
    let chatButton: HTMLButtonElement | undefined = $state();
    let mobilePeopleButton: HTMLButtonElement | undefined = $state();

    let view = $derived($sidePanelStore.view);
    let rosterNoticeOpen = $derived($sidePanelStore.rosterNoticeOpen);
    let peopleShown = $derived(view === "people");
    let conversationShown = $derived(view === "conversation");

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

    function closeRosterNotice() {
        endRosterNotice();
        focusPeopleButton();
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

<svelte:window {onkeydown} />

<div
    class="office-frame"
    class:konclui={$shellActiveStore}
    class:panel-open={view !== "closed"}
    data-testid={$shellActiveStore ? "konclui-shell" : undefined}
>
    {#if $shellActiveStore}
        <nav class="rail" aria-label={$LL.konclui.office()}>
            <button
                class="logo"
                type="button"
                aria-label={$LL.konclui.officeMenu()}
                onclick={(event) => openPreferences(undefined, event.currentTarget)}
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
            class="side-panel"
            data-konclui-panel
            class:closed={view === "closed"}
            aria-label={conversationShown ? $LL.konclui.chat() : $LL.konclui.peoplePanel()}
        >
            {#if $chatVisibilityStore}
                {#key $forceRefreshChatStore}
                    <ChatSidebar embedded />
                {/key}
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
    .side-panel {
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
    /* Beside the rail the people button is the rail's; the pill is for the phone. */
    .people-slot {
        display: none;
        flex: none;
        pointer-events: auto;
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
        .people-slot {
            display: block;
        }
        .side-panel {
            position: absolute;
            inset: 58px 8px 82px;
            margin-right: 0;
            z-index: 35;
            box-shadow: 0 8px 32px #0008;
        }
    }
</style>
