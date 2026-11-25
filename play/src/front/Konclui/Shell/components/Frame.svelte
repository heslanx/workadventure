<script lang="ts">
    import { onMount, type Snippet } from "svelte";
    import type { Attachment } from "svelte/attachments";
    import type { TransitionConfig } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { shellActiveStore, shellFramedStore, shellSettlingStore } from "../stores/shellStore";
    import { viewportLandmarkStore } from "../stores/landmarkStore";
    import {
        closeRosterNotice as endRosterNotice,
        closeSidePanel,
        followShell,
        showPeople,
        sidePanelStore,
        toggleChat,
        togglePeople,
    } from "../stores/sidePanelStore";
    import { gameViewportBounds, gameViewportCoveredStart } from "../../../ExternalModule/ClientExtensionPoints";
    import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";
    import { coWebsites } from "../../../Stores/CoWebsiteStore";
    import { glide } from "../../../Utils/glide";
    import { fade } from "../../../Utils/reducedMotion";
    import { blocker } from "../../../Utils/screenBlocker";
    import { cubicBezier } from "../../../Utils/spring";
    import { surface } from "../../../Utils/surfaceTransition";
    import { toGameViewport } from "../domain/gameViewport";
    import {
        focusAfterClose,
        isWideScreen,
        panelButtonFor,
        type PanelButton,
        type SidePanelView,
    } from "../domain/sidePanel";
    import { chatInputFocusStore, chatVisibilityStore, forceRefreshChatStore } from "../../../Stores/ChatStore";
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

    /** What the buttons that open the card point at: the card's id, while the card is there. */
    const PANEL_ID = "konclui-side-panel";

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
    // The state, not the card: the card stays in the page for the length of its exit, and what points at it or opens it
    // follows what the user asked for, as `aria-pressed` does.
    let panelOpen = $derived(view !== "closed");
    // What the card holds. It changes while the card stays open (people to chat), and then the content fades in.
    let contentKey = $derived(conversationShown ? "conversation" : peopleListShown ? "people" : "notice");

    // The fade of the content when the card swaps between its views: `--k-dur-fast` on `--k-ease-out-expo`, and only
    // opacity, so the card itself does not move (tests/front/Style pins both to the tokens). It is a local `in:`, so it
    // plays when the key changes and not when the card opens, which is the card's own entrance (and not when the shell
    // appears with the card already open, at room entry). Where `Element.animate` is missing (jsdom) it is instant.
    const SWAP_FADE_MS = 150;
    const swapEasing = cubicBezier(0.16, 1, 0.3, 1);
    function swap(node: Element): TransitionConfig {
        if (typeof node.animate !== "function") return { duration: 0 };
        return fade(node, { duration: SWAP_FADE_MS, easing: swapEasing });
    }

    // The key of the search shortcut as it reads on this keyboard: ⌘K on a Mac, Ctrl K elsewhere.
    const searchKeys = combinationKeys(
        { label: "K", mod: true, alt: false, shift: false },
        { mac: isMac(), shift: "" },
    );
    const searchShortcutLabel = searchKeys.join(searchKeys[0] === "⌘" ? "" : " ");

    onMount(() => followShell(() => isWideScreen(window.innerWidth)));

    // Whether the focus is inside the panel as it closes. This runs before the update that makes the card inert, so
    // it must stay above the template: afterwards the focus is on the page whether it was in the panel or not.
    let focusWasInPanel = false;
    $effect.pre(() => {
        focusWasInPanel = view === "closed" && (panel?.contains(document.activeElement) ?? false);
    });

    // Closing the panel takes the focus from the element that had it; hand it to the button that reopens that view. The
    // card is not removed as it closes: it leaves through its exit, inert, and Svelte sets that at once, so the browser
    // takes the focus off whatever the card held. This runs in the same update, where the browser may not have moved the
    // focus yet: an element of the leaving card that still has it counts as the focus left on the page.
    let lastOpenView: SidePanelView = "closed";
    $effect(() => {
        if (view !== "closed") {
            lastOpenView = view;
            return;
        }
        const closedView = lastOpenView;
        // A close is handled once: the rail drawn again after a loader is not another close.
        lastOpenView = "closed";
        if (closedView === "closed") return;
        // What lets the game's keys through again belongs to the close and not to the card's removal, which comes after
        // the exit: the people panel's own cleanup is that removal, and until then a field that lost the focus to
        // `inert` would go on blocking the keys if the browser sends it no `blur`. Escape and Ctrl+K keep working, as
        // they are the window's.
        if (focusWasInPanel) chatInputFocusStore.set(false);
        const button = focusAfterClose({
            closedView,
            focusWasInPanel,
            focusIsOnPage:
                document.activeElement === document.body || (panel?.contains(document.activeElement) ?? false),
            wideScreen: isWideScreen(window.innerWidth),
        });
        if (button !== undefined) elementOf(button)?.focus();
    });

    // The game is told its area as soon as the frame is laid out, which is before the chrome is drawn, and not again when
    // the chrome appears: the scene takes the size it keeps while it is still hidden, and so is sized once. This effect reads
    // the frame's own store and not the shell's: a re-run would publish "the window" for a moment, and that is a second
    // resize of the scene.
    $effect(() => {
        if (!$shellFramedStore || !viewport) {
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

    // Tells the game how wide a strip of its start edge the card covers, as the browser laid it out: the box is not
    // drawn (so it measures 0) on a phone, where the card is a sheet, and beside a co-website, where it has a column.
    const reportCoveredStart: Attachment<HTMLElement> = (element) => {
        const measure = () => gameViewportCoveredStart.set(Math.round(element.getBoundingClientRect().width));
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => {
            observer.disconnect();
            gameViewportCoveredStart.set(0);
        };
    };

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
        class="logo k-press"
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
    class:konclui={$shellFramedStore}
    class:settling={$shellSettlingStore}
    class:panel-open={panelOpen}
    class:shares-map={$coWebsites.length > 0}
    data-testid={$shellActiveStore ? "konclui-shell" : undefined}
>
    {#if $shellActiveStore}
        <!-- One pill follows the pointer, or the keyboard focus, from button to button (Utils/glide.ts); the pressed
             button keeps its own fill. -->
        <nav class="rail k-glide" aria-label={$LL.konclui.office()} {@attach glide({ item: "button" })}>
            {@render logoButton(false)}
            <button
                class="k-press"
                type="button"
                aria-label={$LL.konclui.peopleList.searchLabel()}
                title={$LL.konclui.peopleList.searchShortcut({ keys: searchShortcutLabel })}
                onclick={searchPeople}
            >
                <IconSearch font-size="20" />
            </button>
            <button
                class="k-press"
                type="button"
                aria-label={$LL.konclui.people()}
                aria-pressed={peopleShown}
                aria-controls={panelOpen ? PANEL_ID : undefined}
                onclick={togglePeople}
                bind:this={peopleButton}
            >
                <IconUsersGroup font-size="20" />
            </button>
            <button
                class="k-press"
                type="button"
                aria-label={$LL.konclui.chat()}
                aria-pressed={conversationShown}
                aria-controls={panelOpen ? PANEL_ID : undefined}
                onclick={toggleChat}
                bind:this={chatButton}
            >
                <IconMessageCircle2 font-size="20" />
            </button>
            <button
                class="settings k-press"
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
                    controls={panelOpen ? PANEL_ID : undefined}
                    onclick={togglePeople}
                />
            </div>
            <PlaceChip />
        </div>
        <!-- The card exists while the panel is open and for the length of its exit. The transition is on the element
             directly under the `{#if}`: only there does Svelte keep the card, and what is in it, in the page until the
             exit has played (the chat inside has a block of its own that closing would switch, and a blank card would
             slide away). The `{#if}` is local, so the card plays its entrance when the panel opens and its exit when it
             closes, and nothing plays when the shell appears with the panel already open, as the room's entry does while
             the loader fades, or goes with it. -->
        {#if panelOpen}
            <aside
                id={PANEL_ID}
                bind:this={panel}
                class="side-panel"
                data-konclui-panel
                aria-label={conversationShown ? $LL.konclui.chat() : $LL.konclui.peoplePanel()}
                transition:surface
            >
                {#key contentKey}
                    <div class="content" in:swap>
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
                                    onclick={closeRosterNotice}
                                >
                                    <IconChevronLeft font-size="18" />
                                </button>
                            </header>
                            <p class="notice" role="status">{$LL.konclui.rosterUnavailable()}</p>
                        {/if}
                    </div>
                {/key}
            </aside>
        {/if}
        <!-- The strip of the map under the card, as a box of its own. It is the camera's blocker and the width the HUD
             leaves free, and it is never animated: the card moves while it enters, and a blocker measures its element
             again only when a CSS transition or animation of that element starts or ends, which a card that enters
             through a Svelte transition never does. The box follows the state and not the card: it is a block of its own,
             without a transition, so it is mounted as the card starts to enter and gone as the card starts to leave, and
             the camera and the HUD move with the card instead of after it. It is not drawn where the card is not over the
             map. It takes no click: the strip beside the card is map. -->
        {#if panelOpen}
            <div
                class="panel-reserve"
                aria-hidden="true"
                data-konclui-panel-reserve
                {@attach blocker}
                {@attach reportCoveredStart}
            ></div>
        {/if}
        <WalkNotice live />
        <OfficeMenu />
    {/if}
    <!-- The office's area, named while the shell is drawn. It is the page's main landmark, and a region while upstream
         draws a <main> of its own inside it (the warning banner): a page has one main landmark. -->
    <div
        class="viewport"
        bind:this={viewport}
        role={$viewportLandmarkStore}
        aria-label={$viewportLandmarkStore === undefined ? undefined : $LL.konclui.office()}
    >
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
        --panel-shadow: 0 8px 32px #0008;
        display: grid;
        grid-template-columns: var(--rail-width) minmax(0, 1fr);
        gap: 0;
        /* The gap is on the side the map is: the end. The card and the strip stand at `inset-inline-start: var(--rail-width)`,
           so a padding on the physical right would put the rail and the map 6 px off from them in a page that reads
           right to left. */
        padding-block: var(--frame-gap);
        padding-inline: 0 var(--frame-gap);
        box-sizing: border-box;
        background: var(--k-page);
        color: var(--k-fg);
        font-family: Urbanist, system-ui, sans-serif;
    }
    /* The grid is the same two columns with the panel open or closed. From 768 px up the card floats over the map's
       start edge (see .side-panel), so the map's cell, and the canvas in it, keep their size and their zoom. A third
       column re-fitted the canvas and, on some windows, took the zoom to another step: measured 2026-11-24, 1.5 to 1.0
       at 1057 px wide. Only beside a co-website does the card keep a column: the page and the game split the cell, and
       the split is not made under the card. (A phone's frame is a block, so the columns say nothing there.) */
    .konclui.panel-open.shares-map {
        grid-template-columns: var(--rail-width) var(--panel-width) minmax(0, 1fr);
    }
    /* The map's column is the last one, named, because the rail and the side panel are drawn after the frame is laid out:
       in the order of the markup the map would take the first free column until they are. */
    .konclui .viewport {
        grid-column: -2 / -1;
        border-radius: var(--k-radius-surface);
        background: var(--k-card);
    }
    /* The loading screen is as large as the window and sits in the game element. While the frame is laid out it stands on
       the window itself, so it keeps covering all of it from the frame's first moment and does not move with the map.
       The rule is for the whole life of the frame and not only for the settling: the screen fades out for 800 ms after the
       chrome is drawn (LoaderScene.svelte), and standing in the map's cell again for that time would move a visible box
       from the window into the cell. It fades over the chrome instead, and the office comes up under it as one. */
    .konclui :global(#game > .bg-contrast > .h-dvh) {
        position: fixed;
    }
    /* The map's box moves from the whole window into the frame as the frame is laid out, which is before the scene is
       revealed. Chrome counts that as a layout shift for every box that is visible while it moves, the map's box and
       whatever it holds (the game element, the canvas, Phaser's DOM container), and does not count a box that is not
       visible: so the box is held while it settles, with all it holds, and is revealed with the chrome, at the size it
       keeps. Only the loading screen shows through, and it does not move: it stands on the window (the rule above), so
       what the user sees over the move is the same screen at the same place. */
    .konclui.settling .viewport {
        visibility: hidden;
    }
    .konclui.settling :global(#game > .bg-contrast > .h-dvh) {
        visibility: visible;
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
    /* The pill (Utils/glide.ts) is the hover: it follows the pointer, or the keyboard focus, from button to button, so
       a button paints no fill of its own while the pill exists (`k-glide-on` is on the rail then). The pill is drawn
       only where there is a pointer to hover, and so is the fill it replaces: a tap leaves neither behind. The pressed
       button keeps its fill and its colour whatever the pill does. */
    @media (hover: hover) {
        .rail:not(:global(.k-glide-on)) button:hover {
            background: var(--k-elevated);
        }
    }
    .rail :global(.k-glide-pill) {
        border-radius: 10px;
        background: var(--k-elevated);
    }
    .rail button[aria-pressed="true"] {
        background: var(--k-elevated);
        color: var(--k-accent);
    }
    /* Forced colours drop the fill that marks the pressed button: an outline keeps it readable. The focus ring has the
       outline when the button has the focus. */
    @media (forced-colors: active) {
        .rail button[aria-pressed="true"]:not(:focus-visible) {
            outline: 2px solid Highlight;
            outline-offset: -2px;
        }
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
    /* It comes from the rail, 24 px to its left, through the transition on the card (`transition:surface`, which reads
       these variables and plays the exit as well). Only this card moves (opacity and transform), and the map under it
       does not: a column that animated re-fitted the map's canvas every frame and blanked it mid-slide, measured
       2026-11-20. */
    .side-panel {
        --k-enter-x: -24px;
        --k-enter-y: 0px;
        position: relative;
        margin-right: var(--frame-gap);
        min-width: 0;
        min-height: 0;
        border-radius: var(--k-radius-surface);
        background: var(--k-card);
        overflow: hidden;
    }
    /* What the card holds, as one box: the chat, the people panel or the notice each fill the card, and this box is what
       fades in when the card swaps between them. */
    .content {
        height: 100%;
        min-height: 0;
    }
    /* The strip of the map under the card: the camera's blocker, and the width the HUD leaves free. Not drawn unless
       the card floats over the map, so it measures 0 and blocks nothing on a phone and beside a co-website. */
    .panel-reserve {
        display: none;
    }
    /* From 768 px up the card floats over the map, beside the rail, at the size its column gave it: 290 px, and the
       6 px beside it that the HUD and the camera leave free as well. It stands over the canvas and the name tags
       (Phaser's DOM layer is a stacking context at level 0) and under the HUD, whose layer is #main-layout (z-index
       10): what the HUD draws over the whole window (a fullscreen video, a modal with its scrim, a popup centred on the
       window) covers the card as it covers the rest of the map, and the HUD's own content already stands beside the
       strip. A click on the card is a click on the card (#main-layout takes none where it draws nothing), and Phaser
       takes a press whose target is not the canvas as outside the game. Beside a co-website the card keeps its column
       instead (see the grid above);
       who gets the space between 768 and 1023 px then is the owner's to decide, and today the panel does. That card
       floats as well while it leaves: its column is gone as the exit starts (the frame is no longer `panel-open`), and
       a grid item that is held for the exit would be placed in the next free cell. It floats where its column was, so
       it does not move. */
    @media (min-width: 768px) {
        .konclui:not(.shares-map.panel-open) .side-panel {
            position: absolute;
            top: var(--frame-gap);
            bottom: var(--frame-gap);
            inset-inline-start: var(--rail-width);
            width: calc(var(--panel-width) - var(--frame-gap));
            margin: 0;
            z-index: 5;
            box-shadow: var(--panel-shadow);
        }
        .konclui:not(.shares-map) .panel-reserve {
            display: block;
            position: absolute;
            top: var(--frame-gap);
            bottom: var(--frame-gap);
            inset-inline-start: var(--rail-width);
            width: var(--panel-width);
            pointer-events: none;
        }
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
    @media (hover: hover) {
        header button:hover {
            background: var(--k-hover);
        }
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
    @media (hover: hover) {
        .logo-slot .logo:hover {
            background-color: var(--k-hover);
        }
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
            box-shadow: var(--panel-shadow);
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
