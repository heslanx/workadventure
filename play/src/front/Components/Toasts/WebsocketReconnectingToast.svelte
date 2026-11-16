<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import ToastContainer from "./ToastContainer.svelte";
    import { IconLoader, IconNetworkOff } from "@wa-icons";

    interface Props {
        toastUuid?: string;
        /** Skips the wait before the next automatic attempt. */
        onRetry?: () => void;
    }

    let { toastUuid = "", onRetry }: Props = $props();
</script>

<ToastContainer theme="secondary" extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" {toastUuid}>
    <div class="flex items-center gap-3 text-left" data-testid="websocket-reconnecting-toast">
        <div class="relative flex h-8 w-8 shrink-0 items-center justify-center">
            <IconNetworkOff class="text-white/80" font-size="1.35rem" aria-hidden="true" />
            <IconLoader
                class="absolute -right-1 -bottom-1 animate-spin text-secondary-300"
                font-size="1rem"
                aria-hidden="true"
            />
        </div>
        <div class="flex min-w-0 flex-col">
            <p class="m-0 text-sm font-semibold leading-snug text-white">{$LL.warning.connectionLostTitle()}</p>
            <!-- Why it looks frozen, what happens next, and that nothing typed is lost. -->
            <p class="m-0 text-xs leading-snug text-white/80">{$LL.warning.connectionLostDetail()}</p>
        </div>
    </div>
    {#snippet buttons()}
        {#if onRetry}
            <button
                type="button"
                class="btn btn-light btn-sm flex-1 cursor-pointer"
                data-testid="websocket-reconnect-now"
                onclick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onRetry?.();
                }}
            >
                {$LL.warning.reconnectNow()}
            </button>
        {/if}
    {/snippet}
</ToastContainer>
