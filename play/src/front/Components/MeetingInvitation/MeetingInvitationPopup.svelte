<script lang="ts">
    import type { Attachment } from "svelte/attachments";
    import { get } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { meetingInvitationRequestStore } from "../../Stores/MeetingInvitationStore";
    import { liveAnnouncementStore } from "../../Stores/LiveAnnouncementStore";
    import { inputFormFocusStore } from "../../Stores/UserInputStore";
    import Button from "../UI/Button.svelte";
    import WokaFromUserId from "../Woka/WokaFromUserId.svelte";
    import { IconUsersGroup } from "@wa-icons";

    let request = $derived($meetingInvitationRequestStore);

    const titleId = "meeting-invitation-title";

    /**
     * An invitation waits for an answer: focus moves to the dialog itself, not to Accept or Decline, so one stray
     * Enter or Space cannot join a meeting or turn somebody down. Nobody typing is interrupted: the invitation is
     * then read out through the live announcer instead.
     */
    const askForAnswer: Attachment<HTMLElement> = (element) => {
        if (get(inputFormFocusStore)) {
            liveAnnouncementStore.announce($LL.chat.meetingInvitation.title({ name: request?.senderName ?? "" }));
            return;
        }
        element.focus({ preventScroll: true });
    };

    function onAccept() {
        gameManager.getCurrentGameScene().inviteManager?.handleAccept({
            senderUserUuid: request?.senderUserUuid ?? "",
            senderPlayUri: request?.senderPlayUri ?? "",
            senderName: request?.senderName ?? "",
            senderUserId: request?.senderUserId ?? 0,
        });
        meetingInvitationRequestStore.set(null);
    }

    function onDecline() {
        gameManager.getCurrentGameScene().inviteManager?.handleDecline({
            senderUserUuid: request?.senderUserUuid ?? "",
            senderPlayUri: request?.senderPlayUri ?? "",
            senderName: request?.senderName ?? "",
            senderUserId: request?.senderUserId ?? 0,
        });
        meetingInvitationRequestStore.set(null);
    }
</script>

<div
    class="m-auto my-0 h-fit min-h-fit max-w-lg min-w-48 max-sm:max-w-[89%] z-50 bg-contrast/95 transition-all backdrop-blur rounded-lg pointer-events-auto overflow-hidden md:mr-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    data-testid="meeting-invitation-popup"
    role="alertdialog"
    aria-labelledby={titleId}
    tabindex="-1"
    {@attach askForAnswer}
>
    <div class="p-4 flex flex-col gap-4">
        <div class="flex items-start gap-3">
            <div
                class="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden relative"
                aria-hidden="true"
            >
                {#if request?.senderUserUuid}
                    <div class="absolute inset-0 flex items-center justify-center">
                        <WokaFromUserId userId={request?.senderUserUuid} placeholderSrc="" customWidth="40px" />
                    </div>
                {:else}
                    <IconUsersGroup font-size="20" class="text-white" />
                {/if}
            </div>
            <div class="flex-1 min-w-0 pt-0.5">
                <p id={titleId} class="text-sm text-white/95 leading-normal wrap-anywhere">
                    {$LL.chat.meetingInvitation.title({ name: request?.senderName ?? "" })}
                </p>
            </div>
        </div>
    </div>
    <div class="flex items-center bg-contrast w-full justify-center flex-row">
        <Button
            variant="light"
            appearance="ghost"
            class="text-nowrap my-2 mx-1 min-w-0 !border !border-solid !border-transparent hover:!bg-white/30"
            onclick={onAccept}
        >
            {$LL.chat.accept()}
        </Button>
        <Button
            variant="light"
            appearance="ghost"
            class="text-nowrap my-2 mx-1 min-w-0 !border !border-solid !border-transparent hover:!border hover:!border-solid hover:!border-white/30 hover:!bg-transparent"
            onclick={onDecline}
        >
            {$LL.chat.decline()}
        </Button>
    </div>
</div>
