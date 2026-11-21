<script lang="ts">
    // A stand-in for the tools an extension puts in the zoom column, for ExplorerMenu.test.ts: two controls of the column.
    const names = ["a", "b"];
</script>

{#each names as name (name)}
    <button type="button" class="k-control" data-testid={`fixture-tool-${name}`}>{name}</button>
{/each}
