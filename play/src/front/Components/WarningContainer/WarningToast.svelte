<script lang="ts">
    import { fly } from "../../Utils/reducedMotion";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import LL from "../../../i18n/i18n-svelte";
    import { IconX } from "@wa-icons";
</script>

<div class="warning-toast" transition:fly={{ y: -200, duration: 500 }} data-testid="warning-toast">
    {#each $warningMessageStore as warningMessage, key (warningMessage.id ?? key)}
        <div class="flex items-start justify-center gap-2">
            <div
                class="text-center flex justify-center text-danger whitespace-pre-line break-words max-h-24 overflow-y-auto"
                role="alert"
            >
                ⚠️ {warningMessage.message} ⚠️
            </div>
            {#if warningMessage.closable && warningMessage.id}
                {@const id = warningMessage.id}
                <button
                    type="button"
                    class="shrink-0 flex items-center justify-center w-8 h-8 p-0 m-0 rounded cursor-pointer text-danger bg-transparent border-0 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                    aria-label={$LL.notification.closeToast()}
                    title={$LL.notification.closeToast()}
                    onclick={() => warningMessageStore.removeWarningMessage(id)}
                >
                    <IconX font-size="1.125rem" aria-hidden="true" />
                </button>
            {/if}
        </div>
    {/each}
</div>
