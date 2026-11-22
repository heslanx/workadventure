<script lang="ts">
    import { navChat } from "../../../Chat/Stores/ChatStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import MessageCircleIcon from "../../Icons/MessageCircleIcon.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { activeSubMenuStore, menuVisiblilityStore } from "../../../Stores/MenuStore";
    import { chatVisibilityStore, chatZoneLiveStore } from "../../../Stores/ChatStore";
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { selectedRoomStore } from "../../../Chat/Stores/SelectRoomStore";
    import { chatNotificationStore } from "../../../Stores/ProximityNotificationStore";
    import { matrixUnreadMessagesCountStore } from "../../../Chat/Stores/UnreadMessagesCountStore";

    interface Props {
        last?: boolean;
        chatEnabledInAdmin?: boolean;
        onclick?: () => void;
    }

    let { last = undefined, chatEnabledInAdmin = false, onclick }: Props = $props();

    const proximityChatRoomManager = gameManager.getCurrentGameScene().proximityChatRoomManager;
    const unreadMessagesCount = proximityChatRoomManager.unreadMessagesCount;

    function toggleChat() {
        if (!$chatVisibilityStore) {
            menuVisiblilityStore.set(false);
            activeSubMenuStore.activateByIndex(0);
        }

        chatVisibilityStore.set(!$chatVisibilityStore);
        onclick?.();
    }

    const shortcut = ["c"];

    // The chat connection starts once the scene is playable and the browser is idle, or when the panel is opened. An
    // attempt that has not started ("idle") accepts the click: opening the panel is what starts it, and the panel
    // shows a loader until it is up. A failed attempt opens the panel too, which explains the failure and offers
    // Retry. The button stays usable while the panel is open, so the player can close it whatever the attempt does.
    const chatConnectionAttemptStore = gameManager.chatConnectionAttemptStore;
    let chatAvailable = $derived(
        $chatConnectionAttemptStore === "ready" ||
            $chatConnectionAttemptStore === "failed" ||
            $chatConnectionAttemptStore === "idle" ||
            $chatVisibilityStore,
    );

    // Calculate total unread count and format it (max 99+)
    let totalUnreadCount = $derived($matrixUnreadMessagesCountStore + $unreadMessagesCount);
    let displayCount = $derived(totalUnreadCount > 99 ? "99" : totalUnreadCount.toString());
</script>

<ActionBarButton
    onclick={() => {
        toggleChat();
        navChat.switchToChat();
        if (!chatEnabledInAdmin) {
            const proximityChatRoom = proximityChatRoomManager.resolveTargetRoom();
            if (proximityChatRoom) {
                selectedRoomStore.set(proximityChatRoom);
                proximityChatRoom.hasUnreadMessages.set(false);
                proximityChatRoom.unreadMessagesCount.set(0);
                chatNotificationStore.clearRoom(proximityChatRoom.id);
                proximityChatRoom.unreadNotificationCount.set(0);
            }
        }
        // toggleChat() has already flipped the store, so this reads the NEW state.
        // Reporting unconditionally counted the click that CLOSES the panel as an
        // opening too, which is why menu_opened_chat has always run at roughly twice
        // the real figure.
        if ($chatVisibilityStore) {
            analyticsClient.trackAdminEvent("chat.opened");
        }
    }}
    classList="group/btn-message-circle rounded-r-lg pe-2 {last ? '' : '@sm/actions:rounded-r-none @sm/actions:pe-0'}"
    tooltipTitle={$LL.actionbar.help.chat.title()}
    desc={$LL.actionbar.help.chat.desc()}
    media="./static/Videos/Chat.mp4"
    tooltipShortcuts={shortcut}
    dataTestId="chat-btn"
    state={chatAvailable ? "normal" : "disabled"}
    blockedReason={chatAvailable ? undefined : $LL.actionbar.blocked.chatConnecting()}
    {last}
    disabledHelp={false}
>
    <MessageCircleIcon height="h-5" width="w-5" strokeWidth="2" />
</ActionBarButton>
{#if $chatZoneLiveStore || totalUnreadCount > 0}
    <div aria-hidden="true">
        <span class="w-4 h-4 block rounded-full absolute -top-1 -start-1 animate-ping motion-reduce:hidden bg-white"
        ></span>
        <span class="w-3 h-3 block rounded-full absolute -top-0.5 -start-0.5 bg-white"></span>
    </div>
{/if}
{#if totalUnreadCount > 0}
    <div
        class="absolute -top-2 -start-2 aspect-square flex w-5 h-5 items-center justify-center text-sm font-bold leading-none text-contrast bg-success rounded-full z-10"
        data-testid="unreadMessagesCount"
        aria-hidden="true"
    >
        <span>{displayCount}</span>
        {#if totalUnreadCount > 99}
            <span class="text-xxs">+</span>
        {/if}
    </div>
    <span class="sr-only">{$LL.chat.a11y.unreadCount({ count: totalUnreadCount })}</span>
{/if}
