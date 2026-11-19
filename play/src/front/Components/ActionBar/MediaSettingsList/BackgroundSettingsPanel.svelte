<script lang="ts">
    import { localStreamStore } from "../../../Stores/MediaStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import {
        backgroundConfigStore,
        availableBackgroundImagesStore,
        backgroundProcessingSupportedStore,
    } from "../../../Stores/BackgroundTransformStore";
    import type { BackgroundMode } from "../../../WebRtc/BackgroundProcessor/createBackgroundTransformer";
    import { srcObject } from "../../Video/utils";
    import SectionDivider from "./SectionDivider.svelte";
    import SectionTitle from "./SectionTitle.svelte";
    import BackgroundPresetButton from "./BackgroundPresetButton.svelte";
    import SelectionCheckOverlay from "./SelectionCheckOverlay.svelte";
    import { IconCamera, IconCheck, IconCancel } from "@wa-icons";

    const blurOptions = [
        { labelKey: "blurSmall" as const, amount: 10, blurTailwind: "blur-[2px]" },
        { labelKey: "blurMiddle" as const, amount: 25, blurTailwind: "blur-[6px]" },
        { labelKey: "blurHigh" as const, amount: 50, blurTailwind: "blur-[12px]" },
    ];

    function setBackgroundMode(newMode: BackgroundMode) {
        backgroundConfigStore.setMode(newMode);
    }

    function setBackgroundBlur(amount: number) {
        backgroundConfigStore.setMode("blur");
        backgroundConfigStore.setBlurAmount(amount);
    }

    function setBackgroundImage(imageUrl: string) {
        backgroundConfigStore.setBackgroundImage(imageUrl);
    }

    let isNoEffectSelected = $derived($backgroundConfigStore.mode === "none");
</script>

<!-- Camera Preview -->
<div class="relative w-full aspect-video rounded-lg overflow-hidden bg-contrast/50 px-0 shrink-0">
    {#if $localStreamStore.type === "success" && $localStreamStore.stream}
        <video
            class="w-full h-full object-cover scale-x-[-1] overflow-hidden"
            use:srcObject={$localStreamStore.stream}
            autoplay
            muted
            playsinline
        ></video>
    {:else}
        <div class="w-full h-full flex items-center justify-center text-white/50">
            <IconCamera width="18" height="18" aria-hidden="true" />
        </div>
    {/if}
</div>

<SectionDivider />
{#if !$backgroundProcessingSupportedStore}
    <p class="m-0 px-3 py-1.5 text-xs text-white/70" data-testid="background-effects-unsupported">
        {$LL.warning.backgroundProcessing.notSupportedOnThisBrowser()}
    </p>
{:else}
    <!-- The bottom padding keeps the last row of tiles off the rim once the list is scrolled to its end. -->
    <div class="k-scroll-y flex min-h-0 flex-1 flex-col gap-1.5 pb-1.5">
        <!-- No Effect Button: one cell of the tile grid below, so its hit area is the tile and its edges line up. -->
        <div class="grid grid-cols-3 gap-1.5">
            <button
                type="button"
                class="relative z-10 flex flex-col gap-1 group text-left"
                aria-current={isNoEffectSelected ? "true" : undefined}
                onclick={() => setBackgroundMode("none")}
            >
                <div
                    class="relative w-full aspect-square rounded-lg bg-white/10 flex flex-col items-center justify-center transition-all gap-1 hover:brightness-50 border-2 {isNoEffectSelected
                        ? 'border-white border-solid'
                        : 'border-transparent hover:border-white/30'}"
                >
                    {#if isNoEffectSelected}
                        <IconCheck width="18" height="18" aria-hidden="true" />
                    {:else}
                        <IconCancel width="18" height="18" aria-hidden="true" />
                    {/if}
                    <span class="text-xs group-hover:text-white transition-colors"
                        >{$LL.actionbar.background.noEffect()}</span
                    >
                </div>
            </button>
        </div>

        <!-- Blur Section -->
        <div role="group" aria-label={$LL.actionbar.background.blur()} class="relative z-10 flex flex-col gap-1.5">
            <SectionTitle title={$LL.actionbar.background.blur()} />
            <div class="grid grid-cols-3 gap-1.5">
                {#each blurOptions as option (option.amount)}
                    {@const isSelected =
                        $backgroundConfigStore.mode === "blur" && $backgroundConfigStore.blurAmount === option.amount}
                    <button
                        class="flex flex-col items-center group px-0"
                        data-testid="background-blur-{option.amount}"
                        aria-current={isSelected ? "true" : undefined}
                        onclick={() => setBackgroundBlur(option.amount)}
                    >
                        <div class="relative w-full aspect-square transition-all hover:brightness-50">
                            <div
                                class="absolute inset-0 rounded-sm overflow-hidden border-2 {isSelected
                                    ? 'border-white border-solid'
                                    : 'border-transparent hover:border-white/30'}"
                            >
                                <img
                                    src="/static/images/background/thumbnail/settingBackgroundEffect.jpeg"
                                    alt=""
                                    class="w-full h-full object-cover {option.blurTailwind}"
                                />
                            </div>
                            {#if isSelected}
                                <SelectionCheckOverlay />
                            {/if}
                        </div>
                        <span
                            class="text-xs group-hover:text-white transition-colors {isSelected
                                ? 'text-white'
                                : 'text-white/70'}">{$LL.actionbar.background[option.labelKey]()}</span
                        >
                    </button>
                {/each}
            </div>
        </div>

        <!-- Images Section -->
        {#if $availableBackgroundImagesStore.length > 0}
            <div
                role="group"
                aria-label={$LL.actionbar.background.images()}
                class="relative z-10 flex flex-col gap-1.5"
            >
                <SectionTitle title={$LL.actionbar.background.images()} />
                <div class="grid grid-cols-3 gap-1.5">
                    {#each $availableBackgroundImagesStore as image, index (index)}
                        <BackgroundPresetButton
                            thumbnail={image.thumbnailUrl}
                            label={$LL.actionbar.background.image({ index: index + 1 })}
                            isSelected={$backgroundConfigStore.mode === "image" &&
                                $backgroundConfigStore.backgroundImage === image.url}
                            onclick={() => setBackgroundImage(image.url)}
                        />
                    {/each}
                </div>
            </div>
        {/if}
    </div>
{/if}
