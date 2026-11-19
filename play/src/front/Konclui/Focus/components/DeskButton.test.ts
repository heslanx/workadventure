// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { AreaData } from "@workadventure/map-editor";
import { warningMessageStore } from "../../../Stores/ErrorStore";
import { isInsidePersonalAreaStore, personalAreaDataStore } from "../../../Stores/PersonalDeskStore";
import { installDeskCommands } from "../stores/deskCommands";
import DeskButton from "./DeskButton.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
// The real action bar button is under test (its disabled-with-a-reason behavior is the point); only what it reads
// from the rest of the app is replaced.
vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { helpTextDisabledStore: writable(false) };
});
vi.mock("../../../Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: vi.fn() } }));

const DESK = { id: "desk-1", name: "Ana's desk" } as unknown as AreaData;

describe("DeskButton", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;
    const walkToDesk = vi.fn();

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        personalAreaDataStore.set(null);
        isInsidePersonalAreaStore.set(false);
        walkToDesk.mockReset();
        vi.restoreAllMocks();
    });

    function show(): void {
        installDeskCommands({ walkToDesk });
        document.body.append(target);
        component = mount(DeskButton, { target });
        flushSync();
    }

    const button = (): HTMLButtonElement | null => target.querySelector('[data-testid="go-to-personal-desk-button"]');

    it("leaves the button out for a user who has no desk, instead of showing a dead one", () => {
        show();

        expect(button()).toBeNull();
    });

    it("walks to the desk on a click when there is a desk to go to", () => {
        walkToDesk.mockResolvedValue(undefined);
        personalAreaDataStore.set(DESK);
        show();

        button()?.click();

        expect(button()?.getAttribute("aria-label")).toBe("actionbar.personalDesk.label");
        expect(walkToDesk).toHaveBeenCalledTimes(1);
        expect(button()?.hasAttribute("aria-disabled")).toBe(false);
    });

    it("stays focusable at the desk, says why it does nothing, and does not walk", () => {
        personalAreaDataStore.set(DESK);
        isInsidePersonalAreaStore.set(true);
        show();
        const desk = button();

        desk?.focus();
        desk?.click();
        flushSync();

        expect(desk?.disabled).toBe(false);
        expect(desk?.getAttribute("aria-disabled")).toBe("true");
        expect(document.activeElement).toBe(desk);
        expect(
            target.querySelector('[data-testid="go-to-personal-desk-button-blocked-reason"]')?.textContent,
        ).toContain("actionbar.blocked.alreadyAtDesk");
        expect(desk?.getAttribute("aria-describedby")).toBe(
            target.querySelector('[data-testid="go-to-personal-desk-button-blocked-reason"]')?.id,
        );
        expect(walkToDesk).not.toHaveBeenCalled();
    });

    it("follows the player into the desk and out of it", () => {
        personalAreaDataStore.set(DESK);
        show();
        expect(button()?.hasAttribute("aria-disabled")).toBe(false);

        isInsidePersonalAreaStore.set(true);
        flushSync();
        expect(button()?.getAttribute("aria-disabled")).toBe("true");

        isInsidePersonalAreaStore.set(false);
        flushSync();
        expect(button()?.hasAttribute("aria-disabled")).toBe(false);
    });

    it("reports a walk that fails, in the console and to the user", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        walkToDesk.mockRejectedValue(new Error("No path found"));
        personalAreaDataStore.set(DESK);
        show();

        button()?.click();
        await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));

        expect(String(logged.mock.calls[0][0])).toContain("could not walk to the desk");
        expect(warningMessageStore.addWarningMessage).toHaveBeenCalledWith("actionbar.personalDesk.errorMoving", {
            closable: true,
        });
    });
});
