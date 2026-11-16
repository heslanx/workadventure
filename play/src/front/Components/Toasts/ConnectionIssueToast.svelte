<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import ToastContainer from "./ToastContainer.svelte";
    import { IconNetworkOff } from "@wa-icons";

    interface Props {
        toastUuid?: string;
    }

    let { toastUuid = "" }: Props = $props();
</script>

<ToastContainer theme="error" extraClasses="" {toastUuid}>
    <div class="px-1 flex items-center gap-2 text-left">
        <IconNetworkOff color="rgb(234, 110, 83)" class="shrink-0" aria-hidden="true" />
        <div class="flex min-w-0 flex-col">
            <span>{$LL.error.connectionRetry.unableConnect()}</span>
            <!-- The next step: nothing to do, the requests are retried and this goes away once they pass. -->
            <span class="text-xs text-white/80">{$LL.error.connectionRetry.retrying()}</span>
        </div>
    </div>
</ToastContainer>
