<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { speakerSelectedStore, speakerSelectionSupported } from "../../../Stores/AudioOutputStore";
    import { bandwidthConstrainedPreferenceStore } from "../../../Stores/BandwidthConstrainedPreferenceStore";
    import { displayVideoQualityStore } from "../../../Stores/DisplayVideoQualityStore";
    import {
        cameraListStore,
        microphoneListStore,
        requestedCameraDeviceIdStore,
        requestedCameraState,
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        speakerListStore,
        usedCameraDeviceIdStore,
        silentStore,
        usedMicrophoneDeviceIdStore,
        videoQualityStore,
    } from "../../../Stores/MediaStore";
    import {
        browserNoiseSuppressionSupportedStore,
        effectiveNoiseSuppressionProviderStore,
        microphoneAutoGainControlStore,
        microphoneBrowserNoiseSuppressionStore,
        microphoneEchoCancellationStore,
        noiseSuppressionEnabledStore,
        noiseSuppressionEngineStore,
        noiseSuppressionProviderStore,
        noiseSuppressionStateStore,
        voiceIsolationSupportedStore,
    } from "../../../Stores/NoiseSuppressionStore";
    import { screenShareQualityStore } from "../../../Stores/ScreenSharingStore";
    import { uplinkCapStore } from "../../../WebRtc/UplinkCap";
    import {
        isBandwidthPreference,
        isQualityName,
        NO_DEVICE,
        shownDevice,
        STARTING_DEVICE,
    } from "../domain/mediaChoices";
    import {
        cameraWhenHidden,
        microphoneWhenHidden,
        selectCamera,
        selectMicrophone,
        selectSpeaker,
        setVideoQualityStats,
        testSpeaker,
    } from "../stores/mediaSettings";
    import CameraBackground from "./CameraBackground.svelte";
    import CameraPreview from "./CameraPreview.svelte";
    import PrefChoice from "./PrefChoice.svelte";
    import PrefSection from "./PrefSection.svelte";
    import PrefSelect from "./PrefSelect.svelte";
    import PrefToggle from "./PrefToggle.svelte";
    import { IconUnMute } from "@wa-icons";

    let t = $derived($LL.konclui.preferences.media);

    /** A browser without access lists a placeholder with an empty id: that id is NO_DEVICE, so it is not a device. */
    function devices(
        list: readonly MediaDeviceInfo[] | undefined,
        name: (index: number) => string,
    ): { value: string; label: string }[] {
        return (list ?? [])
            .filter((device) => device.deviceId !== NO_DEVICE)
            .map((device, index) => ({
                value: device.deviceId,
                label: device.label || name(index + 1),
            }));
    }

    /** The list of a device kind: off, the devices, and "starting" while the device starts unseen. */
    function deviceOptions(
        off: string,
        listed: { value: string; label: string }[],
        value: string,
    ): { value: string; label: string }[] {
        const starting = value === STARTING_DEVICE ? [{ value: STARTING_DEVICE, label: t.deviceStarting() }] : [];
        return [{ value: NO_DEVICE, label: off }, ...starting, ...listed];
    }

    /** The note under a device list: the silent zone, or else a list the browser has not filled yet. */
    function deviceHint(silent: boolean, listed: readonly unknown[]): string | undefined {
        if (silent) return t.silentZone();
        return listed.length === 0 ? t.listAfterPermission() : undefined;
    }

    let cameras = $derived(devices($cameraListStore, (index) => t.cameraNumber({ index })));
    let cameraValue = $derived(
        shownDevice($requestedCameraState, $usedCameraDeviceIdStore, $requestedCameraDeviceIdStore),
    );
    let cameraOptions = $derived(deviceOptions(t.cameraOff(), cameras, cameraValue));
    let microphones = $derived(devices($microphoneListStore, (index) => t.microphoneNumber({ index })));
    let microphoneValue = $derived(
        shownDevice($requestedMicrophoneState, $usedMicrophoneDeviceIdStore, $requestedMicrophoneDeviceIdStore),
    );
    let microphoneOptions = $derived(deviceOptions(t.microphoneOff(), microphones, microphoneValue));
    // Safari and iOS play on the system output: there is no speaker to choose (AudioOutputStore.ts).
    let speakerOptions = $derived(devices($speakerListStore, (index) => t.speakerNumber({ index })));
    let speakerShown = $derived(
        speakerSelectionSupported && $speakerSelectedStore !== undefined && speakerOptions.length > 0,
    );

    let qualities = $derived([
        { value: "low", label: t.qualityLow() },
        { value: "recommended", label: t.qualityRecommended() },
        { value: "high", label: t.qualityHigh() },
    ]);
    let workAdventureNoise = $derived($effectiveNoiseSuppressionProviderStore === "workadventure");
    let noiseStatus = $derived.by(() => {
        if (!workAdventureNoise) return undefined;
        const state = $noiseSuppressionStateStore;
        if (state.status === "initializing") return t.noiseStarting();
        if (state.status === "unsupported") return state.message ?? t.noiseUnsupported();
        if (state.status === "error") return state.message ?? t.noiseFailed();
        return undefined;
    });
</script>

