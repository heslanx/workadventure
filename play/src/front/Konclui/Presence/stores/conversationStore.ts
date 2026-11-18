import * as Sentry from "@sentry/svelte";
import { asError } from "catch-unknown";
import { derived, type Readable } from "svelte/store";
import type { ProximityChatRoom } from "../../../Chat/Connection/Proximity/ProximityChatRoom";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { silentStore } from "../../../Stores/MediaStore";
import {
    describeConversation,
    isSameConversation,
    type Conversation,
    type ConversationRoom,
} from "../domain/conversation";
import { throttledStore } from "./throttledStore";

/** What one proximity room says about the conversation, read from its own stores. */
function viewOf(room: ProximityChatRoom): Readable<ConversationRoom> {
    return derived(
        [room.kind, room.isJoined, room.name, room.currentMeetingParticipantsStore],
        ([kind, joined, name, participants]) => ({
            kind,
            joined,
            name,
            mySpaceUserId: room.getCurrentSpace()?.mySpaceUserId,
            participants,
        }),
    );
}

/** Every room of the list as the conversation sees it. The list changes as rooms are created and each view follows its own room. */
function viewsOf(rooms: Readable<ProximityChatRoom[]>): Readable<readonly ConversationRoom[]> {
    return derived(
        rooms,
        (list, set: (views: readonly ConversationRoom[]) => void) => {
            if (list.length === 0) {
                set([]);
                return;
            }
            return derived(list.map(viewOf), (views) => views).subscribe(set);
        },
        [],
    );
}

/**
 * The proximity rooms of the running scene, each as the conversation sees it. The scene builds its room manager in
 * `joinRoom()`, after the scene store is set, so the manager is awaited, and the work of a scene that has been replaced
 * in the meantime is dropped.
 */
const roomsStore: Readable<readonly ConversationRoom[]> = derived(
    gameSceneStore,
    (scene, set: (rooms: readonly ConversationRoom[]) => void) => {
        set([]);
        if (scene === undefined) return;
        let stopped = false;
        let stopRooms: (() => void) | undefined;
        scene.proximityChatRoomManagerReady
            .then((manager) => {
                if (!stopped) stopRooms = viewsOf(manager.roomsStore).subscribe(set);
            })
            .catch((error: unknown) => {
                const cause = asError(error);
                console.error("[konclui] presence: the conversation could not follow the proximity rooms", cause);
                Sentry.captureException(cause);
            });
        return () => {
            stopped = true;
            stopRooms?.();
        };
    },
    [],
);

/**
 * The conversation the current user is in, as it is now. Nobody talks in a silent zone, whatever the rooms hold
 * (upstream's `isInRemoteConversation` says the same).
 */
export const conversationStore: Readable<Conversation | undefined> = derived(
    [roomsStore, silentStore],
    ([rooms, silent]) => (silent ? undefined : describeConversation(rooms)),
);

/**
 * The conversation as the chip shows and announces it: the same, but changing at most once every two seconds, so a
 * bubble that people join and leave does not make the screen reader announce each step.
 */
export const callChipStore: Readable<Conversation | undefined> = throttledStore(conversationStore, isSameConversation);
