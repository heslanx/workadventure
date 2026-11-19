import { derived, type Readable } from "svelte/store";
import { inviteUserActivated, mapEditorMenuVisibleStore, mapManagerActivated } from "../../../Stores/MenuStore";
import { nameIsEditable } from "../../Preferences/stores/generalSettings";
import { menuGroups, type MenuGroup } from "../domain/officeMenu";
import { broadcastModeStore } from "./globalMessage";
import { officeMenuOpenStore } from "./officeMenuStore";

/**
 * The rows of the menu now. The map editor and the explorer follow the conditions of upstream's map menu
 * (`MapSubMenuContent.svelte`), the megaphone its permission check, the name row its profile menu's policy check and
 * the link the invitations switch (`InviteMenuItem.svelte`).
 * The name policy is not a store: it is read again each time the menu opens, which is when its answer matters.
 */
export const menuGroupsStore: Readable<MenuGroup[]> = derived(
    [mapEditorMenuVisibleStore, mapManagerActivated, broadcastModeStore, inviteUserActivated, officeMenuOpenStore],
    ([mapEditorShown, exploreShown, broadcast, inviteActivated]) =>
        menuGroups({ nameEditable: nameIsEditable(), inviteActivated, mapEditorShown, exploreShown, broadcast }),
);
