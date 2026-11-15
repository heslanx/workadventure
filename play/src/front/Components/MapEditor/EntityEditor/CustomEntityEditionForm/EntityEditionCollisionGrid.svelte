<script lang="ts">
    import { activateOnEnterOrSpace } from "../../../../Utils/activateOnEnterOrSpace";
    interface Props {
        collisionGrid: number[][];
        collisionGridHeight: number;
        updateCollisionGrid: (rowIndex: number, columnIndex: number) => void;
    }

    let { collisionGrid = [], collisionGridHeight, updateCollisionGrid }: Props = $props();
</script>

<div class="absolute w-32 grid gap" style={`height: ${collisionGridHeight}px`}>
    {#each collisionGrid as row, rowIndex (rowIndex)}
        {#each row as _, columnIndex (columnIndex)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                style={`grid-area: ${rowIndex + 1} / ${columnIndex + 1}`}
                class={[
                    "cursor-pointer border-solid border border-gray-400 rounded-sm",
                    {
                        "bg-red-600/30": collisionGrid[rowIndex][columnIndex] === 1,
                    },
                ]}
                onclick={() => updateCollisionGrid(rowIndex, columnIndex)}
                role="button"
                tabindex="0"
                onkeydown={(event) => activateOnEnterOrSpace(event, () => updateCollisionGrid(rowIndex, columnIndex))}
                aria-pressed={collisionGrid[rowIndex][columnIndex] === 1}
                aria-label={`${rowIndex + 1}, ${columnIndex + 1}`}
            ></div>
        {/each}
    {/each}
</div>
