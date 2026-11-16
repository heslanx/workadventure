<script lang="ts">
    import type { EntityPrefab } from "@workadventure/map-editor";
    import { LL } from "../../../../../i18n/i18n-svelte";

    interface Props {
        entityPrefabsPositions: EntityPrefab[];
        selectedEntity: EntityPrefab;
        onPickItem: (entity: EntityPrefab) => void;
    }

    let { entityPrefabsPositions, selectedEntity, onPickItem }: Props = $props();

    const labelId = $props.id();
</script>

{#if entityPrefabsPositions.length > 1}
    <p class="m-0 text-xxs" id={labelId}>{$LL.mapEditor.entityEditor.itemPicker.positions()}</p>
    <div class="flex flex-row gap-2" role="group" aria-labelledby={labelId}>
        {#each entityPrefabsPositions as item (item.id)}
            <button
                type="button"
                class="m-0 p-0 bg-transparent border-0 cursor-pointer hit-area"
                aria-pressed={item.imagePath === selectedEntity?.imagePath}
                onclick={() => onPickItem(item)}
            >
                <img
                    draggable="false"
                    class={`item-image max-w-[32px] ${
                        item.imagePath === selectedEntity?.imagePath ? "border-solid border-yellow-400 rounded-sm" : ""
                    }`}
                    src={item.imagePath}
                    alt={item.name}
                />
            </button>
        {/each}
    </div>
{/if}
