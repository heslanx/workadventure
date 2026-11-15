<script lang="ts">
    import { onMount } from "svelte";
    import { fly } from "../../Utils/reducedMotion";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL } from "../../../i18n/i18n-svelte";
    import Button from "../UI/Button.svelte";
    import { activateOnEnterOrSpace } from "../../Utils/activateOnEnterOrSpace";

    const uid = $props.id();

    let gameScene = gameManager.getCurrentGameScene();

    let expandedMapCopyright = $state(false);
    let expandedTilesetCopyright = $state(false);
    let expandedAudioCopyright = $state(false);

    let mapName = $state("");
    let mapLink = $state("");
    let mapDescription = $state("");
    let mapCopyright: string = $state($LL.menu.about.copyrights.map.empty());
    let tilesetCopyright: string[] = $state([]);
    let audioCopyright: string[] = $state([]);

    onMount(() => {
        if (gameScene.mapFile.properties !== undefined) {
            const propertyName = gameScene.mapFile.properties.find((property) => property.name === "mapName");
            if (propertyName !== undefined && typeof propertyName.value === "string") {
                mapName = propertyName.value;
            }
            const propertyLink = gameScene.mapFile.properties.find((property) => property.name === "mapLink");
            if (propertyLink !== undefined && typeof propertyLink.value === "string") {
                mapLink = propertyLink.value;
            }
            const propertyDescription = gameScene.mapFile.properties.find(
                (property) => property.name === "mapDescription",
            );
            if (propertyDescription !== undefined && typeof propertyDescription.value === "string") {
                mapDescription = propertyDescription.value;
            }
            const propertyCopyright = gameScene.mapFile.properties.find((property) => property.name === "mapCopyright");
            if (propertyCopyright !== undefined && typeof propertyCopyright.value === "string") {
                mapCopyright = propertyCopyright.value;
            }
        }

        for (const tileset of gameScene.mapFile.tilesets) {
            if ("properties" in tileset && tileset.properties !== undefined) {
                const propertyTilesetCopyright = tileset.properties.find(
                    (property) => property.name === "tilesetCopyright",
                );
                if (propertyTilesetCopyright !== undefined && typeof propertyTilesetCopyright.value === "string") {
                    // Assignment needed to trigger Svelte's reactivity (remove duplicates)
                    tilesetCopyright = Array.from(new Set([...tilesetCopyright, propertyTilesetCopyright.value]));
                }
            }
        }

        for (const layer of gameScene.mapFile.layers) {
            if (layer.type && layer.type === "tilelayer" && layer.properties) {
                const propertyAudioCopyright = layer.properties.find((property) => property.name === "audioCopyright");
                if (propertyAudioCopyright !== undefined && typeof propertyAudioCopyright.value === "string") {
                    // Assignment needed to trigger Svelte's reactivity (remove duplicates)
                    audioCopyright = Array.from(new Set([...audioCopyright, propertyAudioCopyright.value]));
                }
            }
        }
    });
</script>

<div class="about-room-main text-center py-8" transition:fly={{ x: -700, duration: 250 }}>
    <h2 class="h4 light">{$LL.menu.about.mapInfo()}</h2>
    <section class="container-overflow p-0">
        <h3 class="h5 text-white/60">{mapName}</h3>
        <p class="whitespace-pre-line italic text-white/60">{mapDescription}</p>
        {#if mapLink}
            <Button href={mapLink} variant="secondary" size="sm" class="uppercase inline-block" target="_blank"
                >{$LL.menu.about.mapLink()}</Button
            >
        {/if}
        <div
            class="mt-4 text-lg font-bold flex items-center py-4 px-8 cursor-pointer border-y border-x-0 border-solid border-white/20 {expandedMapCopyright
                ? 'bg-secondary'
                : 'bg-contrast/50 hover:bg-contrast'}"
            role="button"
            tabindex="0"
            aria-expanded={expandedMapCopyright}
            aria-controls="{uid}-map"
            onclick={() => (expandedMapCopyright = !expandedMapCopyright)}
            onkeydown={(event) => activateOnEnterOrSpace(event, () => (expandedMapCopyright = !expandedMapCopyright))}
        >
            <div class="grow text-left">{$LL.menu.about.copyrights.map.title()}</div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class={expandedMapCopyright ? "rotate-180" : ""}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="#ffffff"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M6 9l6 6l6 -6" />
            </svg>
        </div>
        <p id="{uid}-map" class="whitespace-pre-line" hidden={!expandedMapCopyright}>{mapCopyright}</p>
        <div
            class="text-lg font-bold flex items-center py-4 px-8 cursor-pointer border-y-0 border-x-0 border-b border-solid border-white/20 {expandedTilesetCopyright
                ? 'bg-secondary'
                : 'bg-contrast/50 hover:bg-contrast'}"
            role="button"
            tabindex="0"
            aria-expanded={expandedTilesetCopyright}
            aria-controls="{uid}-tileset"
            onclick={() => (expandedTilesetCopyright = !expandedTilesetCopyright)}
            onkeydown={(event) =>
                activateOnEnterOrSpace(event, () => (expandedTilesetCopyright = !expandedTilesetCopyright))}
        >
            <div class="grow text-left">{$LL.menu.about.copyrights.tileset.title()}</div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class={expandedTilesetCopyright ? "rotate-180" : ""}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="#ffffff"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M6 9l6 6l6 -6" />
            </svg>
        </div>
        <section id="{uid}-tileset" hidden={!expandedTilesetCopyright}>
            {#each tilesetCopyright as copyright (copyright)}
                <p class="whitespace-pre-line">{copyright}</p>
            {:else}
                <p>{$LL.menu.about.copyrights.tileset.empty()}</p>
            {/each}
        </section>
        <div
            class="text-lg font-bold flex items-center py-4 px-8 cursor-pointer border-y-0 border-x-0 border-b border-solid border-white/20 {expandedAudioCopyright
                ? 'bg-secondary'
                : 'bg-contrast/50 hover:bg-contrast'}"
            role="button"
            tabindex="0"
            aria-expanded={expandedAudioCopyright}
            aria-controls="{uid}-audio"
            onclick={() => (expandedAudioCopyright = !expandedAudioCopyright)}
            onkeydown={(event) =>
                activateOnEnterOrSpace(event, () => (expandedAudioCopyright = !expandedAudioCopyright))}
        >
            <div class="grow text-left">{$LL.menu.about.copyrights.audio.title()}</div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class={expandedAudioCopyright ? "rotate-180" : ""}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="#ffffff"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M6 9l6 6l6 -6" />
            </svg>
        </div>
        <section id="{uid}-audio" hidden={!expandedAudioCopyright}>
            {#each audioCopyright as copyright (copyright)}
                <p class="whitespace-pre-line">{copyright}</p>
            {:else}
                <p>{$LL.menu.about.copyrights.audio.empty()}</p>
            {/each}
        </section>
    </section>
</div>
