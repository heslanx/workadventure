<script lang="ts">
    import type { EntityPrefab } from "@workadventure/map-editor";

    interface Props {
        entityPrefabsPositions: EntityPrefab[];
        selectedEntity: EntityPrefab;
        onPickItem: (entity: EntityPrefab) => void;
    }

    let { entityPrefabsPositions, selectedEntity, onPickItem }: Props = $props();
</script>

{#if entityPrefabsPositions.length > 1}
    <p class="m-0 text-xxs">Positions</p>
    <div class="flex flex-row gap-2">
        {#each entityPrefabsPositions as item (item.id)}
            <button
                type="button"
                class="m-0 p-0 bg-transparent border-0 cursor-pointer"
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
