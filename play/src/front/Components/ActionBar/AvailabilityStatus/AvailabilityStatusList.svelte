<script lang="ts">
    import { AvailabilityStatus } from "@workadventure/messages";
    import { resetAllStatusStoreExcept } from "../../../Rules/StatusRules/statusChangerFunctions";
    import type { RequestedStatus } from "../../../Rules/StatusRules/statusRules";
    import { availabilityStatusStore } from "../../../Stores/MediaStore";
    import { getColorHexOfStatus, getStatusLabel } from "../../../Utils/AvailabilityStatus";
    import LL from "../../../../i18n/i18n-svelte";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import HeaderMenuItem from "../MenuIcons/HeaderMenuItem.svelte";
    import { openedMenuStore } from "../../../Stores/MenuStore";
    import type { StatusInformationInterface } from "./Interfaces/AvailabilityStatusPropsInterface";
    import { IconCheck } from "@wa-icons";

    interface Props {
        statusInformation: Array<StatusInformationInterface>;
        align?: "end" | "start";
    }

    let { statusInformation, align = "start" }: Props = $props();

    const handleKeyPress = (e: KeyboardEvent, newStatus: RequestedStatus | AvailabilityStatus.ONLINE | null) => {
        if (newStatus === AvailabilityStatus.ONLINE) newStatus = null;
        if (e.key === "Enter") {
            resetAllStatusStoreExcept(newStatus);
            openedMenuStore.close("profileMenu");
        }
    };
    const handleClick = (newStatus: RequestedStatus | AvailabilityStatus.ONLINE | null) => {
        if (newStatus === AvailabilityStatus.ONLINE) newStatus = null;
        resetAllStatusStoreExcept(newStatus);
        openedMenuStore.close("profileMenu");
    };
</script>

<div class="flex flex-col gap-0.5">
    <ExternalComponents zone="availabilityStatus" />

    <HeaderMenuItem label={$LL.actionbar.listStatusTitle.enable()} separated={false} />
    <!-- Some status (silent, in a meeting...) are locking the status bar to only one option -->
    {#if [AvailabilityStatus.LISTENER, AvailabilityStatus.SPEAKER, AvailabilityStatus.JITSI, AvailabilityStatus.LIVEKIT, AvailabilityStatus.BBB, AvailabilityStatus.DENY_PROXIMITY_MEETING, AvailabilityStatus.SILENT, AvailabilityStatus.SOUND_BLOCKED].includes($availabilityStatusStore)}
        <button type="button" class="status-button k-menu-row pointer-events-auto" aria-current="true">
            <span class="k-menu-lead" aria-hidden="true">
                <span
                    class="size-2.5 rounded-full"
                    style:background-color={getColorHexOfStatus($availabilityStatusStore)}
                ></span>
            </span>
            <span class="k-menu-label">{getStatusLabel($availabilityStatusStore)}</span>
            <IconCheck class="k-menu-mark" aria-hidden="true" />
        </button>
    {:else}
        {#each statusInformation as statusInformationValue (statusInformationValue.AvailabilityStatus)}
            {@const current = $availabilityStatusStore === statusInformationValue.AvailabilityStatus}
            <!-- The current status is shown as the office menu shows it: mint ink and the check mark. -->
            <button
                type="button"
                class="status-button k-menu-row pointer-events-auto"
                class:justify-end={align === "end"}
                aria-current={current ? "true" : undefined}
                onkeyup={(e) => {
                    handleKeyPress(e, statusInformationValue.AvailabilityStatus);
                }}
                onclick={(event) => {
                    event.stopPropagation();
                    handleClick(statusInformationValue.AvailabilityStatus);
                }}
            >
                <span class="k-menu-lead" aria-hidden="true">
                    <span class="size-2.5 rounded-full" style:background-color={statusInformationValue.colorHex}></span>
                </span>
                <span class="k-menu-label">{statusInformationValue.label}</span>
                {#if current}
                    <IconCheck class="k-menu-mark" aria-hidden="true" />
                {/if}
            </button>
        {/each}
    {/if}
</div>
