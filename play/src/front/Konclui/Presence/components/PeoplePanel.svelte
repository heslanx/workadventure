<script lang="ts">
    import { onMount } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { isMac } from "../../../WebRtc/DeviceUtils";
    import { chatInputFocusStore } from "../../../Stores/ChatStore";
    import { combinationKeys } from "../../Preferences/domain/shortcutKeys";
    import { escapeInSearch, matchesName } from "../domain/peopleSearch";
    import { isRowKey, rowAfterKey } from "../domain/rowNavigation";
    import { EVERYONE_ROWS } from "../domain/rosterWatch";
    import { placeName } from "../domain/place";
    import { peoplePanelStore } from "../stores/peopleListStore";
    import { goToPerson } from "../stores/presenceCommands";
    import {
        clearSearchFocusRequest,
        peopleQueryStore,
        searchFocusRequestStore,
        setPeopleQuery,
    } from "../stores/peopleSearchStore";
    import { chooseEveryone, rosterListOpenStore } from "../stores/worldRoster";
    import PersonRow from "./PersonRow.svelte";
    import WalkNotice from "./WalkNotice.svelte";
    import { IconChevronDown, IconChevronLeft, IconMapPin, IconSearch } from "@wa-icons";

    // The people of the office: who is online, near you or everyone, with a search and a way to walk to each one. The
    // shell draws it in its side panel while the people view is open. It lives only as long as it is on screen, and that
    // is what asks the world roster to be watched: closed, nothing is subscribed.
    // `onWalk` is told after a row started a walk: on a phone the shell closes the sheet then, so the walk can be seen.
    let { onCollapse, onWalk }: { onCollapse: () => void; onWalk?: () => void } = $props();

    let panel = $derived($peoplePanelStore);
    let query = $derived($peopleQueryStore);
    let input: HTMLInputElement | undefined = $state();
    let list: HTMLElement | undefined = $state();
    let sectionOpen = $state(true);

    const shortcut = combinationKeys({ label: "K", mod: true, alt: false, shift: false }, { mac: isMac(), shift: "" });
    const shortcutLabel = shortcut.join(shortcut[0] === "⌘" ? "" : " ");

    onMount(() => {
        rosterListOpenStore.set(true);
        return () => {
            rosterListOpenStore.set(false);
            // What was typed belongs to this opening of the panel, and typing stops the game's keys until blur. What was
            // said of a walk does not: the sheet closes on a phone as the walk starts, and the shell's live region goes
            // on announcing it. The notice fades on its own.
            setPeopleQuery("");
            clearSearchFocusRequest();
            chatInputFocusStore.set(false);
        };
    });

    // The search button of the rail and the shortcut ask for the field; a panel that was just opened for them takes the
    // request as soon as its field exists.
    $effect(() => {
        if (!$searchFocusRequestStore || input === undefined) return;
        input.focus({ preventScroll: true });
        input.select();
        clearSearchFocusRequest();
    });

    let youShown = $derived(panel.me !== undefined && matchesName(panel.me.name, query));
    let youPlace = $derived(
        panel.me?.place === undefined
            ? undefined
            : placeName(panel.me.place, {
                  entrance: $LL.konclui.place.entrance(),
                  hall: $LL.konclui.place.hall(),
                  outside: $LL.konclui.place.outside(),
              }),
    );
    let youRow = $derived(
        panel.me === undefined
            ? undefined
            : {
                  key: "you",
                  uuid: "",
                  playUri: "",
                  name: panel.me.name,
                  place: panel.me.place,
                  status: panel.me.status,
                  elsewhere: false,
                  roomName: undefined,
              },
    );
    // The first of the people the window cut: the count the panel is cut from is the world's, or the matches of a search.
    let cutTotal = $derived(
        panel.cutOf === undefined ? undefined : panel.searching ? panel.cutOf : Math.max(panel.count, panel.cutOf),
    );
    let emptyText = $derived(
        panel.empty === "noMatch"
            ? $LL.konclui.peopleList.nobodyMatches()
            : panel.empty === "nobodyNearbyMatches"
              ? $LL.konclui.peopleList.nobodyNearbyMatches()
              : panel.empty === "nobodyNearby"
                ? $LL.konclui.peopleList.nobodyNearby()
                : panel.empty === "alone"
                  ? $LL.konclui.peopleList.nobodyElse()
                  : undefined,
    );

    // Asking for everyone removes the entry that was pressed, and the focus it held would fall to the page: the keys of the
    // panel (the arrows, Escape to close it) would stop reaching it. The list is what changes next, to its loading
    // notice, so the focus waits there.
    function onChooseEveryone() {
        chooseEveryone();
        list?.focus({ preventScroll: true });
    }

    function go(person: Parameters<typeof goToPerson>[0]) {
        goToPerson(person);
        onWalk?.();
    }

    function onSearchKeydown(event: KeyboardEvent) {
        if (event.key === "ArrowDown") {
            // From the field into the list, as the arrows move within it.
            const first = list?.querySelector<HTMLElement>("[data-person-row]");
            if (first === undefined || first === null) return;
            event.preventDefault();
            first.focus();
            return;
        }
        if (event.key !== "Escape") return;
        // Escape clears what was typed first. With nothing to clear it goes on to the shell, which closes the panel.
        if (escapeInSearch(query) !== "clear") return;
        setPeopleQuery("");
        event.preventDefault();
        event.stopPropagation();
    }

    // The arrows, Home and End move along the rows: two hundred people cannot be crossed with Tab alone.
    function onListKeydown(event: KeyboardEvent) {
        if (!isRowKey(event.key) || list === undefined) return;
        const rows = [...list.querySelectorAll<HTMLElement>("[data-person-row]")];
        const target = rows[rowAfterKey(event.key, rows.indexOf(document.activeElement as HTMLElement), rows.length)];
        if (target === undefined) return;
        event.preventDefault();
        target.focus();
    }
