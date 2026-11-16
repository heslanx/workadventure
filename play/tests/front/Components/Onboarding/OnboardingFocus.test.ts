// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { Writable } from "svelte/store";

const { onboardingStep } = vi.hoisted((): { onboardingStep: { current: unknown } } => ({
    onboardingStep: { current: undefined },
}));

vi.mock("../../../../src/front/Stores/OnboardingStore", async () => {
    const { writable } = await import("svelte/store");
    const store = writable<string | null>(null);
    onboardingStep.current = store;
    return {
        onboardingStore: {
            subscribe: store.subscribe,
            start: () => store.set("welcome"),
            next: () => store.set("movement"),
            back: () => store.set("welcome"),
            skip: () => store.set(null),
            cancel: () => store.set(null),
            isCompleted: () => true,
        },
    };
});
vi.mock("../../../../src/front/Stores/LiveAnnouncementStore", () => ({ liveAnnouncementStore: { announce: vi.fn() } }));
vi.mock("../../../../src/front/Stores/ScreenSharingStore", async () => ({
    requestedScreenSharingState: (await import("svelte/store")).writable(false),
}));
vi.mock("../../../../src/front/Stores/PeerStore", async () => ({
    activePictureInPictureStore: (await import("svelte/store")).writable(false),
}));
vi.mock("../../../../src/front/Stores/CurrentPlayerGroupStore", async () => ({
    currentPlayerGroupIdStore: (await import("svelte/store")).writable(undefined),
}));
vi.mock("../../../../src/front/Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        inJitsiStore: writable(false),
        inLivekitStore: writable(false),
        silentStore: { setOnboardingOverride: vi.fn() },
    };
});
vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { LL: readable({}) };
});
vi.mock("../../../../src/front/Utils/reducedMotion", () => ({ fade: () => ({ duration: 0 }) }));

// A step is a button that skips the tutorial; the real steps pull the Phaser scene in.
vi.mock("../../../../src/front/Components/Onboarding/Steps/WelcomeStep.svelte", () => ({
    default: (anchor: Comment, props: { onskip: () => void }) => {
        const button = document.createElement("button");
        button.textContent = "skip";
        button.onclick = props.onskip;
        anchor.before(button);
    },
}));
vi.mock("../../../../src/front/Components/Onboarding/Steps/MovementStep.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/Onboarding/Steps/CommunicationStep.svelte", () => ({
    default: () => undefined,
}));
vi.mock("../../../../src/front/Components/Onboarding/Steps/LockBubbleStep.svelte", () => ({
    default: () => undefined,
}));
vi.mock("../../../../src/front/Components/Onboarding/Steps/ScreenSharingStep.svelte", () => ({
    default: () => undefined,
}));
vi.mock("../../../../src/front/Components/Onboarding/Steps/PictureInPictureStep.svelte", () => ({
    default: () => undefined,
}));
vi.mock("../../../../src/front/Components/Onboarding/Steps/CompleteStep.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../src/front/Components/Onboarding/OnboardingHighlight.svelte", () => ({
    default: () => ({ lockBubble: () => undefined }),
}));

import Onboarding from "../../../../src/front/Components/Onboarding/Onboarding.svelte";

describe("tutorial focus", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;
    const step = onboardingStep as unknown as { current: Writable<string | null> };

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        document.body.replaceChildren();
        step.current.set(null);
    });

    it("gives the focus back to what had it before the tutorial opened, once it is skipped", async () => {
        const opener = document.createElement("button");
        document.body.append(opener, target);
        opener.focus();
        component = mount(Onboarding, { target });
        flushSync();

        step.current.set("welcome");
        flushSync();
        const skip = target.querySelector("button");
        expect(skip).not.toBeNull();
        skip?.focus();

        skip?.click();
        flushSync();
        skip?.remove();
        await tick();

        expect(document.activeElement).toBe(opener);
    });

    it("falls back to the profile menu when the opener is gone, and keeps focus that moved elsewhere", async () => {
        const opener = document.createElement("button");
        const profile = document.createElement("div");
        profile.dataset.testid = "action-user";
        const profileButton = document.createElement("div");
        profileButton.setAttribute("role", "button");
        profileButton.tabIndex = 0;
        profile.append(profileButton);
        const other = document.createElement("input");
        document.body.append(opener, profile, other, target);
        opener.focus();
        component = mount(Onboarding, { target });
        flushSync();

        step.current.set("welcome");
        flushSync();
        opener.remove();
        step.current.set(null);
        flushSync();
        await tick();
        expect(document.activeElement).toBe(profileButton);

        step.current.set("welcome");
        flushSync();
        other.focus();
        step.current.set(null);
        flushSync();
        await tick();
        expect(document.activeElement).toBe(other);
    });

    it("falls back to the profile menu when the focus was already on the page body as the tutorial opened", async () => {
        const profile = document.createElement("div");
        profile.dataset.testid = "action-user";
        const profileButton = document.createElement("div");
        profileButton.setAttribute("role", "button");
        profileButton.tabIndex = 0;
        profile.append(profileButton);
        document.body.append(profile, target);
        expect(document.activeElement).toBe(document.body);
        component = mount(Onboarding, { target });
        flushSync();

        step.current.set("welcome");
        flushSync();
        const skip = target.querySelector("button");
        skip?.focus();
        skip?.click();
        flushSync();
        skip?.remove();
        await tick();

        expect(document.activeElement).toBe(profileButton);
    });

    it("leaves the focus alone while the tutorial moves from one step to the next", async () => {
        const opener = document.createElement("button");
        document.body.append(opener, target);
        opener.focus();
        component = mount(Onboarding, { target });
        flushSync();

        step.current.set("welcome");
        flushSync();
        const focused = document.createElement("input");
        document.body.append(focused);
        focused.focus();
        step.current.set("movement");
        flushSync();
        await tick();

        expect(document.activeElement).toBe(focused);
    });
});
