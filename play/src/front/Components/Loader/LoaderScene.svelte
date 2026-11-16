<script lang="ts">
    import { fade } from "../../Utils/reducedMotion";
    import { loaderProgressStore } from "../../Stores/LoaderStore";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import bgMap from "../images/map-exemple.webp";
    import defaultLoader from "../images/Workadventure.gif";

    const logo = gameManager.currentStartedRoom.loadingLogo ?? defaultLoader;
    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage ?? bgMap;
    const bgColor = gameManager.currentStartedRoom.backgroundColor ?? "#1B2A41";
    const primary = gameManager.currentStartedRoom.primaryColor ?? "#4056F6";
</script>

<div
    class="absolute top-0 left-0 z-50 h-dvh w-dvw"
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
                <div
                    class="h-full transition-all duration-200"
                    style="width: {$loaderProgressStore * 100}%; background-color: {primary};"
                ></div>
            </div>
        </div>
    </div>
    <div class="absolute left-0 top-0 w-full h-full bg-cover z-10 blur" style="background-image: url({sceneBg});"></div>
    <div
        class="absolute left-0 top-0 w-full h-full z-20 backdrop-blur-md opacity-70"
        style="background-color: {bgColor};"
    ></div>
</div>
