<script lang="ts">
    import type { Snippet } from "svelte";

    /**
     * A titled group of menu rows: the title in sentence case (`.k-menu-title`), the rows 2 px apart. The rule between
     * two groups is the caller's: it renders a `.k-divider` between them, because only it knows its order.
     */
    interface Props {
        title: string;
        children: Snippet;
    }

    let { title, children }: Props = $props();
</script>

<div class="flex flex-col gap-0.5" role="group" aria-label={title}>
    <span class="k-menu-title" aria-hidden="true">{title}</span>
    {@render children()}
</div>
