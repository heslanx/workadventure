<script lang="ts">
    interface Props {
        label: string;
        // The rule above the title, between this group and the one before it. The first group has none.
        separated?: boolean;
    }

    let { label, separated = true }: Props = $props();
</script>

<!-- The menus list their rows 2px apart (gap-0.5): -mt-0.5 takes that gap back above the rule, so the rule sits 6px
     from the row before it, as in the office menu. -->
<div class={["flex flex-col", separated && "-mt-0.5"]}>
    {#if separated}
        <hr class="k-divider" />
    {/if}
    <span class="k-menu-title">{label}</span>
</div>
