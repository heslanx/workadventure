<script lang="ts">
    import { type Writable, get, writable } from "svelte/store";
    import { FilterType } from "@workadventure/messages";
    import MicrophoneCloseSvg from "../images/microphone-close.svg";
    import NoVideoSvg from "../images/no-video.svg";
    import { LL } from "../../../i18n/i18n-svelte";
    import { moderatedMeetingSpacesStore, requestVisitCardsStore, userIsAdminStore } from "../../Stores/GameStore";
    import { raisedHandsOrderStore } from "../../Stores/RaisedHandsStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { meetingOf } from "../../Administration/CurrentMeeting";
    import type { SpaceUserExtended } from "../../Space/SpaceInterface";
    import { openModerationModal } from "../Moderation/openModerationModal";
    import RangeSlider from "../Input/RangeSlider.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import TextToast from "../Toasts/TextToast.svelte";
    import type { StreamCategory } from "../../Space/Streamable";
    import ConfirmDialog from "../../Chat/Components/ConfirmDialog.svelte";
    import { IconAlertTriangle, IconUser, IconMute, IconUnMute, IconMicrophone, IconMicrophoneOff } from "@wa-icons";
    import { modals } from "@wa-modals";

    interface Props {
        spaceUser: SpaceUserExtended;
        videoEnabled: boolean;
        videoType?: StreamCategory;
        onClose: () => void;
        volumeStore: Writable<number>;
    }

    let { spaceUser, videoEnabled, videoType, onClose, volumeStore = writable(1) }: Props = $props();

    let isScreenSharing = $derived(videoType === "screenSharing");

    let isMicrophoneEnabled = $derived(spaceUser.reactiveUser.microphoneState);
    let isVideoEnabled = $derived(spaceUser.reactiveUser.cameraState);
    let canAskToMuteAudioOrTurnOffVideo = $derived(spaceUser.space.canAskToMuteAudioOrTurnOffVideo);
    // An admin, or the moderator of this meeting room (the tag of its advanced options): their mute is not a request.
    let isModerator = $derived($userIsAdminStore || $moderatedMeetingSpacesStore.has(spaceUser.space.getName()));
    // Raise-hand state comes from the space state queue (not SpaceUser), so it is known even for a
    // listener whose SpaceUser the local user does not receive.
    let isHandRaised = $derived(
        $raisedHandsOrderStore.get(spaceUser.space.getName())?.has(spaceUser.spaceUserId) ?? false,
    );
    let hasFloor = $derived(spaceUser.reactiveUser.megaphoneState);
    // The floor is only a real thing in a megaphone broadcast. In a bubble or a meeting room (ALL_USERS space)
    // everybody already speaks, so we offer no give / take back control there: the raised-hand badge is enough.
    let canModerateFloor = $derived(
        ($userIsAdminStore || $canAskToMuteAudioOrTurnOffVideo) && spaceUser.space.filterType !== FilterType.ALL_USERS,
    );

    let moreActionOpened = $state(false);

    function notifyMuted(message: string) {
        toastStore.addToast(TextToast, { message, theme: "success" });
    }

    function muteAudio(spaceUser: SpaceUserExtended) {
        analyticsClient.trackAdminEvent("meeting.microphone.muted", meetingOf(spaceUser.space));
        spaceUser.emitPrivateEvent({
            $case: "muteAudio",
            muteAudio: {
                force: false, // This is going to be overwritten by the processor of muteAudio in the back
            },
        });
        // No API turns someone else's microphone back on: confirm who was muted (or asked) instead of an Undo.
        notifyMuted(
            isModerator
                ? $LL.camera.menu.mutedAudioNotice({ name: spaceUser.name })
                : $LL.camera.menu.askedMuteAudioNotice({ name: spaceUser.name }),
        );
        close();
    }

    /**
     * How many people the "for everybody" actions reach: everybody in the space but the moderator, who is not sent
     * the event. Undefined when the space does not list them (a megaphone does not show its audience).
     */
    function countOthersInSpace(spaceUser: SpaceUserExtended): number | undefined {
        const space = spaceUser.space;
        const others = [...get(space.usersStore).values()].filter((user) => user.spaceUserId !== space.mySpaceUserId);
        return others.length > 0 ? others.length : undefined;
    }

    function muteAudioEveryBody(spaceUser: SpaceUserExtended) {
        const count = countOthersInSpace(spaceUser);
        // Read now: the menu, and the translations it subscribes to, are gone when the moderator confirms.
        const notice =
            count === undefined
                ? $LL.camera.menu.mutedAudioEveryBodyNotice()
                : $LL.camera.menu.mutedAudioEveryBodyNoticeCount({ count });
        // Nobody can turn the microphones back on but their owners: ask before, and say it was done after.
        modals.open(ConfirmDialog, {
            heading: $LL.camera.menu.confirmMuteAudioEveryBodyTitle(),
            message:
                count === undefined
                    ? $LL.camera.menu.confirmMuteAudioEveryBodyMessage()
                    : $LL.camera.menu.confirmMuteAudioEveryBodyMessageCount({ count }),
            confirmLabel: $LL.camera.menu.confirmMuteAudioEveryBodyAction(),
            danger: true,
            onConfirm: () => {
                analyticsClient.trackAdminEvent("meeting.microphone.muted_for_everybody", meetingOf(spaceUser.space));
                spaceUser.space.emitPublicMessage({
                    $case: "muteAudioForEverybody",
                    muteAudioForEverybody: {},
                });
                notifyMuted(notice);
                return Promise.resolve();
            },
        });
        close();
    }

    function muteVideo(spaceUser: SpaceUserExtended) {
        analyticsClient.trackAdminEvent("meeting.video.muted", meetingOf(spaceUser.space));
        spaceUser.emitPrivateEvent({
            $case: "muteVideo",
            muteVideo: {
                force: false, // This is going to be overwritten by the processor of muteVideo in the back
            },
        });
        notifyMuted(
            isModerator
                ? $LL.camera.menu.mutedVideoNotice({ name: spaceUser.name })
                : $LL.camera.menu.askedMuteVideoNotice({ name: spaceUser.name }),
        );
        close();
    }

    function muteVideoEveryBody(spaceUser: SpaceUserExtended) {
        const count = countOthersInSpace(spaceUser);
        const notice =
            count === undefined
                ? $LL.camera.menu.mutedVideoEveryBodyNotice()
                : $LL.camera.menu.mutedVideoEveryBodyNoticeCount({ count });
        modals.open(ConfirmDialog, {
            heading: $LL.camera.menu.confirmMuteVideoEveryBodyTitle(),
            message:
                count === undefined
                    ? $LL.camera.menu.confirmMuteVideoEveryBodyMessage()
                    : $LL.camera.menu.confirmMuteVideoEveryBodyMessageCount({ count }),
            confirmLabel: $LL.camera.menu.confirmMuteVideoEveryBodyAction(),
            danger: true,
            onConfirm: () => {
                analyticsClient.trackAdminEvent("meeting.video.muted_for_everybody", meetingOf(spaceUser.space));
                spaceUser.space.emitPublicMessage({
                    $case: "muteVideoForEverybody",
                    muteVideoForEverybody: {},
                });
                notifyMuted(notice);
                return Promise.resolve();
            },
        });
        close();
    }

    /**
     * TODO: implement ban user
     */
    /*function ban() {
        trackStreamWrapper.ban();
    }*/

    function giveFloor(spaceUser: SpaceUserExtended) {
        analyticsClient.trackAdminEvent("meeting.floor.given");
        spaceUser.space.state.giveFloor(spaceUser.spaceUserId).catch((error) => console.error(error));
        close();
    }

    function revokeFloor(spaceUser: SpaceUserExtended) {
        analyticsClient.trackAdminEvent("meeting.floor.revoked");
        spaceUser.space.state.revokeFloor(spaceUser.spaceUserId).catch((error) => console.error(error));
        close();
    }

    function toggleActionMenu(value: boolean) {
        moreActionOpened = value;
    }

    function openBlockOrReportPopup(spaceUser: SpaceUserExtended) {
        analyticsClient.trackAdminEvent("meeting.report.clicked", meetingOf(spaceUser.space));
        openModerationModal(spaceUser.uuid, spaceUser.name);
        close();
    }

    function visitCard(spaceUser: SpaceUserExtended) {
        analyticsClient.trackAdminEvent("user.business_card.opened");
        requestVisitCardsStore.set(spaceUser.visitCardUrl ?? null);
        close();
    }

    function close() {
        onClose();
    }
