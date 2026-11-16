<script lang="ts">
    import { AvailabilityStatus } from "@workadventure/messages";
    import type { Readable } from "svelte/store";
    import { derived } from "svelte/store";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import CamOnIcon from "../../Icons/CamOnIcon.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import CamOffIcon from "../../Icons/CamOffIcon.svelte";
    import {
        availabilityStatusStore,
        cameraButtonHelpContextStore,
        cameraListStore,
        mouseIsHoveringCameraButton,
        requestedCameraState,
        silentStore,
    } from "../../../Stores/MediaStore";

    import { openedMenuStore } from "../../../Stores/MenuStore";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import { getPermissionHelpBrowser, getPermissionHelpScreenshot } from "../../HelpSettings/permissionHelp";
    import { showHelpForBlockedDevices } from "../../../Stores/HelpSettingsStore";
    import { getColorHexOfStatus, getStatusLabel } from "../../../Utils/AvailabilityStatus";
    import { canComeBackFrom, heldMediaStore, toggleCamera } from "../../../Stores/HeldMediaStore";

    // Turned off by the user: off (red), even under a status that would hold it. Held by the status: see statusDot.
    const cameraButtonStateStore: Readable<"active" | "disabled" | "normal" | "forbidden"> = derived(
        [requestedCameraState, cameraListStore, silentStore],
        ([$requestedCameraState, $cameraListStore, $silentStore]) => {
            if ($silentStore || ($cameraListStore !== undefined && $cameraListStore.length === 0)) {
                return "disabled";
            }
            return $requestedCameraState ? "normal" : "forbidden";
        },
    );

    const cameraActionBarTooltipStore = derived(
        [LL, locale, cameraButtonHelpContextStore, heldMediaStore, silentStore, availabilityStatusStore],
        ([$LL, $locale, ctx, held, silent, status]) => {
            if (held.camera && canComeBackFrom(held.status)) {
                return {
                    title: $LL.actionbar.help.camPausedByStatus.title(),
                    desc: $LL.actionbar.help.camPausedByStatus.desc({ status: getStatusLabel(held.status) }),
                    media: "",
                };
            }
            if (held.camera || silent) {
                return {
                    title: $LL.actionbar.help.camDisabledByStatus.title(),
                    desc: $LL.actionbar.help.camDisabledByStatus.desc({
                        status: getStatusLabel(held.camera ? held.status : status),
                    }),
                    media: "",
                };
            }
            // A screenshot only where one shows this browser in this language: no image otherwise.
            const permissionMedia = getPermissionHelpScreenshot(getPermissionHelpBrowser(), $locale) ?? "";

            if (ctx === "permission") {
                return {
                    title: $LL.camera.help.tooltip.permissionDeniedTitle(),
                    desc: $LL.camera.help.tooltip.permissionDeniedFix(),
                    media: permissionMedia,
                };
            }
            if (ctx === "no_device") {
                return {
                    title: $LL.camera.help.tooltip.noDeviceTitle(),
                    desc: $LL.camera.help.tooltip.noDeviceDesc(),
                    media: "",
                };
            }
            if (ctx === "device_in_use") {
                return {
                    title: $LL.camera.help.tooltip.deviceInUseTitle(),
                    desc: $LL.camera.help.tooltip.deviceInUseDesc(),
                    media: "",
                };
            }
            return { title: "", desc: "", media: "" };
        },
    );

    function cameraClick(): void {
        analyticsClient.trackAdminEvent("media.camera.toggled");
        if ($silentStore) return;
        // The fix in the tooltip needs a hover: a tap or Enter on a camera the browser blocks opens it as a popup.
        if ($cameraButtonHelpContextStore === "permission" && !$heldMediaStore.camera) {
            showHelpForBlockedDevices({ camera: true });
        }
        toggleCamera();
    }
</script>

<ActionBarButton
    onclick={cameraClick}
    classList="group/btn-cam"
    disabledHelp={$openedMenuStore !== undefined}
    state={$cameraButtonStateStore}
    statusDot={$heldMediaStore.camera ? getColorHexOfStatus($heldMediaStore.status) : undefined}
    statusDotClickable={canComeBackFrom($heldMediaStore.status)}
    ariaLabel={$LL.actionbar.help.cam.title()}
    pressed={Boolean($requestedCameraState && !$silentStore && $cameraListStore && $cameraListStore.length > 0)}
    dataTestId="camera-button"
    tooltipTitle={$cameraActionBarTooltipStore.title}
    desc={$cameraActionBarTooltipStore.desc}
    media={$cameraActionBarTooltipStore.media}
    onmouseenter={() => {
        if ($availabilityStatusStore === AvailabilityStatus.ONLINE) mouseIsHoveringCameraButton.set(true);
        else mouseIsHoveringCameraButton.set(false);
    }}
    onmouseleave={() => mouseIsHoveringCameraButton.set(false)}
>
    {#if $requestedCameraState && !$silentStore && $cameraListStore && $cameraListStore.length > 0}
        <CamOnIcon height="h-5" width="w-5" strokeWidth="2" />
    {:else}
        <CamOffIcon height="h-5" width="w-5" strokeWidth="2" />
    {/if}
</ActionBarButton>
