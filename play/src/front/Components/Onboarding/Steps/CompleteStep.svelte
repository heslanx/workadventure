<script lang="ts">
    import { fly } from "../../../Utils/reducedMotion";
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { isMobileOnboarding } from "../../../Stores/OnboardingStore";

    interface Props {
        onnext?: () => void;
    }

    const { onnext }: Props = $props();

    const worldName = gameManager.getCurrentGameScene()?.room?.roomName ?? "WorkAdventure";

    function handleNext() {
        onnext?.();
    }
</script>

<!-- Mobile onboarding: panel at bottom. Desktop: panel on the right. -->
<div
    class="z-[3001] pointer-events-auto {$isMobileOnboarding
        ? 'fixed left-4 right-4 bottom-[4.5rem]'
        : 'fixed top-1/2 -right-10 transform -translate-x-14 -translate-y-1/2'}"
>
    <div
        class="bg-contrast/95 backdrop-blur-lg rounded-lg p-4 sm:p-6 w-full max-w-lg shadow-lg border border-white/20 {$isMobileOnboarding
            ? 'mx-auto max-h-[50vh] overflow-y-auto'
            : ''}"
        in:fly={{ y: $isMobileOnboarding ? 10 : 10, duration: 400 }}
    >
        <div class="text-center space-y-4 sm:space-y-6">
            <h2 class="text-2xl sm:text-3xl font-bold text-white mb-3 sm:mb-4">
                {$LL.onboarding.complete.title()}
            </h2>
            <p class="text-base sm:text-lg text-white/90 leading-relaxed">
                {$LL.onboarding.complete.description({ worldName })}
            </p>
            <div class="flex justify-center gap-4 pt-4">
                <button
                    class="px-5 py-3 sm:px-6 min-h-11 bg-secondary hover:bg-secondary-800 text-white rounded font-semibold transition-all"
                    onclick={handleNext}
                >
                    {$LL.onboarding.complete.finish()}
                </button>
            </div>
        </div>
    </div>
</div>