</script>

<div
    class="flex flex-col p-1 w-48 bg-contrast/95 backdrop-blur-md rounded-md max-h-max z-50 cursor-pointer select-none"
    class:mt-[0.2rem]={!videoEnabled}
    onclick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        analyticsClient.trackAdminEvent("meeting.actions.opened", meetingOf(spaceUser.space));
        toggleActionMenu(!moreActionOpened);
    }}
    role="button"
    tabindex="0"
    onkeydown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        toggleActionMenu(!moreActionOpened);
    }}
    onmouseleave={() => close()}
>
    <!-- Volume control -->
    <div
        class="flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded leading-4 text-left text-white disabled:opacity-50"
        role="group"
        aria-label={$LL.audio.volumeCtrl()}
    >
        {#if $volumeStore === 0}
            <button
                onclick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    volumeStore.set(1);
                }}
                class="p-0 m-0 hit-area"
                aria-label={$LL.a11y.videoUnmuteAudio()}
            >
                <IconMute class="w-4 h-4 text-white flex-shrink-0" aria-hidden="true" />
            </button>
        {:else}
            <button
                onclick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    volumeStore.set(0);
                }}
                class="p-0 m-0 hit-area"
                aria-label={$LL.audio.mute()}
            >
                <IconUnMute class="w-4 h-4 text-white flex-shrink-0" aria-hidden="true" />
            </button>
        {/if}
        <div class="w-[80%] mx-auto">
            <RangeSlider
                min={0}
                max={1}
                step={0.01}
                bind:value={$volumeStore}
                valueFormatter={(v) => Math.round(v * 100).toString()}
                unit="%"
                variant="secondary"
                wrapperMargins={false}
            />
        </div>
    </div>

    <!-- Mute audio user -->
    {#if (isModerator || $canAskToMuteAudioOrTurnOffVideo) && !isScreenSharing}
        <button
            class="action-button mute-audio-user flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // Already muted: the row says so (below) and the click does nothing more.
                if (!$isMicrophoneEnabled) return;
                muteAudio(spaceUser);
            }}
            aria-disabled={!$isMicrophoneEnabled || undefined}
        >
            <img
                src={MicrophoneCloseSvg}
                class="w-4 h-4 {$isMicrophoneEnabled ? '' : 'opacity-50'}"
                alt=""
                draggable="false"
            />
            <span class="flex flex-col">
                <span class={$isMicrophoneEnabled ? "" : "opacity-50"}>
                    {#if isModerator}
                        {$LL.camera.menu.muteAudioUser()}
                    {:else}
                        {$LL.camera.menu.askToMuteAudioUser()}
                    {/if}
                </span>
                {#if !$isMicrophoneEnabled}
                    <span class="text-xs text-white/80">{$LL.camera.menu.alreadyMuted()}</span>
                {/if}
            </span>
        </button>
    {/if}

    <!-- Give the floor (to a user who raised their hand) -->
    {#if canModerateFloor && !isScreenSharing && isHandRaised && !$hasFloor}
        <button
            class="action-button give-floor-user flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            data-testid="give-floor-user"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                giveFloor(spaceUser);
            }}
        >
            <IconMicrophone class="w-4 h-4 text-white flex-shrink-0" aria-hidden="true" />
            {$LL.camera.menu.giveFloor()}
        </button>
    {/if}

    <!-- Revoke the floor (take it back from a current speaker) -->
    {#if canModerateFloor && !isScreenSharing && $hasFloor}
        <button
            class="action-button revoke-floor-user flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            data-testid="revoke-floor-user"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                revokeFloor(spaceUser);
            }}
        >
            <IconMicrophoneOff class="w-4 h-4 text-white flex-shrink-0" aria-hidden="true" />
            {$LL.camera.menu.revokeFloor()}
        </button>
    {/if}

    <!-- Mute audio every body -->
    {#if isModerator}
        <button
            class="action-button flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                muteAudioEveryBody(spaceUser);
            }}
        >
            <img src={MicrophoneCloseSvg} class="w-4 h-4" alt="" draggable="false" />
            {$LL.camera.menu.muteAudioEveryBody()}
        </button>
    {/if}

    <!-- Mute video -->
    {#if (isModerator || $canAskToMuteAudioOrTurnOffVideo) && !isScreenSharing}
        <button
            id="mute-video-user"
            class="action-button flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // Video already off: the row says so (below) and the click does nothing more.
                if (!$isVideoEnabled) return;
                muteVideo(spaceUser);
            }}
            aria-disabled={!$isVideoEnabled || undefined}
        >
            <img src={NoVideoSvg} class="w-4 h-4 {$isVideoEnabled ? '' : 'opacity-50'}" alt="" draggable="false" />
            <span class="flex flex-col">
                <span class={$isVideoEnabled ? "" : "opacity-50"}>
                    {#if isModerator}
                        {$LL.camera.menu.muteVideoUser()}
                    {:else}
                        {$LL.camera.menu.askToMuteVideoUser()}
                    {/if}
                </span>
                {#if !$isVideoEnabled}
                    <span class="text-xs text-white/80">{$LL.camera.menu.videoAlreadyOff()}</span>
                {/if}
            </span>
        </button>
    {/if}

    <!-- Mute video every body -->
    {#if isModerator}
        <button
            class="action-button flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                muteVideoEveryBody(spaceUser);
            }}
        >
            <img src={NoVideoSvg} class="w-4 h-4" alt="" draggable="false" />
            {$LL.camera.menu.muteVideoEveryBody()}
        </button>
    {/if}

    <!-- Send private message -->
    <!--    <button-->
    <!--        class="action-button flex flex-row items-center justify-center p-0 mx-1 cursor-pointer"-->
    <!--        onclick={(event) => {-->
    <!--            event.preventDefault();-->
    <!--            event.stopPropagation();-->
    <!--            analyticsClient.trackAdminEvent("meeting.private_message.clicked");-->
    <!--            sendPrivateMessage();-->
    <!--        }}-->
    <!--    >-->
    <!--        <img src={BubbleTalkPng} class="w-8 h-8" alt="" />-->
    <!--        <Tooltip text={$LL.camera.menu.senPrivateMessage()} rightPosition="true" />-->
    <!--    </button>-->

    <!-- Show visit card-->
    {#if spaceUser.visitCardUrl}
        <button
            class="action-button flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
            onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                visitCard(spaceUser);
            }}
        >
            <IconUser aria-hidden="true" />
            {$LL.chat.menu.visitCard()}
        </button>
    {/if}
    <!-- Block or report user -->
    <button
        class="action-button flex gap-2 items-center hover:bg-white/10 aria-disabled:hover:bg-transparent aria-disabled:cursor-not-allowed m-0 p-2 w-full text-sm rounded leading-4 text-left text-white"
        onclick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openBlockOrReportPopup(spaceUser);
        }}
    >
        <IconAlertTriangle aria-hidden="true" />
        {$LL.camera.menu.blockOrReportUser()}
    </button>
</div>
