<script lang="ts">
    import { LL } from "../../../../../i18n/i18n-svelte";

    interface Props {
        colors: string[];
        selectedColor: string;
        onColorChange: (color: string) => void;
    }

    let { colors, selectedColor, onColorChange }: Props = $props();

    const labelId = $props.id();
</script>

{#if colors.length > 1}
    <p class="m-0 text-xxs" id={labelId}>{$LL.mapEditor.entityEditor.itemPicker.colors()}</p>
    <div class="flex flex-row gap-2" role="group" aria-labelledby={labelId}>
        {#each colors as color (color)}
            <div class="hover:cursor-pointer">
                <button
                    aria-label={color}
                    aria-pressed={selectedColor === color}
                    class={`w-4 h-4 rounded-full p-0 hit-area ${
                        selectedColor === color ? "border-solid border-yellow-400 rounded-full" : ""
                    }`}
                    style="background-color: {color};"
                    onclick={() => onColorChange(color)}
                ></button>
            </div>
        {/each}
    </div>
{/if}
