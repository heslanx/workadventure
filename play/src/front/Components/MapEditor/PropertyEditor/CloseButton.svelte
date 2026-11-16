<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";

    interface Props {
        onclick?: (event: MouseEvent) => void;
    }

    let { onclick }: Props = $props();
</script>

<button
    class="close-button min-h-7 min-w-7"
    type="button"
    aria-label={$LL.actionbar.close()}
    onclick={(event) => {
        onclick?.(event);
    }}
>
    <span aria-hidden="true">x</span>
</button>

<style>
    .close-button {
        position: absolute;
        padding: 3px;
        border-radius: 8px;
        top: 0;
        inset-inline-end: 0;
        cursor: pointer;
    }
</style>
