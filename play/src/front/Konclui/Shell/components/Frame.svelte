<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { get } from "svelte/store";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { shellActiveStore, shellRoomStore } from "../stores/shellStore";
    import { gameViewportBounds } from "../../../ExternalModule/ClientExtensionPoints";
    import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";
    import { toGameViewport } from "../domain/gameViewport";
    import {
        focusAfterClose,
        isRosterAvailable,
        isWideScreen,
        opensOnLeftoverUserList,
        panelButtonFor,
        peopleOpening,
        sidePanelView,
        type PanelButton,
        type SidePanelView,
    } from "../domain/sidePanel";
    import { chatVisibilityStore, forceRefreshChatStore } from "../../../Stores/ChatStore";
    import { showMenuItem, SubMenusInterface } from "../../../Stores/MenuStore";
    import { navChat } from "../../../Chat/Stores/ChatStore";
    import ChatSidebar from "../../../Chat/ChatSidebar.svelte";
    import { IconUsersGroup, IconSettings, IconMessageCircle2, IconChevronLeft } from "@wa-icons";

    let { children }: { children: Snippet } = $props();
    let viewport: HTMLDivElement | undefined = $state();
    let panel: HTMLElement | undefined = $state();
    /** The room has no people list to show; the panel says so instead. */
    let rosterNoticeOpen = $state(false);
    let peopleButton: HTMLButtonElement | undefined = $state();
    let chatButton: HTMLButtonElement | undefined = $state();
    let mobilePeopleButton: HTMLButtonElement | undefined = $state();
    let roomOpenedFor: string | undefined;

    let view = $derived(
        sidePanelView({
            chatVisible: $chatVisibilityStore,
            chatShowsUserList: $navChat.key === "users",
            rosterNoticeOpen,
        }),
    );
    let peopleShown = $derived(view === "people");
    let conversationShown = $derived(view === "conversation");

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

    // The chat taking the panel ends the notice, so closing the chat later does not bring the notice back.
    $effect(() => {
        if ($chatVisibilityStore) rosterNoticeOpen = false;
    });

    // Upstream opens the chat for a message without choosing a tab, and must not land on the user list the people
    // view left behind. Each switch of the tab stores a new object, so the same object means nobody chose one.
    let tabWhenHidden: unknown;
    $effect.pre(() => {
        const chatVisible = $chatVisibilityStore;
        if (!$shellActiveStore) return;
        const tab = get(navChat);
        if (!chatVisible) {
            tabWhenHidden = tab;
        } else if (
            opensOnLeftoverUserList({
                chatShowsUserList: tab.key === "users",
                tabChosenSinceHidden: tab !== tabWhenHidden,
            })
        ) {
            navChat.switchToChat();
        }
    });

    // A wide screen opens on the people of the room, once per room and only when the chrome is drawn.
    $effect(() => {
        const roomId = $shellRoomStore?.id;
        if (!$shellActiveStore || roomId === undefined || roomId === roomOpenedFor) return;
        roomOpenedFor = roomId;
        // A notice raised in the previous room says nothing about this one.
        rosterNoticeOpen = false;
        // A chat that something opened before the chrome was drawn keeps the panel.
        if (isWideScreen(window.innerWidth) && !get(chatVisibilityStore)) untrack(() => openPeople(false));
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

    /** The people list is the chat's own user list, which a room may turn off. */
    function openPeople(requestedByUser: boolean) {
        const room = get(shellRoomStore);
        const rosterAvailable =
            room !== undefined &&
            isRosterAvailable({
                onlineListEnabled: room.isChatOnlineListEnabled,
                disconnectedListEnabled: room.isChatDisconnectedListEnabled,
            });
        const opening = peopleOpening(rosterAvailable, requestedByUser);
        if (opening === "list") {
            navChat.switchToUserList();
            chatVisibilityStore.set(true);
        } else if (opening === "notice") {
            rosterNoticeOpen = true;
            chatVisibilityStore.set(false);
        }
    }

    function togglePeople() {
        if (peopleShown) {
            rosterNoticeOpen = false;
            chatVisibilityStore.set(false);
        } else {
            openPeople(true);
        }
    }

    function elementOf(button: PanelButton): HTMLButtonElement | undefined {
        if (button === "mobilePeople") return mobilePeopleButton;
        return button === "chat" ? chatButton : peopleButton;
    }

    function closeRosterNotice() {
        rosterNoticeOpen = false;
        elementOf(panelButtonFor("people", isWideScreen(window.innerWidth)))?.focus();
    }

    function toggleChat() {
        if (conversationShown) {
            chatVisibilityStore.set(false);
            return;
        }
        rosterNoticeOpen = false;
        navChat.switchToChat();
        chatVisibilityStore.set(true);
    }

    function onkeydown(event: KeyboardEvent) {
        if (!$shellActiveStore || event.key !== "Escape" || event.defaultPrevented) return;
        if (!(event.target instanceof Node) || !panel?.contains(event.target)) return;
        if ($chatVisibilityStore) {
            chatVisibilityStore.set(false);
        } else if (rosterNoticeOpen) {
            closeRosterNotice();
        } else {
            return;
        }
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
                onclick={() => showMenuItem(SubMenusInterface.settings)}
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
                onclick={() => showMenuItem(SubMenusInterface.settings)}
            >
                <IconSettings font-size="20" />
            </button>
        </nav>
        <button
            class="mobile-people"
            bind:this={mobilePeopleButton}
            type="button"
            onclick={togglePeople}
            aria-expanded={peopleShown}
        >
            <IconUsersGroup font-size="18" />
            {$LL.konclui.people()}
        </button>
        <aside
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
        display: grid;
        grid-template-columns: 60px minmax(0, 1fr);
        gap: 0;
        padding: 6px 6px 6px 0;
        box-sizing: border-box;
        background: var(--k-page);
        color: var(--k-fg);
        font-family: Urbanist, system-ui, sans-serif;
    }
    .konclui.panel-open {
        grid-template-columns: 60px 296px minmax(0, 1fr);
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
        margin-right: 6px;
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
    .mobile-people {
        display: none;
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
        .mobile-people {
            display: flex;
            position: absolute;
            top: 12px;
            left: 12px;
            z-index: 30;
            gap: 6px;
            padding: 8px 12px;
            border-radius: 22px;
            min-height: 44px;
            /* The chrome material (konclui.css), like the dock. The rim is an inset shadow, not a border, so the
               pill keeps its size. */
            background: var(--k-chrome);
            -webkit-backdrop-filter: var(--k-chrome-backdrop);
            backdrop-filter: var(--k-chrome-backdrop);
            box-shadow:
                inset 0 0 0 1px var(--k-chrome-border),
                var(--k-chrome-shadow);
            font: inherit;
            font-size: 13px;
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
