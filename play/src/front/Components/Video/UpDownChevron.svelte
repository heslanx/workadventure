<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconChevronDown } from "@wa-icons";

    interface Props {
        enabled?: boolean;
        onclick?: () => void;
    }

    let { enabled = false, onclick }: Props = $props();
</script>

<button
    aria-label={$LL.camera.menu.moreAction()}
    aria-expanded={enabled}
    class="user-menu-btn hit-area p-0 h-5 w-5 flex items-center justify-center mr-1 rounded-sm hover:bg-white/20 right-0 top-0 bottom-0 m-auto transition-all pointer-events-auto {enabled
        ? 'bg-white/20 hover:bg-white/30'
        : ''}"
    onclick={() => {
        onclick?.();
    }}
>
    <IconChevronDown
        font-size="20"
        class="aspect-ratio transition-all {enabled ? 'rotate-180' : ''}"
        aria-hidden="true"
    />
</button>
