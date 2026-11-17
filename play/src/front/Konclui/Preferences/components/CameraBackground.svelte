<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import {
        availableBackgroundImagesStore,
        backgroundConfigStore,
        backgroundProcessingSupportedStore,
    } from "../../../Stores/BackgroundTransformStore";
    import { backgroundChoice } from "../domain/mediaChoices";
    import { indexAfter } from "../domain/panes";
    import { setCameraBackground } from "../stores/mediaSettings";
    import PrefChoice from "./PrefChoice.svelte";

    const id = $props.id();
    let t = $derived($LL.konclui.preferences.media);
    let chosen = $derived(backgroundChoice($backgroundConfigStore));
    let images = $derived($availableBackgroundImagesStore.map((image) => ({ ...image, value: `image:${image.url}` })));
    let imageButtons: HTMLButtonElement[] = $state([]);
    let checkedImage = $derived(images.findIndex((image) => image.value === chosen));

    function imageKeydown(event: KeyboardEvent, index: number): void {
        const next = indexAfter(index, event.key, images.length);
        if (next === undefined) return;
        event.preventDefault();
        imageButtons[next]?.focus();
        setCameraBackground(images[next].value);
    }
</script>

{#if $backgroundProcessingSupportedStore}
    <PrefChoice
        title={t.background()}
        hint={t.backgroundHint()}
        options={[
            { value: "none", label: t.backgroundNone() },
            { value: "blur:10", label: t.blurLight() },
            { value: "blur:25", label: t.blurMedium() },
            { value: "blur:50", label: t.blurStrong() },
        ]}
        value={chosen}
        onchange={setCameraBackground}
    />
    {#if images.length > 0}
        <div class="k-pref-item k-pref-stack">
            <span class="k-pref-text"><b id="{id}-images">{t.backgroundImages()}</b></span>
            <div class="k-pref-images" role="radiogroup" aria-labelledby="{id}-images">
                {#each images as image, index (image.value)}
                    <button
                        bind:this={imageButtons[index]}
                        type="button"
                        role="radio"
                        aria-checked={index === checkedImage}
                        aria-label={t.backgroundImage({ index: index + 1 })}
                        tabindex={index === (checkedImage === -1 ? 0 : checkedImage) ? 0 : -1}
                        onclick={() => setCameraBackground(image.value)}
                        onkeydown={(event) => imageKeydown(event, index)}
                        ><img src={image.thumbnailUrl} alt="" loading="lazy" /></button
                    >
                {/each}
            </div>
        </div>
    {/if}
{:else}
    <div class="k-pref-item">
        <span class="k-pref-text"><b>{t.background()}</b><small>{t.backgroundUnsupported()}</small></span>
    </div>
{/if}
