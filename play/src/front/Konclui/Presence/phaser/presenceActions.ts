import { get } from "svelte/store";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import type { PresenceCommands, WalkTarget } from "../stores/presenceCommands";

// The way upstream's user list walks to a person ("Talk to", `UserActionButton.svelte`): the connection asks the back
// where the person is (`AskPosition`, the default `MOVE` kind) and the client walks to the position that comes back
// (`RoomConnection` handles `moveToPositionMessage`). It works for anyone in the room, in view or not, which is what a
// list of the whole world needs: the client holds a position only for the people in its area of interest.

function walkTo(target: WalkTarget): void {
    const connection = get(gameSceneStore)?.connection;
    if (connection === undefined) {
        throw new Error("[konclui] presence: there is no connection to ask for a position");
    }
    connection.emitAskPosition(target.uuid, target.playUri);
}

export const presenceActions: PresenceCommands = { walkTo };
