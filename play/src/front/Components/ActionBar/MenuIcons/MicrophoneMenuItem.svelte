<script lang="ts">
    import type { Readable } from "svelte/store";
    import { derived } from "svelte/store";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import ActionBarButton from "../ActionBarButton.svelte";
    import {
        availabilityStatusStore,
        microphoneButtonHelpContextStore,
        microphoneListStore,
        requestedMicrophoneState,
        silentStore,
    } from "../../../Stores/MediaStore";
    import { openedMenuStore } from "../../../Stores/MenuStore";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import { getPermissionHelpBrowser, getPermissionHelpScreenshot } from "../../HelpSettings/permissionHelp";
    import { showHelpForBlockedDevices } from "../../../Stores/HelpSettingsStore";
    import { getColorHexOfStatus, getStatusLabel } from "../../../Utils/AvailabilityStatus";
    import { canComeBackFrom, heldMediaStore, toggleMicrophone } from "../../../Stores/HeldMediaStore";

    import MicOnIcon from "../../Icons/MicOnIcon.svelte";
    import MicOffIcon from "../../Icons/MicOffIcon.svelte";

    // Turned off by the user: off (red), even under a status that would hold it. Held by the status: see statusDot.
    const microphoneButtonStateStore: Readable<"active" | "disabled" | "normal" | "forbidden"> = derived(
        [requestedMicrophoneState, microphoneListStore, silentStore],
        ([$requestedMicrophoneState, $microphoneListStore, $silentStore]) => {
            if ($silentStore || ($microphoneListStore !== undefined && $microphoneListStore.length === 0)) {
                return "disabled";
            }
            return $requestedMicrophoneState ? "normal" : "forbidden";
        },
    );

    const microphoneActionBarTooltipStore = derived(
        [LL, locale, microphoneButtonHelpContextStore, heldMediaStore, silentStore, availabilityStatusStore],
        ([$LL, $locale, ctx, held, silent, status]) => {
            if (held.microphone && canComeBackFrom(held.status)) {
                return {
                    title: $LL.actionbar.help.micPausedByStatus.title(),
                    desc: $LL.actionbar.help.micPausedByStatus.desc({ status: getStatusLabel(held.status) }),
                    media: "",
                };
            }
            if (held.microphone || silent) {
                return {
                    title: $LL.actionbar.help.micDisabledByStatus.title(),
                    desc: $LL.actionbar.help.micDisabledByStatus.desc({
                        status: getStatusLabel(held.microphone ? held.status : status),
                    }),
                    media: "",
                };
            }
            // A screenshot only where one shows this browser in this language: no image otherwise.
            const permissionMedia = getPermissionHelpScreenshot(getPermissionHelpBrowser(), $locale) ?? "";

            if (ctx === "permission") {
                return {
                    title: $LL.camera.help.microphoneTooltip.permissionDeniedTitle(),
                    desc: $LL.camera.help.microphoneTooltip.permissionDeniedFix(),
                    media: permissionMedia,
                };
            }
            if (ctx === "no_device") {
                return {
                    title: $LL.camera.help.microphoneTooltip.noDeviceTitle(),
                    desc: $LL.camera.help.microphoneTooltip.noDeviceDesc(),
                    media: "",
                };
            }
            if (ctx === "device_in_use") {
                return {
                    title: $LL.camera.help.microphoneTooltip.deviceInUseTitle(),
                    desc: $LL.camera.help.microphoneTooltip.deviceInUseDesc(),
                    media: "",
                };
            }
            return { title: "", desc: "", media: "" };
        },
    );

    function microphoneClick(): void {
        analyticsClient.trackAdminEvent("media.microphone.toggled");
        if ($silentStore) return;
        // The fix in the tooltip needs a hover: a tap or Enter on a microphone the browser blocks opens it as a popup.
        if ($microphoneButtonHelpContextStore === "permission" && !$heldMediaStore.microphone) {
            showHelpForBlockedDevices({ microphone: true });
        }
        toggleMicrophone();
    }
</script>

<ActionBarButton
    onclick={microphoneClick}
    classList="group/btn-mic peer/mic"
    disabledHelp={$openedMenuStore !== undefined}
    state={$microphoneButtonStateStore}
    statusDot={$heldMediaStore.microphone ? getColorHexOfStatus($heldMediaStore.status) : undefined}
    statusDotClickable={canComeBackFrom($heldMediaStore.status)}
    ariaLabel={$LL.actionbar.help.mic.title()}
    pressed={Boolean(
        $requestedMicrophoneState && !$silentStore && $microphoneListStore && $microphoneListStore.length > 0,
    )}
    dataTestId="microphone-button"
    tooltipTitle={$microphoneActionBarTooltipStore.title}
    desc={$microphoneActionBarTooltipStore.desc}
    media={$microphoneActionBarTooltipStore.media}
>
    {#if $requestedMicrophoneState && !$silentStore && $microphoneListStore && $microphoneListStore.length > 0}
        <MicOnIcon height="h-5" width="w-5" strokeWidth="2" />
    {:else}
        <MicOffIcon height="h-5" width="w-5" strokeWidth="2" />
    {/if}
</ActionBarButton>
