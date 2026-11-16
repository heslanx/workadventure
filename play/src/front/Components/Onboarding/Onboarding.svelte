<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { get, type Unsubscriber } from "svelte/store";
    import { onboardingStore } from "../../Stores/OnboardingStore";
    import { liveAnnouncementStore } from "../../Stores/LiveAnnouncementStore";
    import { requestedScreenSharingState } from "../../Stores/ScreenSharingStore";
    import { activePictureInPictureStore } from "../../Stores/PeerStore";
    import { currentPlayerGroupIdStore } from "../../Stores/CurrentPlayerGroupStore";
    import { inJitsiStore, inLivekitStore, silentStore } from "../../Stores/MediaStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import OnboardingStep from "./OnboardingStep.svelte";
    import OnboardingHighlight from "./OnboardingHighlight.svelte";
    import WelcomeStep from "./Steps/WelcomeStep.svelte";
    import MovementStep from "./Steps/MovementStep.svelte";
    import CommunicationStep from "./Steps/CommunicationStep.svelte";
    import LockBubbleStep from "./Steps/LockBubbleStep.svelte";
    import ScreenSharingStep from "./Steps/ScreenSharingStep.svelte";
    import PictureInPictureStep from "./Steps/PictureInPictureStep.svelte";
    import CompleteStep from "./Steps/CompleteStep.svelte";

    let onboardingHighlight: OnboardingHighlight | null = $state(null);
    let onboardingUnsubscribe: Unsubscriber | undefined = undefined;
    // True when the user reached the current step with Back: a step that is already satisfied must not skip itself.
    let reachedByBack = false;

    // Escape skips the tutorial, but only when it comes from inside the tutorial panel: an Escape meant for a menu,
    // a dialog or the map must not end it. There is no confirmation: the tutorial can be replayed from the menu.
    // The listener lives on <svelte:window> for the whole life of the component, not only during the first run: a
    // tutorial replayed from the menu (restart) has the same Skip button and the same "Press Esc" hint.
    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !$onboardingStore) return;
        if (!(event.target instanceof Element) || !event.target.closest("[data-onboarding-panel]")) return;
        handleSkip();
    };

    function destroyOnboarding() {
        if (onboardingUnsubscribe) onboardingUnsubscribe();
    }

    onMount(() => {
        // Auto-start onboarding if not completed (with a small delay to ensure scene is loaded)
        setTimeout(() => {
            if (onboardingStore.isCompleted()) return;

            // Start the onboarding
            onboardingStore.start();

            // Subscribe to the onboarding store
            onboardingUnsubscribe = onboardingStore.subscribe((step) => {
                if (step === null) {
                    destroyOnboarding();
                }
            });
        }, 800);

        return () => {
            destroyOnboarding();
        };
    });

    onDestroy(() => {
        destroyOnboarding();
    });

    // The button that was pressed leaves the page with its step. A user who was working inside the panel keeps their
    // place: the focus goes to the main button of the new step, so Tab and Escape keep working from there.
    function changeStep(action: () => void) {
        const panel = document.querySelector("[data-onboarding-panel]");
        const hadFocus = panel?.contains(document.activeElement) ?? false;
        action();
        if (!hadFocus) return;
        tick()
            .then(() => {
                document.querySelector<HTMLElement>("[data-onboarding-panel] [data-onboarding-primary]")?.focus();
            })
            .catch((error: unknown) => console.error("Could not move the focus to the new tutorial step", error));
    }

    function handleNext() {
        // If we're in the lockBubble step, lock the bubble (make it red) before advancing
        if ($onboardingStore === "lockBubble" && onboardingHighlight) {
            onboardingHighlight.lockBubble();
        }
        reachedByBack = false;
        changeStep(() => onboardingStore.next());
    }

    function handleBack() {
        reachedByBack = true;
        changeStep(() => onboardingStore.back());
    }

    function handleSkip() {
        onboardingStore.skip();
    }

    // During onboarding: temporarily disable silent zone so the communication demo works
    $effect(() => {
        silentStore.setOnboardingOverride($onboardingStore !== null);
    });

    // Stop the tutorial if the user enters a real conversation bubble or meeting. The user did not choose to skip it,
    // so it is not marked as done: it is offered again on the next visit and can be replayed from the menu.
    $effect(() => {
        if ($onboardingStore && ($currentPlayerGroupIdStore !== undefined || $inJitsiStore || $inLivekitStore)) {
            onboardingStore.cancel();
            silentStore.setOnboardingOverride(false);
            liveAnnouncementStore.announce(get(LL).onboarding.cancelledByConversation());
        }
    });

    // Watch for step completion conditions
    $effect(() => {
        // Note: lockBubble step completion is handled by click interceptor in OnboardingHighlight
        // The step is read before anything else: an early return that skipped it would leave the effect without
        // dependencies, and it would never run again for the next step.
        const step = $onboardingStore;
        if (step === null) reachedByBack = false;
        // A step that is already satisfied when it opens moves on, except when the user came back to it on purpose.
        if (reachedByBack) return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        if (step === "screenSharing" && get(requestedScreenSharingState)) {
            timeout = setTimeout(() => changeStep(() => onboardingStore.next()), 1000);
        }
        if (step === "pictureInPicture" && get(activePictureInPictureStore)) {
            timeout = setTimeout(() => changeStep(() => onboardingStore.next()), 1000);
        }
        return () => {
            if (timeout) clearTimeout(timeout);
        };
    });
</script>

<svelte:window onkeydown={handleKeyDown} />

<OnboardingStep>
    {#if $onboardingStore === "welcome"}
        <WelcomeStep onnext={handleNext} onskip={handleSkip} />
    {:else if $onboardingStore === "movement"}
        <MovementStep onnext={handleNext} onback={handleBack} onskip={handleSkip} />
    {:else if $onboardingStore === "communication"}
        <CommunicationStep onnext={handleNext} onback={handleBack} onskip={handleSkip} />
    {:else if $onboardingStore === "lockBubble"}
        <LockBubbleStep onnext={handleNext} onback={handleBack} onskip={handleSkip} />
    {:else if $onboardingStore === "screenSharing"}
        <ScreenSharingStep onnext={handleNext} onback={handleBack} onskip={handleSkip} />
    {:else if $onboardingStore === "pictureInPicture"}
        <PictureInPictureStep onnext={handleNext} onback={handleBack} onskip={handleSkip} />
    {:else if $onboardingStore === "complete"}
        <CompleteStep onnext={handleNext} onback={handleBack} />
    {/if}
</OnboardingStep>
<OnboardingHighlight bind:this={onboardingHighlight} />
