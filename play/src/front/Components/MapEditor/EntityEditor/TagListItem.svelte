<script lang="ts">
    import type { EntityVariant } from "../../../Phaser/Game/MapEditor/Entities/EntityVariant";
    import type { CategoryTag } from "../../../Stores/MapEditorStore";
    import LL from "../../../../i18n/i18n-svelte";
    import { activateOnEnterOrSpace } from "../../../Utils/activateOnEnterOrSpace";
    import EntityImage from "./EntityItem/EntityImage.svelte";
    import { IconChevronRight, IconChevronLeft } from "@wa-icons";

    interface Props {
        tag: CategoryTag;
        label?: string;
        entitiesPrefabsVariants: EntityVariant[];
        selectedTag?: (tag: CategoryTag) => void;
    }

    let { tag, label, entitiesPrefabsVariants, selectedTag = () => {} }: Props = $props();

    const isRtl = document.dir === "rtl";

    function format(text: string): string {
        return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    }
</script>

{#if entitiesPrefabsVariants.length !== 0}
    <!-- The row keeps its list semantics on the li; the role="button" child is the control. -->
    <li class="min-w-full group transition-all bg-white/10 rounded mt-2 hover:bg-white hover:text-dark">
        <div
            role="button"
            tabindex="0"
            class="cursor-pointer rounded"
            onclick={() => selectedTag(tag)}
            onkeydown={(event) => activateOnEnterOrSpace(event, () => selectedTag(tag))}
        >
            <div class="entities-tag-list-item-grid p-2">
                <div class="asset">
                    <EntityImage
                        classNames="w-[32px] h-[32px] object-contain"
                        imageSource={entitiesPrefabsVariants[0].defaultPrefab.imagePath}
                        imageAlt={entitiesPrefabsVariants[0].defaultPrefab.name}
                    />
                </div>
                <div class="tag">
                    <p class="m-0">{label ? format(label) : format(tag.tag)}</p>
                </div>
                <div class="entitiesCount">
                    {entitiesPrefabsVariants.length}
                </div>
                <div class="object">{$LL.mapEditor.entityEditor.images(entitiesPrefabsVariants.length)}</div>
                <div
                    class="chevronRight group-hover:-translate-x-2 motion-reduce:group-hover:translate-x-0 transition-transform"
                >
                    {#if isRtl}
                        <IconChevronLeft aria-hidden="true" />
                    {:else}
                        <IconChevronRight aria-hidden="true" />
                    {/if}
                </div>
            </div>
        </div>
    </li>
{/if}

<style>
    .entities-tag-list-item-grid {
        display: grid;
        column-gap: 6px;
        grid-template-areas: "asset tag tag . chevronRight" "asset entitiesCount object . chevronRight ";
        grid-template-columns: 32px auto 1fr 1fr 1fr;
    }

    .asset {
        grid-area: asset;
        align-self: center;
        justify-self: center;
    }

    .tag {
        grid-area: tag;
    }

    .chevronRight {
        grid-area: chevronRight;
        align-self: center;
        justify-self: end;
    }

    .entitiesCount {
        grid-area: entitiesCount;
        font-size: 0.75rem;
        border: 1px solid white;
        align-self: center;
        justify-self: center;
        padding: 0 4px;
        border-radius: 4px;
    }

    .entities-tag-list-item-grid:hover .entitiesCount {
        border: 1px solid black;
    }

    .object {
        grid-area: object;
        opacity: 70%;
        font-size: 0.75rem;
        align-self: center;
    }
</style>
