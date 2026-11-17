<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        title: string;
        children: Snippet;
    }

    let { title, children }: Props = $props();
    const id = $props.id();
</script>

<section class="k-pref-block" aria-labelledby="{id}-section">
    <h3 class="k-pref-section" id="{id}-section">{title}</h3>
    <div class="k-pref-group">
        {@render children()}
    </div>
</section>
