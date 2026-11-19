<script lang="ts">
    import { activeSecondaryZoneActionBarStore } from "../../../Stores/MenuStore";
    import {
        audioManagerFileStore,
        audioManagerPlayerState,
        audioManagerRetryPlaySubject,
        audioManagerVisibilityStore,
        audioManagerVolumeStore,
    } from "../../../Stores/AudioManagerStore";
    import AudioManager from "../../AudioManager/AudioManager.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PlayerPauseIcon from "../../Icons/PlayerPauseIcon.svelte";
    import PlayerPlayIcon from "../../Icons/PlayerPlayIcon.svelte";
    import PlayerStopIcon from "../../Icons/PlayerStopIcon.svelte";
    import PlayerMusicIcon from "../../Icons/PlayerMusicIcon.svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { IconLoader } from "@wa-icons";

    // The buttons are dimmed while the user's settings turn the ambient sounds off: say so, and where to undo it.
    let blockedReason = $derived(
        $audioManagerVisibilityStore === "disabledBySettings"
            ? $LL.actionbar.blocked.ambientOffInSettings()
            : undefined,
    );
</script>

<ActionBarButton
    onclick={() => {
        audioManagerVolumeStore.togglePause();
    }}
    classList="group/btn-music-paused"
    tooltipTitle={$audioManagerVolumeStore.paused
        ? $LL.actionbar.help.audioManager.play()
        : $LL.actionbar.help.audioManager.pause()}
    state={$audioManagerVisibilityStore === "visible"
        ? $audioManagerPlayerState !== "not_allowed"
            ? "active"
            : "forbidden"
        : $audioManagerVisibilityStore === "error"
          ? "forbidden"
          : $audioManagerVisibilityStore === "disabledBySettings"
            ? "disabled"
            : undefined}
    {blockedReason}
    dataTestId="music-pause-button"
>
    {#if $audioManagerPlayerState === "loading"}
        <IconLoader font-size="20" class="animate-spin" aria-hidden="true" />
    {:else if $audioManagerVolumeStore.paused}
        <PlayerPlayIcon height="h-5" width="w-5" strokeWidth="2" />
    {:else}
        <PlayerPauseIcon height="h-5" width="w-5" strokeWidth="2" />
    {/if}
</ActionBarButton>
<ActionBarButton
    classList="group/btn-music-stop"
    onclick={() => {
        // Stop audio
        audioManagerVolumeStore.stopSound(true);
        audioManagerFileStore.unloadAudio();
        audioManagerVisibilityStore.set("hidden");
        // Clear properties because when the user click on the same audio button or entity, the audio will be played again
        // Clear because if the user move again in the same area, the audio will be not played again
        const gameScene = gameManager.getCurrentGameScene();
        if (gameScene) gameScene.getGameMapFrontWrapper().clearCurrentProperties();
        if (gameScene) gameScene.getGameMapFrontWrapper().getEntitiesManager().clearProperties();
    }}
    tooltipTitle={$LL.actionbar.help.audioManager.stop()}
    state={$audioManagerVisibilityStore === "visible"
        ? $audioManagerPlayerState !== "not_allowed"
            ? "active"
            : "forbidden"
        : $audioManagerVisibilityStore === "error"
          ? "forbidden"
          : $audioManagerVisibilityStore === "disabledBySettings"
            ? "disabled"
            : undefined}
    {blockedReason}
    dataTestId="music-stop-button"
>
    <PlayerStopIcon height="h-5" width="w-5" strokeWidth="2" />
</ActionBarButton>
<ActionBarButton
    onclick={() => {
        if (
            $audioManagerVisibilityStore === "visible" &&
            $audioManagerPlayerState !== "not_allowed" &&
            $activeSecondaryZoneActionBarStore !== "audio-manager"
        ) {
            activeSecondaryZoneActionBarStore.set("audio-manager");
        } else if ($audioManagerVisibilityStore === "visible" && $audioManagerPlayerState === "not_allowed") {
            audioManagerRetryPlaySubject.next();
        } else {
            activeSecondaryZoneActionBarStore.set(undefined);
        }
    }}
    classList="group/btn-music"
    tooltipTitle={$audioManagerPlayerState !== "not_allowed"
        ? $LL.actionbar.help.audioManager.title()
        : $LL.actionbar.help.audioManagerNotAllowed.title()}
    tooltipDesc={$audioManagerPlayerState !== "not_allowed"
        ? $LL.actionbar.help.audioManager.desc()
        : $LL.actionbar.help.audioManagerNotAllowed.desc()}
    state={$audioManagerVisibilityStore === "visible"
        ? $audioManagerPlayerState !== "not_allowed"
            ? $activeSecondaryZoneActionBarStore !== "audio-manager"
                ? "normal"
                : "active"
            : "forbidden"
        : $audioManagerVisibilityStore === "error"
          ? "forbidden"
          : $audioManagerVisibilityStore === "disabledBySettings"
            ? "disabled"
            : undefined}
    {blockedReason}
    dataTestId="music-button"
>
    <PlayerMusicIcon height="h-5" width="w-5" strokeWidth="2" />
</ActionBarButton>
{#if $activeSecondaryZoneActionBarStore === "audio-manager"}
    <AudioManager />
{/if}
