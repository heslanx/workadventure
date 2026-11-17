<script lang="ts">
    import { fly } from "../../../Utils/reducedMotion";
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { isMobileOnboarding } from "../../../Stores/OnboardingStore";

    interface Props {
        onnext?: () => void;
        onskip?: () => void;
    }

    const { onnext, onskip }: Props = $props();

    let worldName: string = gameManager.getCurrentGameScene()?.room?.roomName ?? "WorkAdventure";

    function handleNext() {
        onnext?.();
    }

    function handleSkip() {
        onskip?.();
    }
</script>

<div
    class="z-[3001] pointer-events-auto {$isMobileOnboarding
        ? 'fixed left-4 right-4 bottom-4'
        : 'fixed top-1/2 -right-10 transform -translate-x-14 -translate-y-1/2'}"
>
    <div
        class="bg-contrast/95 backdrop-blur-lg rounded-lg p-4 sm:p-6 w-full max-w-lg shadow-lg border border-white/20 {$isMobileOnboarding
            ? 'mx-auto max-h-[70vh] overflow-y-auto'
            : ''}"
        in:fly={{ y: $isMobileOnboarding ? -10 : 10, duration: 400 }}
    >
        <div class="text-center space-y-6">
            <h2 class="text-3xl font-bold text-white mb-4">
                {$LL.onboarding.welcome.title({ worldName })}
            </h2>
            <p class="text-lg text-white/90 leading-relaxed">
                {$LL.onboarding.welcome.description()}
            </p>
            <div class="flex justify-center gap-4 pt-4">
                <button
                    class="px-6 py-3 bg-secondary hover:bg-secondary-800 text-white rounded font-semibold transition-all"
                    data-testid="onboarding-button-welcome-start"
                    onclick={handleNext}
                >
                    {$LL.onboarding.welcome.start()}
                </button>
                <button
                    class="px-6 py-3 bg-transparent hover:bg-white/10 text-white rounded font-semibold transition-all underline-offset-4 hover:underline"
                    data-testid="onboarding-button-welcome-skip"
                    onclick={handleSkip}
                >
                    {$LL.onboarding.welcome.skip()}
                </button>
            </div>
        </div>
    </div>
</div>
