<script lang="ts">
    import {
        cameraListStore,
        microphoneListStore,
        requestedCameraDeviceIdStore,
        requestedCameraState,
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        speakerListStore,
        speakerSelectedStore,
        silentStore,
        usedCameraDeviceIdStore,
        usedMicrophoneDeviceIdStore,
        cameraAccessIssueStore,
        microphoneAccessIssueStore,
        cameraAccessDeniedStore,
        microphoneAccessDeniedStore,
        devicesNotLoaded,
        rawLocalStreamStore,
        mediaStreamConstraintsStore,
    } from "../../../Stores/MediaStore";
    import { cameraPermissionStateStore, microphonePermissionStateStore } from "../../../Stores/MediaStatusStore";
    import { speakerSelectionSupported } from "../../../Stores/AudioOutputStore";
    import { playSpeakerTestSound } from "../../../WebRtc/AudioOutputManager";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { noiseSuppressionEnabledStore, noiseSuppressionStateStore } from "../../../Stores/NoiseSuppressionStore";
    import { handleOpenMenuEvent, settingsSubMenuTargetStore, SubMenusInterface } from "../../../Stores/MenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { showHelpCameraSettings } from "../../../Stores/HelpSettingsStore";
    import InputSwitch from "../../Input/InputSwitch.svelte";
    import Button from "../../UI/Button.svelte";
    import SectionDivider from "./SectionDivider.svelte";
    import SectionTitle from "./SectionTitle.svelte";
    import DeviceListItem from "./DeviceListItem.svelte";
    import { IconCamera, IconHeadphones, IconMicrophoneOn, IconSettings, IconUnMute } from "@wa-icons";

    interface Props {
        oncameraselected?: () => void;
        onsettingsopened?: () => void;
    }

    const { oncameraselected, onsettingsopened }: Props = $props();

    function selectCamera(deviceId: string) {
        requestedCameraDeviceIdStore.set(deviceId);
        localUserStore.setPreferredVideoInputDevice(deviceId);
        oncameraselected?.();
    }

    function selectMicrophone(deviceId: string) {
        requestedMicrophoneDeviceIdStore.set(deviceId);
        localUserStore.setPreferredAudioInputDevice(deviceId);
    }

    function selectSpeaker(deviceId: string) {
        localUserStore.setSpeakerDeviceId(deviceId);
        speakerSelectedStore.set(deviceId);
    }

    function cameraClick(): void {
        if ($silentStore) return;
        if ($requestedCameraState === true) {
            requestedCameraState.disableWebcam();
        } else {
            requestedCameraState.enableWebcam();
        }
    }

    function microphoneClick(): void {
        if ($silentStore) return;
        if ($requestedMicrophoneState === true) {
            requestedMicrophoneState.disableMicrophone();
        } else {
            requestedMicrophoneState.enableMicrophone();
        }
    }

    function openMicrophoneSettings(): void {
        settingsSubMenuTargetStore.set("microphone");
        handleOpenMenuEvent(SubMenusInterface.settings);
        onsettingsopened?.();
    }

    function toggleNoiseSuppression(): void {
        noiseSuppressionEnabledStore.setEnabled(!$noiseSuppressionEnabledStore);
    }

    let isNoiseSuppressionErrorState = $derived(
        $noiseSuppressionStateStore.status === "error" || $noiseSuppressionStateStore.status === "unsupported",
    );

    let cameraLoaded = $derived(
        ($rawLocalStreamStore.type === "success" &&
            $rawLocalStreamStore.stream &&
            $rawLocalStreamStore.stream.getVideoTracks().length > 0) ||
            ($requestedCameraState && $usedCameraDeviceIdStore !== undefined),
    );
    let microphoneLoaded = $derived(
        ($rawLocalStreamStore.type === "success" &&
            $rawLocalStreamStore.stream &&
            $rawLocalStreamStore.stream.getAudioTracks().length > 0) ||
            ($requestedMicrophoneState && $usedMicrophoneDeviceIdStore !== undefined),
    );

    // A device's state (blocked, in use, none, off) starts on the 12 px inset of the rows and section titles.
    const note = "flex flex-col gap-0.5 px-3 py-1.5 text-start";
    const noteTitle = "m-0 text-sm text-(--k-fg-2)";
    const noteDetail = "m-0 text-xs text-(--k-fg-muted)";
    const noteAction = "px-3 pb-1.5";
</script>

