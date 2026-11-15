<script lang="ts">
    import type { EntityVariant } from "../../../../Phaser/Game/MapEditor/Entities/EntityVariant";
    import { activateOnEnterOrSpace } from "../../../../Utils/activateOnEnterOrSpace";
    import EntityImage from "./EntityImage.svelte";

    interface Props {
        entityVariant: EntityVariant;
        isActive: boolean;
        onselectentity?: (entityVariant: EntityVariant) => void;
    }

    let { entityVariant, isActive, onselectentity }: Props = $props();
</script>

<div
    data-testid="entity-item"
    role="button"
    tabindex="0"
    aria-pressed={isActive}
    onkeydown={(event) => activateOnEnterOrSpace(event, () => onselectentity?.(entityVariant))}
    class={`flex items-center justify-center box-border py-0.5 cursor-pointer border-solid border-transparent h-full w-full bg-white/10 rounded-lg hover:bg-white/20 hover:border-white hover:animate-pulse ${
        isActive ? "border-solid border-yellow-400 rounded-lg" : ""
    }`}
    onclick={() => onselectentity?.(entityVariant)}
>
    <EntityImage
        classNames="cursor-pointer w-14 h-14 object-contain rounded-md"
        imageSource={entityVariant.defaultPrefab.imagePath}
        imageAlt={entityVariant.defaultPrefab.name}
    />
</div>
