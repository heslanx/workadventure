<script lang="ts">
    import type { Snippet } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { StringUtils } from "../../Utils/StringUtils";
    import Chip from "../UI/Chip.svelte";
    import Button from "../UI/Button.svelte";
    import { IconMicrophoneOff, IconCheck } from "@wa-icons";

    let editMode = $state(false);
    interface Props {
        selectedDevice?: string;
        deviceList: MediaDeviceInfo[];
        onselectdevice?: (deviceId: string | undefined) => void;
        icon?: Snippet;
        title?: Snippet;
        widget?: Snippet;
    }

    let { selectedDevice = undefined, deviceList, onselectdevice, icon, title, widget }: Props = $props();
    const uid = $props.id();
</script>

<div
    class="p-4 rounded-(--k-radius-surface) bg-(--k-card) border border-solid border-(--k-border) text-(--k-fg) mx-2 md:mx-0 w-full min-w-[300px] md:min-w-[400px] max-w-[450px] flex flex-col lg:min-h-[24rem] items-center"
>
    <div class="text-lg bold flex items-center gap-3 mb-4 ps-2">
        {@render icon?.()}
        <div id="{uid}-title" class="grow pe-8 ps-2">
            {@render title?.()}
        </div>
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

    <div class="flex w-full">
        <div class="flex flex-wrap justify-center w-full min-h-[129px]" role="radiogroup" aria-labelledby="{uid}-title">
            <div
                class="flex border border-solid w-full rounded-(--k-radius-menu) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--k-accent) items-center justify-start transition-all overflow-hidden cursor-pointer px-8 py-6 space-x-4 {!selectedDevice
                    ? 'bg-(--k-elevated) border-(--k-accent)'
                    : 'border-(--k-border-strong) hover:bg-(--k-hover) pt-4'} "
                class:hidden={!editMode && selectedDevice}
                class:flex={editMode || !selectedDevice}
                role="radio"
                aria-checked={!selectedDevice}
                tabindex="0"
                onclick={() => {
                    onselectdevice?.(undefined);
                    editMode = false;
                }}
                onkeydown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onselectdevice?.(undefined);
                        editMode = false;
                    }
                }}
            >
                <div
                    class="aspect-square me-4 h-6 rounded-full border border-solid flex items-center justify-center {!selectedDevice
                        ? 'bg-secondary border-secondary'
                        : 'border-(--k-border-strong)'}"
                >
                    {#if !selectedDevice}
                        <IconCheck font-size="20" class="text-(--k-on-accent)" aria-hidden="true" />
                    {/if}
                </div>

                <div class="space-y-1 min-w-0">
                    <div class="text-lg bold truncate leading-tight flex self-start">
                        {#if editMode && selectedDevice}
                            <IconMicrophoneOff font-size="20" aria-hidden="true" />
                        {/if}

                        {$LL.audio.disable()}
                    </div>
                    {#if !selectedDevice}
                        <Chip>{$LL.camera.active()}</Chip>
                    {:else}
                        <Chip>{$LL.camera.notRecommended()}</Chip>
                    {/if}
                </div>
            </div>
            {#each deviceList ?? [] as device (device.deviceId)}
                <div
                    class="border border-solid w-full rounded-(--k-radius-menu) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--k-accent) transition-all overflow-hidden cursor-pointer relative px-8 py-6 space-x-4 {selectedDevice ===
                    device.deviceId
                        ? 'bg-(--k-elevated) border-(--k-accent) pt-12'
                        : 'border-(--k-border-strong) hover:bg-(--k-hover) pt-4'}"
                    class:hidden={!editMode && selectedDevice !== device.deviceId}
                    class:flex={editMode || selectedDevice === device.deviceId}
                    role="radio"
                    aria-checked={selectedDevice === device.deviceId}
                    tabindex="0"
                    onclick={() => {
                        onselectdevice?.(device.deviceId);
                        editMode = false;
                    }}
                    onkeydown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onselectdevice?.(device.deviceId);
                            editMode = false;
                        }
                    }}
                >
                    {#if device.deviceId === selectedDevice}
                        {@render widget?.()}
                    {/if}
                    <div class="flex gap-4 items-center justify-start w-full">
                        <div
                            class="aspect-square h-6 rounded-full border border-solid flex items-center justify-center {selectedDevice ===
                            device.deviceId
                                ? 'bg-secondary border-secondary'
                                : 'border-(--k-border-strong)'}"
                        >
                            {#if selectedDevice == device.deviceId}
                                <IconCheck class="text-(--k-on-accent)" aria-hidden="true" />
                            {/if}
                        </div>
                        <div class="space-y-1 min-w-0">
                            <div class="text-lg bold truncate leading-tight">
                                {StringUtils.normalizeDeviceName(device.label)}
                            </div>
                            {#if device.deviceId === selectedDevice}
                                <Chip>{$LL.camera.active()}</Chip>
                            {:else}
                                <Chip>{$LL.camera.disabled()}</Chip>
                            {/if}
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    </div>
</div>
