<script lang="ts">
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { isSpeakerStore, silentStore } from "../../../Stores/MediaStore";
    import LL from "../../../../i18n/i18n-svelte";
    import { openedMenuStore, screenSharingActivatedStore } from "../../../Stores/MenuStore";

    import ScreenShareIcon from "../../Icons/ScreenShareIcon.svelte";
    import ScreenShareOffIcon from "../../Icons/ScreenShareOffIcon.svelte";
    import { isScreenSharingSupported, requestedScreenSharingState } from "../../../Stores/ScreenSharingStore";

    interface Props {
        onclick?: () => void;
    }

    let { onclick }: Props = $props();

    function screenSharingClick(): void {
        onclick?.();
        analyticsClient.trackAdminEvent("meeting.screenshare.toggled");
        if ($silentStore && !$isSpeakerStore) return;
        if ($requestedScreenSharingState === true) {
            requestedScreenSharingState.disableScreenSharing();
        } else {
            requestedScreenSharingState.enableScreenSharing();
        }
    }
</script>

{#if isScreenSharingSupported()}
    <ActionBarButton
        onclick={screenSharingClick}
        classList="group/btn-screen-share"
        tooltipTitle={$LL.actionbar.help.share.title()}
        disabledHelp={$openedMenuStore !== undefined}
        state={!$screenSharingActivatedStore
            ? "disabled"
            : $requestedScreenSharingState && !$silentStore
              ? "active"
              : "normal"}
        pressed={Boolean($requestedScreenSharingState && !$silentStore)}
        blockedReason={$LL.actionbar.blocked.screenSharingOff()}
        dataTestId="screenShareButton"
        media="./static/images/screensharing.mp4"
        desc={$LL.actionbar.help.share.desc()}
    >
        {#if $requestedScreenSharingState && !$silentStore}
            <ScreenShareOffIcon height="h-5" width="w-5" strokeWidth="2" />
        {:else}
            <ScreenShareIcon height="h-5" width="w-5" strokeWidth="2" />
        {/if}
    </ActionBarButton>
{/if}
