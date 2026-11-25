<script lang="ts">
    import { popupSurface } from "../../Utils/floatingUiSurface";
    import { floatingUiComponents } from "../../Utils/svelte-floatingui-show";

    interface Props {
        /** Only the popups anchored in this document (the desktop companion window has its own list). */
        targetDocument?: Document;
        [key: string]: unknown;
    }

    let { targetDocument = document, ...rest }: Props = $props();
</script>

{#each [...$floatingUiComponents.entries()].filter(([, value]) => value.ownerDocument === targetDocument) as [key, value] (`${key}`)}
    {@const valueProps = value.props ?? {}}
    {@const Component = value.componentType}
    {@const action = value.action}
    {@const arrowAction = value.arrowAction}
    <!-- A menu or a picker the user opened arrives and leaves on the surface transition; a tooltip (`motion` off) is
         gone as it closes. The directive stays directly under the {#each}: only there does Svelte hold the wrapper for
         the exit. -->
    <div class="absolute z-[3000]" style:z-index={value.zIndex} use:action transition:popupSurface={value}>
        {#if arrowAction}
            <div use:arrowAction></div>
        {/if}
        <Component {...rest} {...valueProps} />
    </div>
{/each}
