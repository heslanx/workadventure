<script lang="ts">
    import { clickOutside } from "svelte-outside";
    import { onDestroy } from "svelte";
    import { surface } from "../../../Utils/surfaceTransition";
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
    class="absolute flex flex-col gap-1.5 p-1.5 max-h-[calc(100dvh-160px)] top-20 bottom-auto mobile:top-auto mobile:bottom-20 start-1/2 transform -translate-x-1/2 text-white k-chrome rounded-lg w-64 after:content-[''] after:absolute after:-z-20 after:w-full after:bg-transparent after:h-full after:-top-4 after:-start-0 transition-all"
    transition:surface
    use:clickOutside={handleClose}
>
    <MediaSettingsListHeader bind:mode />

    <!-- No gap: a divider brings its own margin, and the panel's scroller takes what height is left. -->
    <div class="flex min-h-0 flex-1 flex-col">
        {#if mode === "settings"}
            <MediaSettingsPanel oncameraselected={handleCameraSelected} onsettingsopened={handleSettingsOpened} />
        {:else if mode === "background"}
            <BackgroundSettingsPanel />
        {/if}
    </div>
</div>
