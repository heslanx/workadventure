import { AvailabilityStatus } from "@workadventure/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import { resetAllStatusStoreExcept } from "../../../Rules/StatusRules/statusChangerFunctions";
import { availabilityStatusStore } from "../../../Stores/MediaStore";
import { chooseStatus, statusStateOf, statusStateStore } from "./menuStatus";

vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    const { AvailabilityStatus } = await import("@workadventure/messages");
    return { availabilityStatusStore: writable(AvailabilityStatus.ONLINE) };
});
vi.mock("../../../Rules/StatusRules/statusChangerFunctions", () => ({ resetAllStatusStoreExcept: vi.fn() }));
vi.mock("../../../Utils/AvailabilityStatus", () => ({ getColorHexOfStatus: () => "#000000" }));

// The mocked store is a writable: the test moves the status the way upstream's rules would.
const shownStatus = availabilityStatusStore as unknown as Writable<AvailabilityStatus>;

describe("statusStateOf", () => {
    it.each([
        [AvailabilityStatus.ONLINE, "online"],
        [AvailabilityStatus.BUSY, "busy"],
        [AvailabilityStatus.BACK_IN_A_MOMENT, "away"],
        [AvailabilityStatus.DO_NOT_DISTURB, "doNotDisturb"],
    ] as const)("reads status %s as the choice %s, free to change", (status, choice) => {
        expect(statusStateOf(status)).toEqual({ choice, locked: false });
    });

    it.each([
        AvailabilityStatus.JITSI,
        AvailabilityStatus.BBB,
        AvailabilityStatus.LIVEKIT,
        AvailabilityStatus.SPEAKER,
        AvailabilityStatus.LISTENER,
        AvailabilityStatus.SILENT,
        AvailabilityStatus.DENY_PROXIMITY_MEETING,
        AvailabilityStatus.SOUND_BLOCKED,
    ])("locks status %s, which a call or a place decides, with no choice marked", (status) => {
        expect(statusStateOf(status)).toEqual({ choice: undefined, locked: true });
    });

    it("marks no choice, and locks nothing, for the away status the privacy shutdown sets", () => {
        expect(statusStateOf(AvailabilityStatus.AWAY)).toEqual({ choice: undefined, locked: false });
    });
});

describe("chooseStatus", () => {
    beforeEach(() => {
        vi.mocked(resetAllStatusStoreExcept).mockClear();
        shownStatus.set(AvailabilityStatus.ONLINE);
    });

    it.each([
        ["busy", AvailabilityStatus.BUSY],
        ["away", AvailabilityStatus.BACK_IN_A_MOMENT],
        ["doNotDisturb", AvailabilityStatus.DO_NOT_DISTURB],
    ] as const)("asks upstream for %s with the setter its own status list uses", (choice, requested) => {
        chooseStatus(choice);

        expect(resetAllStatusStoreExcept).toHaveBeenCalledExactlyOnceWith(requested);
    });

    it("clears the request for online, as upstream's list does", () => {
        shownStatus.set(AvailabilityStatus.BUSY);

        chooseStatus("online");

        expect(resetAllStatusStoreExcept).toHaveBeenCalledExactlyOnceWith(null);
    });

    it("writes nothing while a call decides the status", () => {
        shownStatus.set(AvailabilityStatus.LIVEKIT);

        chooseStatus("busy");

        expect(resetAllStatusStoreExcept).not.toHaveBeenCalled();
    });

    it("follows the status upstream shows", () => {
        shownStatus.set(AvailabilityStatus.DO_NOT_DISTURB);

        expect(get(statusStateStore)).toEqual({ choice: "doNotDisturb", locked: false });
    });
});
