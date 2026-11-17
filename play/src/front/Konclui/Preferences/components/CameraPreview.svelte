<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { localStreamStore, localVolumeStore } from "../../../Stores/MediaStore";
    import { srcObject } from "../../../Components/Video/utils";
    import { meterLevel } from "../domain/mediaChoices";

    // The office's own stream, live while this section is open: the camera test of upstream's camera screen
    // (EnableCameraScene.svelte), without leaving the office. The volume meter listens only while it is shown.
    let stream = $derived($localStreamStore.type === "success" ? $localStreamStore.stream : undefined);
    let cameraOn = $derived(
        stream?.getVideoTracks().some((track) => track.readyState === "live" && track.enabled) ?? false,
    );
    let level = $derived(meterLevel($localVolumeStore));
</script>

<div class="k-pref-preview">
    <div class="k-pref-video" class:off={!cameraOn}>
        {#if cameraOn && stream}
            <video
                use:srcObject={stream}
                autoplay
                muted
                playsinline
                aria-label={$LL.konclui.preferences.media.preview()}
            ></video>
        {:else}
            <span>{$LL.konclui.preferences.media.previewOff()}</span>
        {/if}
    </div>
    <div class="k-pref-mic">
        <span id="k-pref-mic-level">{$LL.konclui.preferences.media.microphone()}</span>
        <div
            class="k-pref-meter"
            role="meter"
            aria-label={$LL.konclui.preferences.media.micLevel()}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level}
        >
            <i style:width="{level}%"></i>
        </div>
    </div>
</div>
