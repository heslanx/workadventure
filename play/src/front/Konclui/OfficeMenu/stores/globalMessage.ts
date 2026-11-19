import { derived, type Readable } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { userIsAdminStore } from "../../../Stores/GameStore";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import { megaphoneCanBeUsedStore } from "../../../Stores/MegaphoneStore";
import {
    modalIframeStore,
    modalVisibilityStore,
    showModalGlobalComminucationVisibilityStore,
} from "../../../Stores/ModalStore";
import { broadcastMode, type BroadcastMode } from "../domain/officeMenu";

// The megaphone row opens the flow upstream's map menu opens, for whoever upstream's map menu offers it to
// (`globalMessageVisibleStore`: the megaphone's users and the administrators).

/** What the megaphone row opens now, or undefined when the user may use neither. */
export const broadcastModeStore: Readable<BroadcastMode | undefined> = derived(
    [megaphoneCanBeUsedStore, userIsAdminStore],
    ([megaphoneAllowed, announcementAllowed]) => broadcastMode({ megaphoneAllowed, announcementAllowed }),
);

/**
 * Opens the live broadcast sheet or the announcement composer over the office, after closing what upstream closes
 * first (the chat, a modal, the map editor), as its map menu does. A sheet already open stays open.
 */
export function openGlobalMessage(mode: BroadcastMode): void {
    chatVisibilityStore.set(false);
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    showModalGlobalComminucationVisibilityStore.set(false);
    mapEditorModeStore.switchMode(false);
    if (mode === "text") analyticsClient.trackAdminEvent("global_message.opened", { source: "action_bar" });
    showModalGlobalComminucationVisibilityStore.set(mode);
}
