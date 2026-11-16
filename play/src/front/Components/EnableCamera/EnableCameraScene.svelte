<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import type { EnableCameraScene } from "../../Phaser/Login/EnableCameraScene";
    import { EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import {
        requestedCameraDeviceIdStore,
        batchGetUserMediaStore,
        cameraListStore,
        localVolumeStore,
        requestedMicrophoneDeviceIdStore,
        microphoneListStore,
        speakerListStore,
        requestedCameraState,
        requestedMicrophoneState,
        speakerSelectedStore,
        localStreamStore,
        enableCameraSceneVisibilityStore,
        cameraAccessDeniedStore,
        microphoneAccessDeniedStore,
        cameraButtonHelpContextStore,
        microphoneButtonHelpContextStore,
    } from "../../Stores/MediaStore";
    import type { Game } from "../../Phaser/Game/Game";
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import { myCameraStore, myMicrophoneStore } from "../../Stores/MyMediaStore";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { gameManager, GameSceneNotFoundError } from "../../Phaser/Game/GameManager";
    import { hideHelpCameraSettings } from "../../Stores/HelpSettingsStore";
    import { playSpeakerTestSound } from "../../WebRtc/AudioOutputManager";

    import bgMap from "../images/map-exemple.webp";
    import Button from "../UI/Button.svelte";
    import Alert from "../UI/Alert.svelte";
    import PermissionHelpDetails from "../HelpSettings/PermissionHelpDetails.svelte";
    import { readDevicePreferences, restoreDevicePreferences } from "./devicePreferences";
    import HorizontalSoundMeterWidget from "./HorizontalSoundMeterWidget.svelte";
    import SelectMicrophone from "./SelectMicrophone.svelte";
    import SelectCamera from "./SelectCamera.svelte";
    import SelectSpeaker from "./SelectSpeaker.svelte";
    import { IconMicrophoneOn, IconCamera } from "@wa-icons";

    interface Props {
        game: Game;
    }

    let { game }: Props = $props();

    let enableCameraScene = $derived(game.scene.getScene(EnableCameraSceneName) as EnableCameraScene);
    const bgColor = gameManager.currentStartedRoom.backgroundColor ?? "#1B2A41";
    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage ?? bgMap;
    let legals = gameManager.currentStartedRoom?.legals ?? {};

    let selectedCamera: string | undefined = $state(undefined);
    let selectedMicrophone: string | undefined = $state(undefined);
    // Whether each list of devices is open, so that Escape closes the list before it leaves the page.
    let cameraEditing = $state(false);
    let microphoneEditing = $state(false);
    let speakerEditing = $state(false);

    // A game scene exists when the page was opened from the profile menu (the room was left to edit the devices),
    // and not on the way into the room. Only the first has a room to go back to.
    function isOpenedFromRoom(): boolean {
        try {
            gameManager.getCurrentGameScene();
            return true;
        } catch (error) {
            if (error instanceof GameSceneNotFoundError) {
                return false;
            }
            throw error;
        }
    }
    const openedFromRoom = isOpenedFromRoom();
    // The page applies a choice as soon as it is made: this is what Cancel puts back.
    const initialPreferences = readDevicePreferences();

    // From the same rule as the action bar and the media settings, which also holds for a browser without the
    // Permissions API: a blocked device is known there from its failed request.
    let cameraDenied = $derived($cameraAccessDeniedStore);
    let microphoneDenied = $derived($microphoneAccessDeniedStore);
    let permissionDenied = $derived(cameraDenied || microphoneDenied);
    // A device that is missing or that another application holds, told as the action bar tooltip tells it.
    let cameraNotice = $derived(
        $cameraButtonHelpContextStore === "no_device"
            ? { title: $LL.camera.help.tooltip.noDeviceTitle(), description: $LL.camera.help.tooltip.noDeviceDesc() }
            : $cameraButtonHelpContextStore === "device_in_use"
              ? {
                    title: $LL.camera.help.tooltip.deviceInUseTitle(),
                    description: $LL.camera.help.tooltip.deviceInUseDesc(),
                }
              : undefined,
    );
    let microphoneNotice = $derived(
        $microphoneButtonHelpContextStore === "no_device"
            ? {
                  title: $LL.camera.help.microphoneTooltip.noDeviceTitle(),
                  description: $LL.camera.help.microphoneTooltip.noDeviceDesc(),
              }
            : $microphoneButtonHelpContextStore === "device_in_use"
              ? {
                    title: $LL.camera.help.microphoneTooltip.deviceInUseTitle(),
                    description: $LL.camera.help.microphoneTooltip.deviceInUseDesc(),
                }
              : undefined,
    );

    let legalStrings: string[] = [];
    if (legals?.termsOfUseUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.termsOfUseUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.termsOfUse() +
                "</a>",
        );
    }
    if (legals?.privacyPolicyUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.privacyPolicyUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.privacyPolicy() +
                "</a>",
        );
    }
    if (legals?.cookiePolicyUrl) {
        legalStrings.push(
            '<a href="' +
                encodeURI(legals.cookiePolicyUrl) +
                '" target="_blank" class="text-white no-underline hover:underline bold hover:text-white">' +
                $LL.login.cookiePolicy() +
                "</a>",
        );
    }

    let legalString: string | undefined = $state();
    if (legalStrings.length > 0) {
        if (Intl.ListFormat) {
            const formatter = new Intl.ListFormat($locale, { style: "long", type: "conjunction" });
            legalString = formatter.format(legalStrings);
        } else {
            // For old browsers
            legalString = legalStrings.join(", ");
        }
    }

    function submit() {
        // Picking a device or "Disable" is applied at click time (see handleSelect*). Re-applying the displayed
        // selection here would turn off a device whose track is not delivered yet, and pin the browser's default device
        // as the preferred one. A saved preferred device is what marks this page as done (see GameManager): "" means
        // no preference, follow the system default.
        localUserStore.setPreferredVideoInputDevice(localUserStore.getPreferredVideoInputDevice() ?? "");
        localUserStore.setPreferredAudioInputDevice(localUserStore.getPreferredAudioInputDevice() ?? "");
        enableCameraScene.login();
    }

    // Back to the room that was left, with the devices as they were: the way out of a page opened from the menu.
    function cancel() {
        restoreDevicePreferences(initialPreferences);
        enableCameraSceneVisibilityStore.hideEnableCameraScene();
        enableCameraScene.scene.sleep(EnableCameraSceneName);
        gameManager.goToStartingMap();
    }

    function onWindowKeydown(event: KeyboardEvent) {
        if (event.key !== "Escape" || event.defaultPrevented) {
            return;
        }
        if (cameraEditing || microphoneEditing || speakerEditing) {
            event.preventDefault();
            cameraEditing = false;
            microphoneEditing = false;
            speakerEditing = false;
            return;
        }
        if (openedFromRoom) {
            event.preventDefault();
            cancel();
        }
    }

    function srcObject(node: HTMLVideoElement, stream: MediaStream) {
        node.srcObject = stream;
        return {
            update(newStream: MediaStream) {
                if (node.srcObject != newStream) {
                    node.srcObject = newStream;
                }
            },
        };
    }

    let stream: MediaStream | undefined;

    const unsubscribeLocalStreamStore = localStreamStore.subscribe((value) => {
        if (value.type === "success") {
            stream = value.stream;

            if (stream !== undefined) {
                const videoTracks = stream.getVideoTracks();
                if (videoTracks.length > 0) {
                    selectedCamera = videoTracks[0].getSettings().deviceId;
                } else {
                    selectedCamera = undefined;
                }
                const audioTracks = stream.getAudioTracks();
                if (audioTracks.length > 0) {
                    selectedMicrophone = audioTracks[0].getSettings().deviceId;
                } else {
                    selectedMicrophone = undefined;
                }
            }
        } else {
            stream = undefined;
            selectedCamera = undefined;
            selectedMicrophone = undefined;
        }
    });

    onDestroy(() => {
        unsubscribeLocalStreamStore();
        // The page explained a blocked device. The popup that waits in the popup store (it shows when the map is up)
        // and the one-time help of the first start would say it again at the start of the world.
        // (Read from the stores: a $derived of this component is torn down by now.)
        if (get(cameraAccessDeniedStore) || get(microphoneAccessDeniedStore)) {
            hideHelpCameraSettings();
            localUserStore.setHelpCameraSettingsShown();
        }
    });

    onMount(() => {
        //init the component to enable webcam and microphone
        batchGetUserMediaStore.startBatch();
        myCameraStore.set(true);
        myMicrophoneStore.set(true);
        requestedCameraState.enableWebcam();

        requestedMicrophoneState.enableMicrophone();

        batchGetUserMediaStore.commitChanges();
    });

    function handleSelectCamera(deviceId: string | undefined) {
        selectCamera(deviceId);
    }

    function handleSelectMicrophone(device: string | undefined) {
        selectMicrophone(device);
    }

    function handleSelectSpeaker(deviceId: string | undefined) {
        selectSpeaker(deviceId);
    }

    function selectCamera(newCameraSelected: string | undefined = undefined) {
        selectedCamera = newCameraSelected;
        if (!selectedCamera) {
            localUserStore.setPreferredVideoInputDevice("");
            requestedCameraState.disableWebcam();
            return;
        }
        requestedCameraState.enableWebcam();
        requestedCameraDeviceIdStore.set(selectedCamera);
        localUserStore.setPreferredVideoInputDevice(selectedCamera);
    }

    function selectMicrophone(newMicrophoneSelected: string | undefined = undefined) {
        selectedMicrophone = newMicrophoneSelected;
        if (!selectedMicrophone) {
            localUserStore.setPreferredAudioInputDevice("");
            requestedMicrophoneState.disableMicrophone();
            return;
        }
        requestedMicrophoneState.enableMicrophone();
        requestedMicrophoneDeviceIdStore.set(selectedMicrophone);
        localUserStore.setPreferredAudioInputDevice(selectedMicrophone);
    }

    function selectSpeaker(deviceId: string | undefined) {
        localUserStore.setSpeakerDeviceId(deviceId ?? "");
        speakerSelectedStore.set(deviceId);
    }

    function playSoundClick() {
        playSpeakerTestSound().catch((e) => console.error(e));
    }
    /* eslint-disable svelte/no-at-html-tags */
