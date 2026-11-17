<script lang="ts">
    import { clickOutside } from "svelte-outside";
    import { onDestroy } from "svelte";
    import { fly } from "../../../Utils/reducedMotion";
    import { inBackgroundSettingsStore } from "../../../Stores/MediaStore";
    import MediaSettingsListHeader from "./MediaSettingsListHeader.svelte";
    import MediaSettingsPanel from "./MediaSettingsPanel.svelte";
    import BackgroundSettingsPanel from "./BackgroundSettingsPanel.svelte";

    interface Props {
        mediaSettingsDisplayed?: boolean;
        onclose?: () => void;
    }

    let { mediaSettingsDisplayed = $bindable<boolean>(), onclose }: Props = $props();

    if (mediaSettingsDisplayed === undefined) {
        mediaSettingsDisplayed = false;
    }

    let mode: "settings" | "background" = $state("settings");

    $effect(() => {
        inBackgroundSettingsStore.set(mode === "background");
    });

    onDestroy(() => {
        inBackgroundSettingsStore.set(false);
    });

    function handleClose() {
        onclose?.();
    }

    function handleCameraSelected() {
        mediaSettingsDisplayed = false;
    }

    function handleSettingsOpened() {
        mediaSettingsDisplayed = false;
    }
</script>

<div
    data-testid="media-settings-panel"
    class="absolute pb-2 top-20 bottom-auto mobile:top-auto mobile:bottom-20 start-1/2 transform -translate-x-1/2 text-white k-chrome rounded-lg w-64 after:content-[''] after:absolute after:-z-20 after:w-full after:bg-transparent after:h-full after:-top-4 after:-start-0 transition-all"
    in:fly={{ y: 40, duration: 150 }}
    use:clickOutside={handleClose}
>
    <div class="flex flex-col gap-2 p-1 relative" style="max-height: calc(100vh - 160px);">
        <div class="sticky top-0 z-20 -mx-1 px-1 pt-1 -mt-1">
            <MediaSettingsListHeader bind:mode />
        </div>

        <div class="flex flex-col gap-2 flex-1 min-h-0">
            {#if mode === "settings"}
                <MediaSettingsPanel oncameraselected={handleCameraSelected} onsettingsopened={handleSettingsOpened} />
            {:else if mode === "background"}
                <BackgroundSettingsPanel />
            {/if}
        </div>
    </div>
</div>