</script>

<section class="people-panel" aria-labelledby="konclui-people-title">
    <header>
        <strong id="konclui-people-title">Koncluí</strong>
        <button type="button" aria-label={$LL.konclui.collapsePanel()} onclick={onCollapse}>
            <IconChevronLeft font-size="18" />
        </button>
    </header>

    {#if youPlace !== undefined}
        <p class="here"><IconMapPin font-size="16" aria-hidden="true" /><span>{youPlace}</span></p>
    {/if}

    <label class="search">
        <IconSearch font-size="16" aria-hidden="true" />
        <input
            bind:this={input}
            type="search"
            value={query}
            placeholder={$LL.konclui.peopleList.searchPlaceholder()}
            aria-label={$LL.konclui.peopleList.searchLabel()}
            autocomplete="off"
            spellcheck="false"
            oninput={(event) => setPeopleQuery(event.currentTarget.value)}
            onkeydown={onSearchKeydown}
            onfocus={() => chatInputFocusStore.set(true)}
            onblur={() => chatInputFocusStore.set(false)}
        />
        <kbd aria-hidden="true">{shortcutLabel}</kbd>
    </label>

    <button
        type="button"
        class="section"
        aria-expanded={sectionOpen}
        aria-controls="konclui-people-list"
        onclick={() => (sectionOpen = !sectionOpen)}
    >
        <span>
            {panel.count > 0
                ? $LL.konclui.peopleList.online({ count: panel.count })
                : $LL.konclui.peopleList.onlineUnknown()}
        </span>
        <IconChevronDown class="k-turn" font-size="16" aria-hidden="true" />
    </button>

    <!-- The rows stay on the page while the section is shut: the disclosure shuts its row and, once it has shut, hides
         the list from the keys and from assistive technology, so nothing in it is reached while it is closed. -->
    <div class="reveal k-disclosure" class:is-open={sectionOpen}>
        <div class="k-disclosure-body reveal-body">
            <!-- The arrow keys move among the rows, which are the buttons: the list is a container for them, not a control. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                id="konclui-people-list"
                class="list k-scroll-y"
                tabindex="-1"
                bind:this={list}
                onkeydown={onListKeydown}
            >
                {#if panel.mode === "nearby" && panel.phase === "ready"}
                    <p class="title">{$LL.konclui.peopleList.nearYou()}</p>
                {/if}

                {#if youRow !== undefined && youShown}
                    <div class="rows"><PersonRow row={youRow} you /></div>
                {/if}

                {#if panel.phase === "loading"}
                    <p class="notice" role="status">{$LL.konclui.peopleList.loading()}</p>
                {:else if panel.phase === "unavailable"}
                    <p class="notice" role="status">{$LL.konclui.peopleList.unavailable()}</p>
                {:else}
                    <div class="rows">
                        {#each panel.rows as row (row.key)}
                            <PersonRow
                                {row}
                                liveStatus={panel.users.get(row.key)?.reactiveUser.availabilityStatus}
                                onGo={go}
                            />
                        {/each}
                    </div>
                    {#if emptyText !== undefined}
                        <p class="empty">{emptyText}</p>
                    {/if}
                    {#if cutTotal !== undefined}
                        <p class="cut">
                            {$LL.konclui.peopleList.showingFirst({ shown: panel.rows.length, total: cutTotal })}
                        </p>
                    {/if}
                    {#if panel.canChooseEveryone}
                        <button type="button" class="everyone" onclick={onChooseEveryone}>
                            <b>{$LL.konclui.peopleList.showEveryone()}</b>
                            <small>{$LL.konclui.peopleList.showEveryoneHint({ limit: EVERYONE_ROWS })}</small>
                        </button>
                    {/if}
                {/if}
            </div>
        </div>
    </div>

    <WalkNotice />
</section>

<style>
    .people-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        color: var(--k-fg);
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 18px 12px;
    }
    header strong {
        font-size: 20px;
        font-weight: 700;
    }
    header button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        color: inherit;
        cursor: pointer;
    }
    header button:hover {
        background: var(--k-hover);
    }
    header button:focus-visible,
    .section:focus-visible,
    .everyone:focus-visible {
        outline: 2px solid var(--k-accent);
        outline-offset: 2px;
    }
    .here {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 18px 10px;
        color: var(--k-fg-2);
        font-size: 13px;
    }
    .here span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .search {
        display: flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        height: 40px;
        margin: 0 14px 8px;
        padding: 0 10px;
        border: 1px solid var(--k-border-subtle);
        border-radius: var(--k-radius-menu);
        background: var(--k-elevated);
        color: var(--k-fg-2);
    }
    .search:focus-within {
        border-color: var(--k-accent);
    }
    .search input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--k-fg);
        font: inherit;
        font-size: 14px;
        outline: none;
        /* The label draws the one ring (its mint border, below). The global field style rings a focused input with a
           box-shadow of its own, a second and off-palette one. */
        box-shadow: none;
    }
    .search input::placeholder {
        color: var(--k-fg-muted);
    }
    /* A keyboard hint is for a keyboard: a touch screen has none, and a 16 px field is not zoomed by iOS. */
    kbd {
        flex: none;
        padding: 1px 6px;
        border: 1px solid var(--k-border);
        border-radius: 6px;
        color: var(--k-fg-2);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
    }
    @media (hover: none), (max-width: 767px) {
        kbd {
            display: none;
        }
        .search input {
            font-size: 16px;
        }
    }
    .section {
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-sizing: border-box;
        width: calc(100% - 28px);
        min-height: 36px;
        margin: 0 14px;
        padding: 0 8px;
        border: 0;
        border-radius: var(--k-radius-inner);
        background: transparent;
        color: var(--k-fg-2);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
    /* The list is what takes the height the panel has left, so the disclosure around it takes that height, and the row it
       grows runs from nothing to all of it. The walk notice below keeps its place whether the section is open or shut. */
    .reveal {
        flex: 1;
        min-height: 0;
    }
    .reveal-body {
        display: flex;
        flex-direction: column;
    }
    .list {
        flex: 1;
        min-height: 0;
        padding: 0 8px 8px;
    }
    /* The list takes the focus only from the panel's own code, never from Tab, and the loading notice in it is what it says. */
    .list:focus-visible {
        outline: none;
    }
    .rows {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .title {
        margin: 4px 8px 6px;
        color: var(--k-fg-muted);
        font-size: 12px;
        font-weight: 600;
    }
    .empty,
    .cut,
    .notice {
        margin: 10px 12px;
        color: var(--k-fg-2);
        font-size: 13px;
        line-height: 1.5;
    }
    .cut {
        font-size: 12px;
    }
    .everyone {
        display: block;
        box-sizing: border-box;
        width: 100%;
        margin: 8px 0 0;
        padding: 10px 12px;
        border: 1px dashed var(--k-border);
        border-radius: var(--k-radius-inner);
        background: transparent;
        color: var(--k-fg);
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .everyone b {
        display: block;
        font-size: 14px;
        font-weight: 600;
    }
    .everyone small {
        display: block;
        color: var(--k-fg-2);
        font-size: 12px;
        line-height: 1.5;
    }
    @media (hover: hover) {
        header button:hover,
        .section:hover,
        .everyone:hover {
            background: var(--k-hover);
        }
    }
    /* On a phone the panel is a sheet and the collapse button is a touch target: 44 px, the size a finger needs. */
    @media (max-width: 767px) {
        header button {
            width: 44px;
            height: 44px;
        }
    }
</style>
