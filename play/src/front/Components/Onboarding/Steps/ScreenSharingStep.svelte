<script lang="ts">
    import { fly } from "../../../Utils/reducedMotion";
    import LL from "../../../../i18n/i18n-svelte";
    import OnboardingNav from "../OnboardingNav.svelte";
    import OnboardingVideo from "../OnboardingVideo.svelte";

    interface Props {
        onnext?: () => void;
        onback?: () => void;
        onskip?: () => void;
    }

    const { onnext, onback, onskip }: Props = $props();

    function handleNext() {
        onnext?.();
    }
</script>

<div class="fixed top-1/2 -right-10 transform -translate-x-14 -translate-y-1/2 z-[3001] pointer-events-auto">
    <div
        class="bg-contrast/90 backdrop-blur-lg rounded-lg p-6 max-w-lg shadow-lg border border-white/20"
        in:fly={{ y: 10, duration: 400 }}
    >
        <div class="space-y-4">
            <h3 class="text-xl font-bold text-white">
                {$LL.onboarding.screenSharing.title()}
            </h3>
            <p class="text-sm text-white/90 mb-4">
                {$LL.onboarding.screenSharing.description()}
            </p>
            {#if $LL.onboarding.screenSharing.video()}
                <OnboardingVideo src={$LL.onboarding.screenSharing.video()} />
            {/if}
            <p class="text-xs text-white/70 italic">
                {$LL.onboarding.screenSharing.hint()}
            </p>
            <button
                class="mt-4 px-4 py-2 bg-secondary hover:bg-secondary-800 text-white rounded font-semibold transition-all"
                data-onboarding-primary
                onclick={handleNext}
            >
                {$LL.onboarding.screenSharing.next()}
            </button>
            <OnboardingNav {onback} {onskip} />
        </div>
    </div>
</div>
