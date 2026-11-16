<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import { onboardingProgressStore } from "../../Stores/OnboardingStore";

    interface Props {
        onback?: () => void;
        onskip?: () => void;
        /** The last step has its own button to finish, so it has no Skip. */
        showSkip?: boolean;
    }

    const { onback, onskip, showSkip = true }: Props = $props();

    const shortcutHintId = $props.id();
</script>

<div class="mt-4 border-t border-white/10 pt-3" data-testid="onboarding-nav">
    <div class="flex items-center justify-between gap-3">
        <button
            type="button"
            class="min-h-8 px-3 py-1 text-sm bg-transparent hover:bg-white/10 text-white rounded font-semibold transition-all"
            data-testid="onboarding-button-back"
            onclick={() => onback?.()}
        >
            {$LL.onboarding.back()}
        </button>
        {#if $onboardingProgressStore}
            <p class="m-0 text-xs text-white/70" data-testid="onboarding-step-indicator">
                {$LL.onboarding.stepIndicator({
                    current: $onboardingProgressStore.current,
                    total: $onboardingProgressStore.total,
                })}
            </p>
        {/if}
        {#if showSkip}
            <button
                type="button"
                class="min-h-8 px-3 py-1 text-sm bg-transparent hover:bg-white/10 text-white rounded font-semibold transition-all underline-offset-4 hover:underline"
                data-testid="onboarding-button-skip"
                aria-keyshortcuts="Escape"
                aria-describedby={shortcutHintId}
                onclick={() => onskip?.()}
            >
                {$LL.onboarding.welcome.skip()}
            </button>
        {/if}
    </div>
    {#if showSkip}
        <!-- Escape skips the tutorial only while the focus is inside it, so the hint shows only then. -->
        <p
            id={shortcutHintId}
            class="m-0 mt-2 hidden text-xs text-white/70 group-focus-within/onboarding:block"
            data-testid="onboarding-skip-shortcut-hint"
        >
            {$LL.onboarding.skipShortcutHint()}
        </p>
    {/if}
</div>
