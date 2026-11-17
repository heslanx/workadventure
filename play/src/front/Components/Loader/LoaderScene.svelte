<script lang="ts">
    import { fade } from "../../Utils/reducedMotion";
    import { loaderProgressStore } from "../../Stores/LoaderStore";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import defaultLoader from "../images/konclui-logo.svg";

    const logo = gameManager.currentStartedRoom.loadingLogo ?? defaultLoader;
    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage;
    // Without a room colour the dim layer takes the root's own colour: it still dims a room image, and adds no tint.
    const bgColor = gameManager.currentStartedRoom.backgroundColor ?? "hsl(var(--contrast-1100))";
</script>

<!-- bg-contrast-1100: the loader must stay opaque without a background image, or the scene behind shows through. -->
<div
    class="absolute top-0 left-0 z-50 h-dvh w-dvw bg-contrast-1100"
    in:fade={{ duration: 100 }}
    out:fade={{ delay: 500, duration: 300 }}
>
    <div class="flex items-center min-h-dvh w-dvw relative z-30">
        <div class="flex flex-col items-center justify-center w-full h-full relative">
            <!--
            {#if gameManager.currentStartedRoom.loadingLogo && gameManager.currentStartedRoom.showPoweredBy !== false}
                <h1 class="text-white" >COUCOU { $loaderProgressStore }</h1>
            {/if}
            -->
            <div class="mb-4 w-full flex justify-center">
                <img
                    draggable="false"
                    src={logo}
                    class="max-w-[300px] max-h-[150px] px-4"
                    alt={$LL.a11y.compRoomLogo()}
                />
            </div>
            <div
                class="w-full h-3 bg-contrast py-[2px]"
                role="progressbar"
                aria-label={$LL.a11y.compLoading()}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round($loaderProgressStore * 100)}
            >
                <!-- bg-secondary, not the room's primaryColor: the theme pins the accent so that a map cannot move it. -->
                <div
                    class="h-full transition-all duration-200 bg-secondary"
                    style="width: {$loaderProgressStore * 100}%;"
                ></div>
            </div>
        </div>
    </div>
    {#if sceneBg}
        <div
            class="absolute left-0 top-0 w-full h-full bg-cover z-10 blur"
            style="background-image: url({sceneBg});"
        ></div>
    {/if}
    <div
        class="absolute left-0 top-0 w-full h-full z-20 backdrop-blur-md opacity-70"
        style="background-color: {bgColor};"
    ></div>
</div>
