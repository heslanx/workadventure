<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        title?: string;
        children?: Snippet;
        actions?: Snippet;
    }

    let { title = "", children, actions }: Props = $props();
</script>

<!-- The group around the title carries it as its name, so the visible title is hidden from assistive technology. -->
<div class="flex items-center gap-3">
    <span class="k-menu-title min-w-0 flex-1" aria-hidden="true">
        {title}
        {@render children?.()}
    </span>
    {@render actions?.()}
</div>
