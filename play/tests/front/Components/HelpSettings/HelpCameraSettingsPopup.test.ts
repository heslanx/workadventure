// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import HelpCameraSettingsPopup from "../../../../src/front/Components/HelpSettings/HelpCameraSettingsPopup.svelte";

vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every message reads as its own path, e.g. "camera.help.showSteps".
    const messages = (path: string): unknown =>
        new Proxy(() => path, {
            get: (_target, name) => messages(path === "" ? String(name) : `${path}.${String(name)}`),
        });
    return { LL: readable(messages("")), locale: readable("en-US") };
});

// jsdom has no Element.animate: the transition is not what is tested here.
vi.mock("../../../../src/front/Utils/reducedMotion", () => ({ fly: () => ({ duration: 0 }) }));

describe("camera permission help popup", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.replaceChildren();
    });

    function render(props: { camera?: boolean; microphone?: boolean }) {
        component = mount(HelpCameraSettingsPopup, { target, props });
        flushSync();
    }

    it("names the blocked device the caller gives, with no Permissions API to say it", () => {
        render({ microphone: true });

        expect(target.textContent).toContain("camera.help.microphoneTitle");
        expect(target.textContent).toContain("camera.help.continueWithoutMicrophone");
    });

    it("labels the button for what it does and keeps the way out calm", () => {
        render({ camera: true });

        const [showSteps, dismiss] = Array.from(target.querySelectorAll("button"));
        expect(showSteps.textContent).toContain("camera.help.showSteps");
        expect(showSteps.getAttribute("aria-expanded")).toBe("false");
        // Not red: continuing without a camera harms nothing, and the e2e specs submit the form through it.
        expect(dismiss.type).toBe("submit");
        expect(dismiss.className).not.toContain("btn-danger");
        expect(showSteps.className).not.toContain("btn-success");
    });

    it("shows the written steps, and no image of another browser, when asked", () => {
        render({ camera: true });
        expect(target.querySelector("[data-testid=permission-help-steps]")).toBeNull();

        target.querySelector("button")?.click();
        flushSync();

        expect(target.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
        expect(target.querySelector("button")?.textContent).toContain("camera.help.hideSteps");
        expect(target.querySelector("[data-testid=permission-help-steps]")?.textContent).toContain(
            "camera.help.steps.",
        );
        // jsdom is no browser the help has a screenshot of
        expect(target.querySelector("img")).toBeNull();
    });
});
