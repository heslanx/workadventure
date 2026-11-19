import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { userIsAdminStore } from "../../../Stores/GameStore";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import { megaphoneCanBeUsedStore } from "../../../Stores/MegaphoneStore";
import {
    modalIframeStore,
    modalVisibilityStore,
    showModalGlobalComminucationVisibilityStore,
} from "../../../Stores/ModalStore";
import { broadcastModeStore, openGlobalMessage } from "./globalMessage";

const trackAdminEvent = vi.hoisted(() => vi.fn());
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent } }));
vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { chatVisibilityStore: writable(false) };
});
vi.mock("../../../Stores/MegaphoneStore", async () => {
    const { writable } = await import("svelte/store");
    return { megaphoneCanBeUsedStore: writable(false) };
});

describe("the megaphone row", () => {
    beforeEach(() => {
        trackAdminEvent.mockClear();
        userIsAdminStore.set(false);
        megaphoneCanBeUsedStore.set(false);
        chatVisibilityStore.set(true);
        modalVisibilityStore.set(true);
        modalIframeStore.set({ src: "https://example.test", allow: null, title: "", position: "right" } as never);
        mapEditorModeStore.switchMode(true);
        showModalGlobalComminucationVisibilityStore.set(false);
    });

    it("is offered to nobody who may use neither the megaphone nor announcements", () => {
        expect(get(broadcastModeStore)).toBeUndefined();
    });

    it("is offered by the permission check upstream's map menu uses, as the live broadcast for the megaphone's users", () => {
        megaphoneCanBeUsedStore.set(true);

        expect(get(broadcastModeStore)).toBe("live");
    });

    it("is offered to administrators as the announcement composer", () => {
        userIsAdminStore.set(true);

        expect(get(broadcastModeStore)).toBe("text");
    });

    it("opens the live sheet after closing what upstream's map menu closes first", () => {
        openGlobalMessage("live");

        expect(get(showModalGlobalComminucationVisibilityStore)).toBe("live");
        expect(get(chatVisibilityStore)).toBe(false);
        expect(get(modalVisibilityStore)).toBe(false);
        expect(get(modalIframeStore)).toBeNull();
        expect(get(mapEditorModeStore)).toBe(false);
        expect(trackAdminEvent).not.toHaveBeenCalled();
    });

    it("opens the announcement composer and counts it", () => {
        openGlobalMessage("text");

        expect(get(showModalGlobalComminucationVisibilityStore)).toBe("text");
        expect(trackAdminEvent).toHaveBeenCalledWith("global_message.opened", {
            source: "action_bar",
        });
    });

    it("keeps a sheet that is already open open instead of closing it", () => {
        showModalGlobalComminucationVisibilityStore.set("live");

        openGlobalMessage("live");

        expect(get(showModalGlobalComminucationVisibilityStore)).toBe("live");
    });
});
