import { AvailabilityStatus } from "@workadventure/messages";
import { derived, get, type Readable } from "svelte/store";
import { resetAllStatusStoreExcept } from "../../../Rules/StatusRules/statusChangerFunctions";
import type { RequestedStatus } from "../../../Rules/StatusRules/statusRules";
import { availabilityStatusStore } from "../../../Stores/MediaStore";
import { getColorHexOfStatus } from "../../../Utils/AvailabilityStatus";
import type { StatusChoice, StatusState } from "../domain/officeMenu";

// Your status, read and written the way upstream's status list does (AvailabilityStatusList.svelte): the status
// shown is `availabilityStatusStore`, and a choice is a request that `resetAllStatusStoreExcept` stores and saves.

/** What each choice asks upstream for; `online` asks for nothing, which clears an earlier request. */
const REQUESTED: Readonly<Record<StatusChoice, RequestedStatus | null>> = {
    online: null,
    busy: AvailabilityStatus.BUSY,
    away: AvailabilityStatus.BACK_IN_A_MOMENT,
    doNotDisturb: AvailabilityStatus.DO_NOT_DISTURB,
};

const SHOWN: Readonly<Record<StatusChoice, AvailabilityStatus>> = {
    online: AvailabilityStatus.ONLINE,
    busy: AvailabilityStatus.BUSY,
    away: AvailabilityStatus.BACK_IN_A_MOMENT,
    doNotDisturb: AvailabilityStatus.DO_NOT_DISTURB,
};

/** The statuses a call or a place decides; upstream's list offers no other choice then either. */
const LOCKED = new Set<AvailabilityStatus>([
    AvailabilityStatus.LISTENER,
    AvailabilityStatus.SPEAKER,
    AvailabilityStatus.JITSI,
    AvailabilityStatus.LIVEKIT,
    AvailabilityStatus.BBB,
    AvailabilityStatus.DENY_PROXIMITY_MEETING,
    AvailabilityStatus.SILENT,
    AvailabilityStatus.SOUND_BLOCKED,
]);

/** Which choice a status is, and whether the place decides it. Another status (away from the keyboard) is neither. */
export function statusStateOf(status: AvailabilityStatus): StatusState {
    const choice = (Object.keys(SHOWN) as StatusChoice[]).find((name) => SHOWN[name] === status);
    return { choice, locked: LOCKED.has(status) };
}

export const statusStateStore: Readable<StatusState> = derived(availabilityStatusStore, statusStateOf);

/** The dot colour of a choice: upstream's own, so the dock's profile button and this menu agree. */
export function dotColorOf(choice: StatusChoice): string {
    return getColorHexOfStatus(SHOWN[choice]);
}

/** Sets the status; while the place decides it there is nothing to set, and the menu says so. */
export function chooseStatus(choice: StatusChoice): void {
    if (get(statusStateStore).locked) return;
    resetAllStatusStoreExcept(REQUESTED[choice]);
}