</script>

<svelte:window onkeydown={onWindowKeydown} />

<form
    class="enableCameraScene pointer-events-auto relative z-30 m-0 px-2"
    onsubmit={(event) => {
        event.preventDefault();
        submit();
    }}
>
    <section class="flex min-h-dvh">
        <div
            class="text-white justify-center items-center overflow-hidden w-[100vw] container flex flex-col min-h-dvh pb-42 md:pb-36 pt-8 lg:pt-0 relative"
        >
            <section class="mb-4 text-center">
                <h2 class="h4">{$LL.camera.enable.title()}</h2>
                <p class="opacity-70 w-2/3 m-auto pt-2 hidden md:block">
                    {$LL.camera.enable.start()}
                </p>
            </section>

            <!-- Why a device does not work and what to do, here where the user can still choose another device -->
            <div aria-live="polite" class="w-full flex flex-col items-center gap-3" data-testid="enable-camera-help">
                {#if permissionDenied}
                    <!-- Dark and nearly opaque: the dimmed explanation needs 4.5:1 on any background image -->
                    <section class="mb-4 mx-2 md:mx-0 w-full max-w-[560px] rounded-lg bg-contrast/90 text-center">
                        <h3 class="m-0 text-lg bold border border-solid border-transparent border-b-white/20 px-4 py-3">
                            {#if cameraDenied && microphoneDenied}
                                {$LL.camera.help.title()}
                            {:else if cameraDenied}
                                {$LL.camera.help.cameraTitle()}
                            {:else}
                                {$LL.camera.help.microphoneTitle()}
                            {/if}
                        </h3>
                        <PermissionHelpDetails camera={cameraDenied} microphone={microphoneDenied} />
                    </section>
                {/if}
                {#each [cameraNotice, microphoneNotice] as notice, index (index)}
                    {#if notice}
                        <Alert variant="warning" class="mb-4 mx-2 md:mx-0 w-full max-w-[560px] text-start">
                            <strong>{notice.title}</strong>
                            <p class="m-0">{notice.description}</p>
                        </Alert>
                    {/if}
                {/each}
            </div>

            <div
                class="flex md:flex-wrap flex-col gap-4 w-full items-center justify-center lg:flex-row lg:items-stretch lg:px-4 lg:pb-4"
            >
                <!-- MICROPHONE -->

                <SelectMicrophone
                    bind:editMode={microphoneEditing}
                    onselectdevice={handleSelectMicrophone}
                    deviceList={$microphoneListStore ?? []}
                    selectedDevice={selectedMicrophone}
                >
                    {#snippet icon()}
                        <IconMicrophoneOn font-size="24" aria-hidden="true" />
                    {/snippet}
                    {#snippet title()}
                        <span>{$LL.actionbar.subtitle.microphone()}</span>
                    {/snippet}
                    {#snippet widget()}
                        <div class="absolute top-4 start-0 flex justify-center w-full">
                            <HorizontalSoundMeterWidget spectrum={$localVolumeStore} />
                        </div>
                    {/snippet}
                </SelectMicrophone>

                <!-- CAMERA -->
                <SelectCamera
                    bind:editMode={cameraEditing}
                    onselectdevice={handleSelectCamera}
                    deviceList={$cameraListStore ?? []}
                    selectedDevice={selectedCamera}
                >
                    {#snippet icon()}
                        <IconCamera font-size="24" aria-hidden="true" />
                    {/snippet}
                    {#snippet title()}
                        <span>{$LL.camera.editCam()}</span>
                    {/snippet}
                    {#snippet widget()}
                        <span>
                            {#if selectedCamera !== undefined && $localStreamStore.type === "success" && $localStreamStore.stream}
                                <video
                                    class="myCamVideoSetup bg-contrast/80 backdrop-blur flex items-center justify-center w-full aspect-video overflow-hidden scale-x-[-1]"
                                    use:srcObject={$localStreamStore.stream}
                                    autoplay
                                    muted
                                    playsinline
                                ></video>
                            {:else}
                                <div
                                    class="webrtcsetup flex items-center justify-center w-full aspect-video rounded-lg overflow-hidden bg-contrast"
                                >
                                    {$LL.camera.my.loading()}
                                </div>
                            {/if}
                        </span>
                    {/snippet}
                </SelectCamera>

                <!-- SPEAKER -->
                {#if $speakerSelectedStore != undefined && $speakerListStore && $speakerListStore.length > 0}
                    <SelectSpeaker
                        bind:editMode={speakerEditing}
                        onplaysound={playSoundClick}
                        onselectdevice={handleSelectSpeaker}
                        deviceList={$speakerListStore ?? []}
                        selectedDevice={$speakerSelectedStore}
                    />
                {/if}
            </div>
            <div
                class="fixed bottom-0 start-0 !w-[100vw] bg-contrast/80 backdrop-blur-md border border-solid border-t border-b-0 border-x-0 border-white/10"
            >
                <section
                    class="container m-auto p-4 flex flex-col-reverse md:flex-row items-center justify-center gap-2 md:gap-4"
                >
                    {#if openedFromRoom}
                        <Button
                            variant="light"
                            appearance="ghost"
                            size="lg"
                            class="w-full md:w-1/2 block enableCameraSceneFormCancel"
                            onclick={(event) => {
                                event.preventDefault();
                                cancel();
                            }}
                        >
                            {$LL.actionbar.cancel()}
                        </Button>
                    {/if}
                    <Button
                        type="submit"
                        variant="secondary"
                        size="lg"
                        class="w-full md:w-1/2 block enableCameraSceneFormSubmit"
                    >
                        {openedFromRoom ? $LL.menu.settings.save() : $LL.camera.enable.join()}
                    </Button>
                </section>
                {#if legalString}
                    <section class="terms-and-conditions h-fit z-40 text-center w-full">
                        <a style="display: none;" href="traduction">Need for traduction</a>
                        <p class="text-white text-xs italic opacity-70">
                            {@html $LL.login.terms({
                                links: legalString,
                            })}
                        </p>
                    </section>
                {/if}
            </div>
        </div>
    </section>
</form>
<div class="fixed start-0 top-0 w-dvw h-dvh bg-cover z-10" style="background-image: url('{sceneBg}');"></div>
<div class="fixed start-0 top-0 w-dvw h-dvh bg-contrast/80 z-20" style="background-color: '{bgColor}';"></div>

<style>
    .enableCameraScene {
        h2 {
            margin: 1px;
        }

        section.text-center {
            text-align: center;
        }
    }
</style>
