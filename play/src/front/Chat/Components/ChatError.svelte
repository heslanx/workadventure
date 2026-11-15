<script lang="ts">
    import { onDestroy } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import Alert from "../../Components/UI/Alert.svelte";
    import Button from "../../Components/UI/Button.svelte";
    import { chatConnectionFailureStore } from "../Stores/ChatConnectionFailureStore";
    import { IconExclamation, IconLoader } from "@wa-icons";

    interface Props {
        // A custom label is a one-off error: it gets neither the explanation nor the retry button.
        label?: string;
        // Starts a new attempt; false when there is nothing to retry, which leaves only a reload.
        retry?: () => boolean;
        // Whether the retry is still running, when the caller can observe it; otherwise a timer decides.
        retryPending?: boolean;
    }

    let { label, retry = () => gameManager.chatConnection.retryConnection(), retryPending }: Props = $props();

    // A retry that has not brought the chat back after this long is reported as failed again.
    const RETRY_FEEDBACK_MS = 15_000;

    // Turns false when there was no connection attempt to retry (the chat never started): only a reload helps then.
    let canRetry = $state(true);
    let retrying = $state(false);
    let retryFailed = $state(false);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let showRetrying = $derived(retryPending ?? retrying);

    // A retry the caller saw end while this block is still shown has failed.
    let wasRetryPending = false;
    $effect(() => {
        if (retryPending === undefined) {
            return;
        }
        if (wasRetryPending && !retryPending) {
            retryFailed = true;
        }
        wasRetryPending = retryPending;
    });

    let failedSince = $derived(
        $chatConnectionFailureStore?.recoveredAt === undefined
            ? $chatConnectionFailureStore?.failedAt.toLocaleTimeString($locale, { hour: "2-digit", minute: "2-digit" })
            : undefined,
    );

    function onRetry() {
        canRetry = retry();
        if (!canRetry) {
            return;
        }
        retryFailed = false;
        if (retryPending !== undefined) {
            return;
        }
        retrying = true;
        clearTimeout(retryTimer);
        // Still mounted means the chat is still failing: the panel swaps this block out as soon as it reconnects.
        retryTimer = setTimeout(() => {
            retrying = false;
            retryFailed = true;
        }, RETRY_FEEDBACK_MS);
    }

    onDestroy(() => {
        clearTimeout(retryTimer);
    });
</script>

<div class="px-2 pb-2" role="alert" data-testid="chatConnectionError">
    <Alert variant="danger" class="w-full">
        <div class="flex gap-2">
            <IconExclamation font-size="20" class="shrink-0" />
            <div class="flex flex-col gap-1 items-start min-w-0">
                <div class="font-bold text-white">{label ?? $LL.chat.connectionError()}</div>
                {#if label === undefined}
                    <p class="m-0 text-white/75">
                        {$LL.chat.connectionErrorImpact()}
                        {$LL.chat.connectionErrorDescription()}
                    </p>
                    {#if failedSince}
                        <p class="m-0 text-white/75" data-testid="chatConnectionFailedSince">
                            {$LL.chat.connectionErrorSince({ time: failedSince })}
                        </p>
                    {/if}
                    {#if showRetrying}
                        <p class="m-0 mt-1 flex items-center gap-2 text-white" role="status">
                            <IconLoader class="animate-spin motion-reduce:animate-none shrink-0" font-size="14" />
                            {$LL.chat.connectionRetrying()}
                        </p>
                    {:else if canRetry}
                        {#if retryFailed}
                            <p class="m-0 text-white" role="status" data-testid="chatConnectionRetryFailed">
                                {$LL.chat.connectionRetryFailed()}
                            </p>
                        {/if}
                        <Button variant="danger" size="sm" class="mt-1" onclick={onRetry}>
                            {$LL.chat.connectionErrorRetry()}
                        </Button>
                    {:else}
                        <Button variant="danger" size="sm" class="mt-1" onclick={() => window.location.reload()}>
                            {$LL.chat.connectionErrorReload()}
                        </Button>
                    {/if}
                {/if}
            </div>
        </div>
    </Alert>
</div>