<PrefSection title={t.devices()}>
    <PrefSelect
        title={t.camera()}
        hint={deviceHint($silentStore, cameras)}
        value={cameraValue}
        options={cameraOptions}
        onchange={selectCamera}
    />
    <PrefSelect
        title={t.microphone()}
        hint={deviceHint($silentStore, microphones)}
        value={microphoneValue}
        options={microphoneOptions}
        onchange={selectMicrophone}
    />
    {#if speakerShown}
        <PrefSelect
            title={t.speaker()}
            value={$speakerSelectedStore ?? ""}
            options={speakerOptions}
            onchange={selectSpeaker}
        >
            <button
                type="button"
                class="k-pref-play"
                aria-label={t.testSpeaker()}
                title={t.testSpeaker()}
                data-testid="speaker-test-button"
                onclick={testSpeaker}
            >
                <IconUnMute font-size="16" aria-hidden="true" />
            </button>
        </PrefSelect>
    {/if}
</PrefSection>
<CameraPreview />
<PrefSection title={t.background()}>
    <CameraBackground />
</PrefSection>
<PrefSection title={t.video()}>
    <PrefChoice
        title={t.videoQuality()}
        hint={$uplinkCapStore ? t.videoQualityCapped() : t.videoQualityHint()}
        options={qualities}
        value={$videoQualityStore}
        onchange={(value) => {
            if (isQualityName(value)) videoQualityStore.setQuality(value);
        }}
    />
</PrefSection>
<PrefSection title={t.screen()}>
    <PrefChoice
        title={t.screenQuality()}
        options={qualities}
        value={$screenShareQualityStore}
        onchange={(value) => {
            if (isQualityName(value)) screenShareQualityStore.setQuality(value);
        }}
    />
    <PrefChoice
        title={t.bandwidth()}
        hint={t.bandwidthHint()}
        options={[
            { value: "maintain-resolution", label: t.sharpness() },
            { value: "maintain-framerate", label: t.smoothness() },
            { value: "balanced", label: t.balance() },
        ]}
        value={$bandwidthConstrainedPreferenceStore}
        onchange={(value) => {
            if (isBandwidthPreference(value)) bandwidthConstrainedPreferenceStore.setPreference(value);
        }}
    />
</PrefSection>
<PrefSection title={t.microphoneSection()}>
    <PrefToggle
        title={t.noise()}
        hint={t.noiseHint()}
        checked={$noiseSuppressionEnabledStore}
        onchange={(on) => noiseSuppressionEnabledStore.setEnabled(on)}
    />
    {#if $noiseSuppressionEnabledStore && $voiceIsolationSupportedStore}
        <PrefChoice
            title={t.noiseMode()}
            options={[
                { value: "workadventure", label: t.noiseWorkAdventure() },
                { value: "voiceIsolation", label: t.noiseVoiceIsolation() },
            ]}
            value={$effectiveNoiseSuppressionProviderStore}
            onchange={(value) =>
                noiseSuppressionProviderStore.setProvider(
                    value === "voiceIsolation" ? "voiceIsolation" : "workadventure",
                )}
        />
    {/if}
    {#if $noiseSuppressionEnabledStore && workAdventureNoise}
        <PrefSelect
            title={t.noiseEngine()}
            hint={noiseStatus}
            value={$noiseSuppressionEngineStore}
            options={[
                { value: "deepfilternet", label: t.engineDeepFilterNet() },
                { value: "dtln", label: t.engineDtln() },
            ]}
            onchange={(value) => noiseSuppressionEngineStore.setEngine(value === "dtln" ? "dtln" : "deepfilternet")}
        />
    {/if}
    <PrefToggle
        title={t.autoGain()}
        hint={t.autoGainHint()}
        checked={$microphoneAutoGainControlStore}
        onchange={(on) => microphoneAutoGainControlStore.setEnabled(on)}
    />
    <PrefToggle
        title={t.echo()}
        hint={t.echoHint()}
        checked={$microphoneEchoCancellationStore}
        onchange={(on) => microphoneEchoCancellationStore.setEnabled(on)}
    />
    {#if $browserNoiseSuppressionSupportedStore}
        <PrefToggle
            title={t.browserNoise()}
            hint={t.browserNoiseHint()}
            checked={$microphoneBrowserNoiseSuppressionStore}
            onchange={(on) => microphoneBrowserNoiseSuppressionStore.setEnabled(on)}
        />
    {/if}
</PrefSection>
<PrefSection title={t.hidden()}>
    <PrefToggle
        title={t.cameraHidden()}
        hint={t.hiddenHint()}
        checked={$cameraWhenHidden}
        onchange={(on) => cameraWhenHidden.set(on)}
    />
    <PrefToggle
        title={t.microphoneHidden()}
        hint={t.hiddenHint()}
        checked={$microphoneWhenHidden}
        onchange={(on) => microphoneWhenHidden.set(on)}
    />
</PrefSection>
<PrefSection title={t.advanced()}>
    <PrefToggle
        title={t.stats()}
        hint={t.statsHint()}
        checked={$displayVideoQualityStore}
        onchange={setVideoQualityStats}
    />
</PrefSection>
