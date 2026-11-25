<script lang="ts">
    import { surface } from "./surfaceTransition";

    // A stand-in for a surface that opens over the map, for surfaceTransition.test.ts: the transition sits on the
    // element directly under the `{#if}`, the content has a block of its own that closing would switch, and a block
    // around it stands for the shell that the room's entry creates.
    let shell = $state(true);
    let open = $state(false);
    let inner = $state(true);

    export function setShell(value: boolean): void {
        shell = value;
    }

    export function setOpen(value: boolean): void {
        open = value;
    }

    export function setInner(value: boolean): void {
        inner = value;
    }
</script>

{#if shell}
    {#if open}
        <aside data-testid="surface" transition:surface>
            {#if inner}
                <p data-testid="first">first</p>
            {:else}
                <p data-testid="second">second</p>
            {/if}
        </aside>
    {/if}
{/if}
