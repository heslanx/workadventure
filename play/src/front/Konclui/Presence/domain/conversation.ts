/** The kinds of room the proximity chat manager holds. The same names as upstream's `ProximityChatRoomKind`. */
export type ConversationRoomKind = "default" | "proximity" | "meeting" | "listener" | "speaker" | "area";

/** What one proximity room says about a conversation: who is in its space and whether we are in it. */
export interface ConversationRoom {
    readonly kind: ConversationRoomKind;
    /** Whether the current user is in the room's space now. */
    readonly joined: boolean;
    /** The room's display name: the name of its area for a meeting room. */
    readonly name: string;
    /** The current user's id in the room's space. `undefined` before the join completes. */
    readonly mySpaceUserId: string | undefined;
    /** Everyone in the room's space, the current user included. */
    readonly participants: readonly { readonly spaceUserId: string }[];
}

/**
 * The conversation the current user is in.
 * - `bubble`: the group that forms around people who walk up to each other.
 * - `room`: a meeting area of the map, with the name the map gave it.
 */
export type Conversation =
    | { readonly kind: "bubble"; readonly count: number }
    | { readonly kind: "room"; readonly count: number; readonly placeName: string };

/**
 * The conversation the rooms describe, or `undefined` when the current user talks to nobody.
 *
 * Only a bubble and a meeting area are conversations. A megaphone (speaker, listener) broadcasts to a crowd, and "a
 * conversation with 300 people" would be false. A plain area chat has no call: standing in the same area is not being
 * in someone's call.
 *
 * `count` is the number of other people, each counted once: a person in a bubble and in a meeting area at the same
 * time is one person, and two sessions of one account are two (the space user id is the session's).
 */
export function describeConversation(rooms: readonly ConversationRoom[]): Conversation | undefined {
    const others = new Set<string>();
    let meetingName: string | undefined;
    for (const room of rooms) {
        const isMeeting = room.kind === "meeting";
        if (!room.joined || !(isMeeting || room.kind === "default" || room.kind === "proximity")) continue;
        let hasOthers = false;
        for (const { spaceUserId } of room.participants) {
            if (spaceUserId === room.mySpaceUserId) continue;
            others.add(spaceUserId);
            hasOthers = true;
        }
        if (isMeeting && hasOthers && meetingName === undefined) meetingName = room.name.trim();
    }
    if (others.size === 0) return undefined;
    return meetingName === undefined
        ? { kind: "bubble", count: others.size }
        : { kind: "room", count: others.size, placeName: meetingName };
}

export function isSameConversation(a: Conversation | undefined, b: Conversation | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    if (a.kind === "room" && b.kind === "room") return a.count === b.count && a.placeName === b.placeName;
    return a.kind === b.kind && a.count === b.count;
}