<!-- The bottom padding keeps the last row off the rim once the list is scrolled to its end. -->
<div class="k-scroll-y flex min-h-0 flex-1 flex-col pb-1.5">
    <!-- Camera Section -->
    <div role="group" aria-label={$LL.actionbar.subtitle.camera()} class="flex flex-col gap-0.5">
        <SectionTitle title={$LL.actionbar.subtitle.camera()} />
        {#if $silentStore == false && cameraLoaded && $cameraListStore && $cameraListStore.length > 0}
            {#each $cameraListStore as camera, index (index)}
                <DeviceListItem
                    label={camera.label}
                    icon={IconCamera}
                    isSelected={$usedCameraDeviceIdStore === camera.deviceId}
                    onclick={() => {
                        analyticsClient.trackAdminEvent("settings.camera.selected");
                        selectCamera(camera.deviceId);
                    }}
                />
            {/each}
        {:else}
            <div class={note}>
                {#if $cameraAccessDeniedStore}
                    <p class={noteTitle}>{$LL.camera.help.tooltip.permissionDeniedTitle()}</p>
                {:else if $cameraAccessIssueStore === "device_in_use"}
                    <p class={noteTitle}>{$LL.camera.help.tooltip.deviceInUseTitle()}</p>
                    <p class={noteDetail}>{$LL.camera.help.tooltip.deviceInUseDesc()}</p>
                {:else if $cameraAccessIssueStore === "no_device" || (!$devicesNotLoaded && $cameraListStore !== undefined && $cameraListStore.length === 0)}
                    <p class={noteTitle}>{$LL.camera.help.tooltip.noDeviceTitle()}</p>
                    <p class={noteDetail}>{$LL.camera.help.tooltip.noDeviceDesc()}</p>
                {:else if $cameraPermissionStateStore === "prompt" && !$requestedCameraState}
                    <p class={noteTitle}>{$LL.camera.help.title()}</p>
                    <p class={noteDetail}>{$LL.camera.help.content()}</p>
                {:else if $mediaStreamConstraintsStore.video === false || !$requestedCameraState}
                    <p class={noteTitle}>{$LL.actionbar.camera.disabled()}</p>
                {:else if $rawLocalStreamStore.type === "error"}
                    <p class={noteTitle}>{$LL.camera.startError.camera()}</p>
                {:else}
                    <p class={noteTitle}>{$LL.chat.loading()}...</p>
                {/if}
            </div>
            {#if $silentStore == false}
                <div class={noteAction}>
                    {#if $cameraAccessDeniedStore}
                        <Button variant="secondary" size="sm" class="w-full" onclick={showHelpCameraSettings}>
                            {$LL.actionbar.microphone.openSettings()}
                        </Button>
                    {:else}
                        <Button
                            variant="secondary"
                            size="sm"
                            class="w-full"
                            onclick={() => {
                                analyticsClient.trackAdminEvent("media.camera.toggled");
                                cameraClick();
                            }}
                        >
                            {$LL.actionbar.camera.activate()}
                        </Button>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>

    <SectionDivider />

    <!-- Microphone Section -->
    <div role="group" aria-label={$LL.actionbar.subtitle.microphone()} class="flex flex-col gap-0.5">
        <SectionTitle title={$LL.actionbar.subtitle.microphone()}>
            {#snippet actions()}
                <button
                    type="button"
                    data-testid="microphone-settings-button"
                    class="k-control"
                    aria-label={$LL.actionbar.microphone.openSettings()}
                    title={$LL.actionbar.microphone.openSettings()}
                    onclick={openMicrophoneSettings}
                >
                    <IconSettings aria-hidden="true" />
                </button>
            {/snippet}
        </SectionTitle>
        {#if $silentStore == false && microphoneLoaded && $microphoneListStore && $microphoneListStore.length > 0}
            {#each $microphoneListStore as microphone, index (index)}
                <DeviceListItem
                    label={microphone.label}
                    icon={IconMicrophoneOn}
                    isSelected={$usedMicrophoneDeviceIdStore === microphone.deviceId}
                    onclick={() => {
                        analyticsClient.trackAdminEvent("settings.microphone.selected");
                        selectMicrophone(microphone.deviceId);
                    }}
                />
            {/each}
            <div class="group flex flex-col relative z-10 px-3 py-1.5 overflow-hidden">
                {#snippet noiseSuppressionActive()}
                    <span data-testid="noise-suppression-active" class="text-success">
                        {$LL.actionbar.microphone.noiseSuppressionActive()}
                    </span>
                {/snippet}
                <InputSwitch
                    id="noise-suppression-toggle"
                    value={$noiseSuppressionEnabledStore}
                    onchange={toggleNoiseSuppression}
                    margin=""
                    spacing=""
                    alignLabel="center"
                    description={$noiseSuppressionStateStore.status === "ready" && $noiseSuppressionEnabledStore
                        ? noiseSuppressionActive
                        : undefined}
                >
                    <span class:text-pop-red-text={isNoiseSuppressionErrorState}>
                        {$LL.actionbar.microphone.advancedNoiseReduction()}
                    </span>
                </InputSwitch>
                {#if $noiseSuppressionStateStore.status === "initializing"}
                    <div class="ms-14 px-3 text-sm text-white/60">
                        {$LL.actionbar.microphone.noiseSuppressionInitializing()}
                    </div>
                {:else if $noiseSuppressionStateStore.status === "unsupported"}
                    <div data-testid="noise-suppression-error" class="ms-14 px-3 text-sm text-pop-red-text">
                        {$noiseSuppressionStateStore.message ?? $LL.actionbar.microphone.noiseSuppressionUnsupported()}
                    </div>
                {:else if $noiseSuppressionStateStore.status === "error"}
                    <div data-testid="noise-suppression-error" class="ms-14 px-3 text-sm text-pop-red-text">
                        {$noiseSuppressionStateStore.message ?? $LL.actionbar.microphone.noiseSuppressionError()}
                    </div>
                {/if}
            </div>
        {:else}
            <div class={note}>
                {#if $microphoneAccessDeniedStore}
                    <p class={noteTitle}>{$LL.camera.help.microphoneTooltip.permissionDeniedTitle()}</p>
                {:else if $microphoneAccessIssueStore === "device_in_use"}
                    <p class={noteTitle}>{$LL.camera.help.microphoneTooltip.deviceInUseTitle()}</p>
                    <p class={noteDetail}>{$LL.camera.help.microphoneTooltip.deviceInUseDesc()}</p>
                {:else if $microphoneAccessIssueStore === "no_device" || (!$devicesNotLoaded && $microphoneListStore !== undefined && $microphoneListStore.length === 0)}
                    <p class={noteTitle}>{$LL.camera.help.microphoneTooltip.noDeviceTitle()}</p>
                    <p class={noteDetail}>{$LL.camera.help.microphoneTooltip.noDeviceDesc()}</p>
                {:else if $microphonePermissionStateStore === "prompt" && !$requestedMicrophoneState}
                    <p class={noteTitle}>{$LL.camera.help.title()}</p>
                    <p class={noteDetail}>{$LL.camera.help.content()}</p>
                {:else if $mediaStreamConstraintsStore.audio === false || !$requestedMicrophoneState}
                    <p class={noteTitle}>{$LL.actionbar.microphone.disabled()}</p>
                {:else if $rawLocalStreamStore.type === "error"}
                    <p class={noteTitle}>{$LL.camera.startError.microphone()}</p>
                {:else}
                    <p class={noteTitle}>{$LL.chat.loading()}...</p>
                {/if}
            </div>
            {#if $silentStore == false}
                <div class={noteAction}>
                    {#if $microphoneAccessDeniedStore}
                        <Button variant="secondary" size="sm" class="w-full" onclick={showHelpCameraSettings}>
                            {$LL.actionbar.microphone.openSettings()}
                        </Button>
                    {:else}
                        <Button
                            variant="secondary"
                            size="sm"
                            class="w-full"
                            onclick={() => {
                                analyticsClient.trackAdminEvent("media.microphone.toggled");
                                microphoneClick();
                            }}
                        >
                            {$LL.actionbar.microphone.activate()}
                        </Button>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>

    <!-- Hidden on Safari and iOS, where the output always follows the system -->
    {#if speakerSelectionSupported}
        <SectionDivider />

        <!-- Speaker Section -->
        <div role="group" aria-label={$LL.actionbar.subtitle.speaker()} class="flex flex-col gap-0.5">
            <SectionTitle title={$LL.actionbar.subtitle.speaker()}>
                {#snippet actions()}
                    {#if $speakerSelectedStore != undefined && $speakerListStore && $speakerListStore.length > 0}
                        <button
                            type="button"
                            data-testid="speaker-test-button"
                            class="k-control"
                            aria-label={$LL.actionbar.speaker.test()}
                            title={$LL.actionbar.speaker.test()}
                            onclick={() => playSpeakerTestSound().catch((e) => console.error(e))}
                        >
                            <IconUnMute aria-hidden="true" />
                        </button>
                    {/if}
                {/snippet}
            </SectionTitle>
            {#if $speakerSelectedStore != undefined && $speakerListStore && $speakerListStore.length > 0}
                {#each $speakerListStore as speaker, index (index)}
                    <DeviceListItem
                        label={speaker.label}
                        icon={IconHeadphones}
                        isSelected={$speakerSelectedStore === speaker.deviceId}
                        onclick={() => {
                            analyticsClient.trackAdminEvent("settings.speaker.selected");
                            selectSpeaker(speaker.deviceId);
                        }}
                    />
                {/each}
            {:else if $speakerListStore !== undefined}
                <div class={note}>
                    {#if $speakerListStore.length === 0}
                        <p class={noteTitle}>{$LL.actionbar.speaker.noDevices()}</p>
                        <p class={noteDetail}>{$LL.actionbar.speaker.noDevicesDesc()}</p>
                    {:else}
                        <p class={noteTitle}>{$LL.actionbar.speaker.disabled()}</p>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>
