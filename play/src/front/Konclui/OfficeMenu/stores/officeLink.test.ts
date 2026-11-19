// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invitePreferencesStore } from "../../../Stores/InvitePreferencesStore";
import { playerPosition, startPositionNames } from "../../Preferences/stores/gameCommands";
import { reportLinkCopied } from "../../Preferences/stores/generalSettings";
import { copyOfficeLink, currentOfficeLink } from "./officeLink";

vi.mock("../../../Stores/InvitePreferencesStore", async () => {
    const { writable } = await import("svelte/store");
    return { invitePreferencesStore: writable({ entryPoint: "", walkAutomatically: false, showZoneSelect: false }) };
});
vi.mock("../../Preferences/stores/gameCommands", () => ({ playerPosition: vi.fn(), startPositionNames: vi.fn() }));
vi.mock("../../Preferences/stores/generalSettings", () => ({ reportLinkCopied: vi.fn() }));

const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>() };

describe("the office link", () => {
    beforeEach(() => {
        vi.stubGlobal("navigator", { clipboard });
        clipboard.writeText.mockReset().mockResolvedValue(undefined);
        vi.mocked(reportLinkCopied).mockClear();
        vi.mocked(startPositionNames).mockReturnValue([]);
        vi.mocked(playerPosition).mockReturnValue({ x: 120, y: 340 });
        invitePreferencesStore.set({ entryPoint: "", walkAutomatically: false, showZoneSelect: false });
        window.history.replaceState({}, "", "/_/global/example.test/office.json?token=abc#someone-elses-entry");
    });

    it("is the room's address alone on a map without start positions, never the query the user arrived with", () => {
        expect(currentOfficeLink()).toBe(`${window.location.origin}/_/global/example.test/office.json`);
    });

    it("names the saved entrance when the map has it, or the map's first when it does not", () => {
        vi.mocked(startPositionNames).mockReturnValue(["lobby", "roof"]);
        invitePreferencesStore.set({ entryPoint: "roof", walkAutomatically: false, showZoneSelect: true });
        expect(currentOfficeLink()).toMatch(/office\.json#roof$/);

        invitePreferencesStore.set({ entryPoint: "gone", walkAutomatically: false, showZoneSelect: true });
        expect(currentOfficeLink()).toMatch(/office\.json#lobby$/);
    });

    it("walks the guest to where the user stands when the invite asks for it", () => {
        vi.mocked(startPositionNames).mockReturnValue(["lobby"]);
        invitePreferencesStore.set({ entryPoint: "lobby", walkAutomatically: true, showZoneSelect: false });

        expect(currentOfficeLink()).toMatch(/office\.json#lobby&moveTo=120,340$/);
    });

    it("copies the link and counts the invite", async () => {
        await copyOfficeLink();

        expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
            `${window.location.origin}/_/global/example.test/office.json`,
        );
        expect(reportLinkCopied).toHaveBeenCalledOnce();
    });

    it("rejects when the browser refuses, and counts nothing", async () => {
        clipboard.writeText.mockRejectedValue(new Error("denied"));

        await expect(copyOfficeLink()).rejects.toThrow("denied");
        expect(reportLinkCopied).not.toHaveBeenCalled();
    });
});
