<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import { IconCheck } from "@wa-icons";

    /**
     * One row of a menu over the map, in the shared standard (`.k-menu-row`): a 44 px row, an 18 px lead, the label,
     * and a check when the row is marked. The caller decides the role and the state (`role`, `aria-checked`,
     * `aria-disabled`, `tabindex`) and passes them through.
     */
    interface Props extends Omit<HTMLButtonAttributes, "children" | "class" | "type"> {
        /** The glyph or picture of the lead slot. The slot is 18x18 and hidden from assistive technology. */
        lead: Snippet;
        label: string;
        /** Draws the check at the end of the row. */
        marked?: boolean;
    }

    let { lead, label, marked = false, ...rest }: Props = $props();
</script>

<button type="button" class="k-menu-row" {...rest}>
    <span class="k-menu-lead" aria-hidden="true">{@render lead()}</span>
    <span class="k-menu-label">{label}</span>
    {#if marked}
        <IconCheck class="k-menu-mark" width="18" height="18" aria-hidden="true" />
    {/if}
</button>
