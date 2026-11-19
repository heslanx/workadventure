// The office menu the Konclui logo opens (the reference's `kmh-menu`): which rows it holds, in which groups, and how
// the arrow keys move through them. The rows are upstream's profile and map menus put in one place; whether a row
// shows follows the same conditions as the upstream menu it comes from, so the stores hand those conditions in.

/** The four statuses a user can choose. `online` clears the request, as upstream's status list does. */
export type StatusChoice = "online" | "busy" | "away" | "doNotDisturb";

export const STATUS_CHOICES: readonly StatusChoice[] = ["online", "busy", "away", "doNotDisturb"];

/** The status the user sees now, and whether where they are decides it (a meeting, a silent zone, a blocked sound). */
export interface StatusState {
    readonly choice: StatusChoice | undefined;
    readonly locked: boolean;
}

/** What the megaphone row opens: the live broadcast, or the written announcement. */
export type BroadcastMode = "live" | "text";

export type MenuActionId =
    | "editName"
    | "avatar"
    | "companion"
    | "cameraMicrophone"
    | "settings"
    | "shareLink"
    | "mapEditor"
    | "explore"
    | "broadcast";

export type MenuGroupId = "status" | "profile" | "settings" | "tools";

export type MenuEntry =
    | { readonly kind: "status"; readonly choice: StatusChoice }
    | { readonly kind: "action"; readonly id: MenuActionId };

export interface MenuGroup {
    readonly id: MenuGroupId;
    readonly entries: readonly MenuEntry[];
}

/** The conditions upstream's own menus put on their rows. */
export interface MenuContext {
    /** The admin or a map script can switch invitations off: then the link is not offered, as upstream's Share is not. */
    readonly inviteActivated: boolean;
    /** An OpenID name policy can force the account's name: then there is no name to edit. */
    readonly nameEditable: boolean;
    /** Upstream's map menu shows the editor only on a map that has one and to those who may edit it. */
    readonly mapEditorShown: boolean;
    /** And the explorer only where the room allows it. */
    readonly exploreShown: boolean;
    /** What the megaphone row opens; undefined when the user may use neither. */
    readonly broadcast: BroadcastMode | undefined;
}

/**
 * What the megaphone row opens, from the two permissions upstream's map menu checks. The live broadcast is the
 * megaphone; a written announcement is the administrators' own and comes when the megaphone is not theirs to use.
 */
export function broadcastMode(permissions: {
    readonly megaphoneAllowed: boolean;
    readonly announcementAllowed: boolean;
}): BroadcastMode | undefined {
    if (permissions.megaphoneAllowed) return "live";
    return permissions.announcementAllowed ? "text" : undefined;
}

function actions(...ids: (MenuActionId | undefined)[]): MenuEntry[] {
    return ids.flatMap((id): MenuEntry[] => (id === undefined ? [] : [{ kind: "action", id }]));
}

/** The groups of the menu, in the reference's order, without a group that has no row to show. */
export function menuGroups(context: MenuContext): MenuGroup[] {
    const groups: MenuGroup[] = [
        { id: "status", entries: STATUS_CHOICES.map((choice) => ({ kind: "status", choice })) },
        { id: "profile", entries: actions(context.nameEditable ? "editName" : undefined, "avatar", "companion") },
        {
            id: "settings",
            entries: actions("cameraMicrophone", "settings", context.inviteActivated ? "shareLink" : undefined),
        },
        {
            id: "tools",
            entries: actions(
                context.mapEditorShown ? "mapEditor" : undefined,
                context.exploreShown ? "explore" : undefined,
                context.broadcast === undefined ? undefined : "broadcast",
            ),
        },
    ];
    return groups.filter((group) => group.entries.length > 0);
}

/** A stable key for a row, for the keyed list and for the row that holds the focus. */
export function entryKey(entry: MenuEntry): string {
    return entry.kind === "status" ? `status:${entry.choice}` : `action:${entry.id}`;
}

/**
 * The row a key moves to in a menu of `count` rows, wrapping at both ends, or undefined for a key that does not
 * move. Up and Down move, Home and End jump; Left and Right are for submenus, which this menu has none of.
 */
export function rowAfter(index: number, key: string, count: number): number | undefined {
    if (count <= 0) return undefined;
    switch (key) {
        case "ArrowDown":
            return (index + 1) % count;
        case "ArrowUp":
            return (index - 1 + count) % count;
        case "Home":
            return 0;
        case "End":
            return count - 1;
        default:
            return undefined;
    }
}
