<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { StringUtils } from "../../Utils/StringUtils";
    import Chip from "../UI/Chip.svelte";
    import Button from "../UI/Button.svelte";
    import { IconCheck, IconUnMute } from "@wa-icons";

    let editMode = $state(false);

    interface Props {
        selectedDevice?: string;
        deviceList: MediaDeviceInfo[];
        onplaysound?: (deviceId: string | undefined) => void;
        onselectdevice?: (deviceId: string | undefined) => void;
    }

    let { selectedDevice = undefined, deviceList, onplaysound, onselectdevice }: Props = $props();
    const uid = $props.id();
</script>

<div
    class="p-4 rounded-(--k-radius-surface) bg-(--k-card) border border-solid border-(--k-border) text-(--k-fg) mx-2 md:mx-0 w-full min-w-[300px] md:min-w-[400px] max-w-[450px] flex flex-col lg:min-h-[24rem] items-center"
>
    <div class="text-lg bold flex items-center justify-center gap-3 mb-4 ps-2">
        <IconUnMute font-size="28" aria-hidden="true" />
        <div id="{uid}-title" class="grow pe-8 ps-2">{$LL.camera.editSpeaker()}</div>
        <Button
            variant={!editMode ? "secondary" : "light"}
            appearance={!editMode ? "filled" : "ghost"}
            class="rounded-full font-semibold"
            onclick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                editMode = !editMode;
            }}
        >
            {!editMode ? $LL.actionbar.edit() : $LL.actionbar.cancel()}
        </Button>
    </div>

    <div class="flex items-center justify-center w-full">
        <div class="flex flex-wrap items-center justify-center w-full" role="radiogroup" aria-labelledby="{uid}-title">
            {#each deviceList as speaker, index (index)}
                <div
                    class="border border-solid w-full rounded-(--k-radius-menu) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--k-accent) items-center justify-between transition-all overflow-hidden cursor-pointer relative px-8 py-6 space-x-4 {selectedDevice ===
                    speaker.deviceId
                        ? 'bg-(--k-elevated) border-(--k-accent)'
                        : 'border-(--k-border-strong) hover:bg-(--k-hover)'}"
                    class:flex={editMode || selectedDevice === speaker.deviceId}
                    class:hidden={!editMode && selectedDevice !== speaker.deviceId}
                    role="radio"
                    aria-checked={selectedDevice === speaker.deviceId}
                    tabindex="0"
                    onclick={() => {
                        onselectdevice?.(speaker.deviceId);
                        onplaysound?.(speaker.deviceId);
                        editMode = false;
                    }}
                    onkeydown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onselectdevice?.(speaker.deviceId);
                            onplaysound?.(speaker.deviceId);
                            editMode = false;
                        }
                    }}
                >
                    <div class="flex items-center space-x-4 overflow-hidden truncate">
                        <div
                            class="aspect-square me-4 h-6 rounded-full border border-solid flex items-center justify-center {selectedDevice ===
                            speaker.deviceId
                                ? 'bg-secondary border-secondary'
                                : 'border-(--k-border-strong)'}"
                        >
                            {#if selectedDevice === speaker.deviceId}
                                <IconCheck class="text-(--k-on-accent)" aria-hidden="true" />
                            {/if}
                        </div>
                        <div class="space-y-1 min-w-0">
                            <div class="text-lg bold truncate leading-tight">
                                {StringUtils.normalizeDeviceName(speaker.label)}
                            </div>
                            {#if selectedDevice === speaker.deviceId}
                                <Chip>{$LL.camera.active()}</Chip>
                            {:else}
                                <Chip>{$LL.camera.disabled()}</Chip>
                            {/if}
                        </div>
                    </div>
                    {#if selectedDevice === speaker.deviceId}
                        <Button
                            variant="secondary"
                            square
                            class="self-end rounded-full"
                            type="button"
                            aria-label={$LL.actionbar.speaker.test()}
                            title={$LL.actionbar.speaker.test()}
                        >
                            {#snippet icon()}
                                <!-- TODO HUGO -->
                                <IconUnMute font-size="20" aria-hidden="true" />
                            {/snippet}
                        </Button>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
</div>
