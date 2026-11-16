import { writable, get, derived } from "svelte/store";
import { gameManager } from "../Phaser/Game/GameManager";
import { ENABLE_TUTORIAL } from "../Enum/EnvironmentVariable";
import { touchScreenManager } from "../Touch/TouchScreenManager";
import { inBbbStore, inJitsiStore, inLivekitStore } from "./MediaStore";

const TUTORIAL_DONE_KEY = "tutorialDone";

/** True when the current onboarding run is the short mobile flow (joystick + communication + complete) */
export const isMobileOnboarding = writable<boolean>(false);

/** Set of currently pressed movement key codes (KeyW, KeyA, etc.) during the movement step */
export const pressedKeysStore = writable<Set<string>>(new Set());

/** True when any movement key is currently pressed - derived from pressedKeysStore */
export const movementKeysPressedStore = derived(pressedKeysStore, ($keys) => $keys.size > 0);

export type OnboardingStep =
    | "welcome"
    | "movement"
    | "communication"
    | "lockBubble"
    | "screenSharing"
    | "pictureInPicture"
    | "complete"
    | null;

/** The steps of one run, in order. The mobile run is shorter (joystick + communication + complete). */
function getOnboardingSteps(mobile: boolean): OnboardingStep[] {
    return mobile
        ? ["welcome", "movement", "communication", "complete"]
        : ["welcome", "movement", "communication", "lockBubble", "screenSharing", "pictureInPicture", "complete"];
}

function createOnboardingStore() {
    const { subscribe, set } = writable<OnboardingStep | null>(null);

    const isCompleted = (): boolean => {
        // If the user is already in a conversation bubble, we consider the onboarding as completed
        if (get(inJitsiStore) || get(inLivekitStore) || get(inBbbStore) || get(inLivekitStore)) {
            return true;
        }

        // If the room has enableTutorial set to false, we consider the onboarding as completed
        const scene = gameManager.getCurrentGameScene();
        const { enableTutorial } = (scene?.room?.metadata as { enableTutorial?: boolean }) ?? {
            enableTutorial: ENABLE_TUTORIAL ?? true,
        };
        if (!enableTutorial) return true;

        // Check player state "tutorialDone" (same as WA.player.state.tutorialDone in scripting API)
        const manager = scene?.getPlayerVariablesManager?.();
        if (!manager) return false;
        const value = manager.variables.get(TUTORIAL_DONE_KEY);
        return value === true || value === "true";
    };

    const start = () => {
        if (isCompleted()) {
            set(null);
            return;
        }
        const mobile = touchScreenManager.primaryTouchDevice;
        isMobileOnboarding.set(mobile);
        set("welcome");
    };

    const next = () => {
        const current = get({ subscribe });
        if (current === null) return;

        const steps = getOnboardingSteps(get(isMobileOnboarding));
        const currentIndex = steps.indexOf(current);

        if (currentIndex < steps.length - 1) {
            set(steps[currentIndex + 1]);
        } else {
            complete();
        }
    };

    /** Goes back one step. Does nothing on the first step. */
    const back = () => {
        const current = get({ subscribe });
        if (current === null) return;

        const steps = getOnboardingSteps(get(isMobileOnboarding));
        const currentIndex = steps.indexOf(current);

        if (currentIndex > 0) {
            set(steps[currentIndex - 1]);
        }
    };

    /** The user chose to leave the tutorial: it counts as done, so it does not come back on its own. */
    const skip = () => {
        complete();
    };

    /**
     * The tutorial stops for a reason the user did not choose (they walked into a real conversation): it is closed
     * without being marked as done, so it is offered again on the next visit.
     */
    const cancel = () => {
        close(false);
    };

    const complete = () => {
        close(true);
    };

    const close = (markAsDone: boolean) => {
        isMobileOnboarding.set(false);
        const scene = gameManager.getCurrentGameScene();
        if (markAsDone) {
            const manager = scene?.getPlayerVariablesManager?.();
            if (manager) {
                manager.setVariableFromApp(TUTORIAL_DONE_KEY, true, { persist: true, scope: "world" });
            }
        }
        const cameraManager = scene?.getCameraManager();
        // Stop camera following for onboarding completion
        if (cameraManager && isMobileOnboarding) {
            cameraManager.stopFollowRemotePlayer();
        }
        set(null);
    };

    const reset = () => {
        isMobileOnboarding.set(false);
        const scene = gameManager.getCurrentGameScene();
        const manager = scene?.getPlayerVariablesManager?.();
        if (manager) {
            manager.setVariableFromApp(TUTORIAL_DONE_KEY, false, { persist: true, scope: "world" });
        }
        set(null);
    };

    const restart = () => {
        reset();
        const mobile = touchScreenManager.primaryTouchDevice;
        isMobileOnboarding.set(touchScreenManager.primaryTouchDevice);
        setTimeout(() => {
            set(mobile ? "movement" : "welcome");
        }, 100);
    };

    return {
        subscribe,
        start,
        next,
        back,
        skip,
        cancel,
        complete,
        reset,
        restart,
        isCompleted,
    };
}

export const onboardingStore = createOnboardingStore();

/** Position of the current step in the current run (1-based), or undefined when no tutorial is running. */
export const onboardingProgressStore = derived(
    [onboardingStore, isMobileOnboarding],
    ([$onboardingStore, $isMobileOnboarding]) => {
        if ($onboardingStore === null) return undefined;
        const steps = getOnboardingSteps($isMobileOnboarding);
        const index = steps.indexOf($onboardingStore);
        if (index < 0) return undefined;
        return { current: index + 1, total: steps.length };
    },
);
