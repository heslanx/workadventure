<script lang="ts">
    import { fade } from "../../Utils/reducedMotion";
    import type { ProximityNotification } from "../../Stores/ProximityNotificationStore";
    import { chatNotificationStore } from "../../Stores/ProximityNotificationStore";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
    import { navChat } from "../../Chat/Stores/ChatStore";
    import LL from "../../../i18n/i18n-svelte";
    import Avatar from "../../Chat/Components/Avatar.svelte";
    import { autoDismiss } from "../Toasts/autoDismiss";
    import { focusNotificationTarget } from "./NotificationRoomFocus";
    import { IconX } from "@wa-icons";

    interface Props {
        notification: ProximityNotification;
    }

    let { notification }: Props = $props();

    let roomType = $derived(notification.room.type);
    let roomName = $derived(notification.room.name);

    const NOTIFICATION_DURATION = 10000; // 10 seconds, held while the pointer is over the card or the focus is in it

    function dismiss() {
        chatNotificationStore.removeNotification(notification.id);
    }

    function handleClick() {
        chatVisibilityStore.set(true);
        navChat.switchToChat();

        if (notification.openRoomOnClick !== false) {
            const room = notification.room;
            chatNotificationStore.clearRoom(room.id);
            room.setTimelineAsRead();
            selectedRoomStore.set(room);
            focusNotificationTarget(room, notification.messageId, notification.sidePanelSection);
        } else {
            chatNotificationStore.clearAll();
            // Open the chat on the main chat panel
            selectedRoomStore.set(undefined);
        }
    }
</script>

<!-- The card is not the control: opening the chat is the content area, and the close button next to it dismisses
     the notification without opening anything. -->
<div
    class="proximity-notification bg-contrast/95 backdrop-blur-md flex items-start gap-1 pr-2 shadow-lg pointer-events-auto z-[900] hover:bg-contrast transition-colors text-white w-[60%] min-w-[300px] max-w-[600px] {notification.mention
        ? 'rounded border border-solid border-danger/60'
        : 'rounded'}"
    out:fade={{ duration: 150 }}
    {@attach autoDismiss(NOTIFICATION_DURATION, dismiss)}
>
    <div
        class="flex flex-1 min-w-0 gap-3 py-3 cursor-pointer {notification.mention ? 'pl-3.5' : 'pl-5'}"
        onclick={handleClick}
        role="button"
        tabindex="0"
        onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleClick();
            }
        }}
    >
        {#if notification.mention}
            <div class="relative mt-0.5 flex-shrink-0 self-start">
                <Avatar
                    pictureStore={notification.mention.pictureStore}
                    fallbackName={notification.userName}
                    color={notification.mention.color ?? null}
                />
                <span
                    class="absolute -bottom-1.5 -end-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-solid border-contrast bg-danger-1000 text-xxs font-bold"
                    aria-hidden="true">@</span
                >
            </div>
        {:else}
            <div class="mt-1 text-white text-xl flex-shrink-0" aria-hidden="true">💬</div>
        {/if}

        <div class="flex flex-col text-white flex-1 min-w-0 overflow-hidden">
            {#if notification.mention}
                <div class="mb-1 flex items-center gap-2">
                    <div class="min-w-0 line-clamp-2 font-bold text-base font-['Roboto_Condensed'] tracking-normal">
                        {$LL.notification.mention({ name: notification.userName })}
                    </div>
                    {#if $roomType !== "direct"}
                        <span
                            class="ms-auto min-w-0 max-w-[45%] truncate rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/85"
                            title={$roomName}>{$roomName}</span
                        >
                    {/if}
                </div>
            {:else}
                <div
                    class="font-bold mb-1 text-base text-white truncate font-['Roboto_Condensed'] tracking-normal align-middle"
                >
                    {notification.userName}
                    {#if $roomType !== "direct"}
                        {$LL.chat.notification.in()}
                        {$roomName}
                    {/if}
                </div>
            {/if}
            <div
                data-testid="proximity-notification-message"
                class="font-['Roboto_Condensed'] font-normal text-base leading-[24px] tracking-normal text-white line-clamp-2"
            >
                {notification.message}
            </div>
        </div>
    </div>
    <button
        type="button"
        class="shrink-0 flex items-center justify-center w-8 h-8 p-0 m-0 mt-2 rounded cursor-pointer text-white/80 bg-transparent border-0 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        aria-label={$LL.notification.closeToast()}
        title={$LL.notification.closeToast()}
        onclick={dismiss}
    >
        <IconX font-size="1.125rem" aria-hidden="true" />
    </button>
</div>

<style>
    @keyframes slide-up {
        from {
            transform: translateY(100%);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    .proximity-notification {
        animation: slide-up 0.3s ease-out;
    }
</style>
