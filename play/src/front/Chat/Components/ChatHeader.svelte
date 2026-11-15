<script lang="ts">
    import { onDestroy } from "svelte";
    import { asError } from "catch-unknown";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    let searchActive = $state(false);
    import { chatSearchBarValue, navChat, joignableRoom } from "../Stores/ChatStore";
    import LoadingSmall from "../images/loading-small.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
    import { hideActionBarStoreBecauseOfChatBar } from "../ChatSidebarWidthStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { hasMatrixChatCapabilities } from "../Connection/ChatConnection";
    import OnlineUsersCount from "./OnlineUsersCount.svelte";
    import ChatActionMenu from "./ChatActionMenu.svelte";
    import { IconMessageCircle2, IconUsers } from "@wa-icons";

    const gameScene = gameManager.getCurrentGameScene();
    const chat = gameManager.chatConnection;
    const showChatButton = gameScene.room.isChatEnabled;
    const showUserListButton = gameScene.room.isChatOnlineListEnabled;
    const showNavBar = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
    const userProviderMergerPromise = gameScene.userProviderMerger;
    const chatStatusStore = chat.connectionStatus;
    let typingTimer: ReturnType<typeof setTimeout>;
    let searchLoader = $state(false);
    // Set when the last room search or user filter failed, so the list is not mistaken for "no result".
    let searchFailed = $state(false);
    const DONE_TYPING_INTERVAL = 2000;

    // ChatSidebar floats its own close button over this header as soon as a room is selected, so the
    // menu must drop its close there or the two stack up.
    let isInSpecificDiscussion = $derived($selectedRoomStore !== undefined);

    function handleToggleSearch() {
        searchActive = !searchActive;

        if (!searchActive) clearSearch();
    }

    function clearSearch() {
        clearTimeout(typingTimer);
        searchFailed = false;
        chatSearchBarValue.set("");
        joignableRoom.set([]);
        // The user providers are shared and keep the text of the last search: reset their filter too,
        // or the user list stays filtered while the search bar shows nothing.
        userProviderMergerPromise
            .then((userProviderMerger) => userProviderMerger.setFilter(""))
            .catch((e) => console.error(e));
    }

    const handleKeyDown = () => {
        if ($chatSearchBarValue === "") joignableRoom.set([]);
        clearTimeout(typingTimer);
    };

    const handleKeyUp = (userProviderMerger: UserProviderMerger) => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => runSearch(userProviderMerger), DONE_TYPING_INTERVAL);
    };

    // One entry point for both sources the search drives (joinable rooms and the user filter),
    // so typing and "Search again" apply the same text to both.
    function runSearch(userProviderMerger: UserProviderMerger) {
        const searchValue = $chatSearchBarValue;
        searchLoader = true;
        searchFailed = false;
        const roomSearch =
            $navChat.key === "chat" && searchValue.trim() !== ""
                ? chat.searchAccessibleRooms(searchValue).then((chatRooms) => {
                      joignableRoom.set(chatRooms);
                  })
                : Promise.resolve();
        Promise.allSettled([roomSearch, userProviderMerger.setFilter(searchValue)])
            .then((results) => {
                for (const result of results) {
                    if (result.status === "rejected") {
                        console.error("Chat search failed", asError(result.reason));
                        searchFailed = true;
                    }
                }
            })
            .catch((e) => console.error("Chat search failed", asError(e)))
            .finally(() => {
                searchLoader = false;
            });
    }

    function focusChatInput() {
        // Disable input manager to prevent the game from receiving the input
        chatInputFocusStore.set(true);
    }
    function unfocusChatInput() {
        // Enable input manager to allow the game to receive the input
        chatInputFocusStore.set(false);
    }

    onDestroy(() => {
        clearSearch();
    });
</script>

<div class=" relative p-2 flex items-center w-full z-40">
    <div class={searchActive ? "hidden" : ""}>
        {#if showNavBar}
            {#if $navChat.key === "chat" && showUserListButton}
                <button
                    class="userList p-3 hover:bg-white/10 rounded aspect-square w-12 h-12 !text-white"
                    onclick={() => navChat.switchToUserList()}
                >
                    <IconUsers font-size="20" />
                </button>
            {:else if showChatButton}
                <button
                    class="p-3 hover:bg-white/10 rounded aspect-square w-12 h-12 !text-white"
                    onclick={() => navChat.switchToChat()}
                >
                    <IconMessageCircle2 font-size="20" />
                </button>
            {/if}
        {/if}
    </div>
    <div class="flex flex-col items-center justify-center grow">
        <div class="text-md font-bold h-5 {searchActive ? 'hidden' : ''}">
            {#if $navChat.key === "chat"}
                {$LL.chat.chat()}
            {:else}
                {$LL.chat.users()}
            {/if}
        </div>
        {#if gameScene.room.isChatOnlineListEnabled}
            <OnlineUsersCount {searchActive} />
        {/if}
    </div>
    <div class="relative">
        <ChatActionMenu
            {searchActive}
            hasCloseChat={$hideActionBarStoreBecauseOfChatBar && !isInSpecificDiscussion}
            hasSearch={$chatStatusStore !== "OFFLINE" && !isInSpecificDiscussion}
            matrixChatConnection={hasMatrixChatCapabilities(chat) ? chat : undefined}
            onToggleSearch={handleToggleSearch}
        />
    </div>
    <!-- searchbar -->
    {#if searchActive && $chatStatusStore !== "OFFLINE"}
        {#await userProviderMergerPromise}
            <div></div>
        {:then userProviderMerger}
            <div class="absolute w-full h-full z-40 right-0 top-0 bg-contrast/30">
                <input
                    autocomplete="new-password"
                    class="block text-white placeholder:text-white/60 w-full placeholder:text-sm border-none pl-6 pr-20 bg-transparent py-3 text-base h-full"
                    placeholder={$navChat.key === "users" ? $LL.chat.searchUser() : $LL.chat.searchChat()}
                    onkeydown={handleKeyDown}
                    onkeyup={() => handleKeyUp(userProviderMerger)}
                    bind:value={$chatSearchBarValue}
                    onfocusin={focusChatInput}
                    onfocusout={unfocusChatInput}
                />
                {#if searchLoader}
                    <div class="absolute right-4 top-1/2 transform -translate-y-1/2">
                        <LoadingSmall />
                    </div>
                {/if}
                {#if searchFailed && !searchLoader}
                    <div
                        class="absolute left-0 top-full w-full flex items-center justify-between gap-2 px-4 py-2 bg-danger-900 text-white text-sm"
                        role="alert"
                    >
                        <span>{$LL.chat.searchFailed()}</span>
                        <button
                            type="button"
                            class="shrink-0 cursor-pointer rounded px-2 py-1 font-bold underline hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                            onclick={() => runSearch(userProviderMerger)}
                        >
                            {$LL.chat.searchRetry()}
                        </button>
                    </div>
                {/if}
            </div>
        {/await}
    {/if}
</div>
