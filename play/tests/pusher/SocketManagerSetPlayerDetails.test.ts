import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { PusherToBackSpaceMessage } from "@workadventure/messages";
import {
    AvailabilityStatus,
    FilterType,
    SetPlayerDetailsMessage,
    SpaceUser,
    SubMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import { EventProcessor } from "../../src/pusher/models/EventProcessor";
import type { SpaceInterface, SpaceUserExtended } from "../../src/pusher/models/Space";
import { Space } from "../../src/pusher/models/Space";
import type { SpaceConnectionInterface } from "../../src/pusher/models/SpaceConnection";
import type { BackSpaceConnection } from "../../src/pusher/models/Websocket/SocketData";

const flushPromises = () => new Promise(setImmediate);

describe("SocketManager.handleSetPlayerDetails", () => {
    it("keeps the latest status for the spaces the user joins later", async () => {
        const socketData = {
            availabilityStatus: AvailabilityStatus.ONLINE,
            spaces: new Set<string>(),
            backConnection: { write: vi.fn() },
        };
        const client = mock<PusherWebSocket>({ getUserData: vi.fn().mockReturnValue(socketData) });
        const manager = new SocketManager();

        await manager.handleSetPlayerDetails(
            client,
            SetPlayerDetailsMessage.fromPartial({ availabilityStatus: AvailabilityStatus.AWAY }),
        );
        expect(socketData.availabilityStatus).toBe(AvailabilityStatus.AWAY);

        // A message that only changes another detail leaves the status alone.
        await manager.handleSetPlayerDetails(client, SetPlayerDetailsMessage.fromPartial({ showVoiceIndicator: true }));
        expect(socketData.availabilityStatus).toBe(AvailabilityStatus.AWAY);
    });
});

// What one change of the player details costs the pusher, counted in what it hands to the sockets of the watchers.
describe("SocketManager.handleSetPlayerDetails fan-out", () => {
    // Every client of the room watches the world user list, only to count and list people.
    const WORLD_WATCHERS = 40;
    // The speaker and two peers share a bubble: the one space where the talk indicator is drawn.
    const BUBBLE_MEMBERS = 3;
    const WORLD_PROPERTIES = ["availabilityStatus", "chatID"];
    const BUBBLE_PROPERTIES = ["cameraState", "microphoneState", "screenSharingState"];

    type Watcher = ReturnType<typeof createWatcher>;

    function createWatcher(index: number) {
        const received: SubMessage[] = [];
        const socketData = {
            spaceUserId: `room_${index}`,
            userUuid: `uuid-${index}`,
            name: `Player number ${index}`,
            roomId: "https://play.test/@/org/world/room",
            availabilityStatus: AvailabilityStatus.ONLINE,
            spaces: new Set<string>(),
            joinSpacesPromise: new Map<string, Promise<void>>(),
            backConnection: { write: vi.fn() },
        };
        const socket = {
            getUserData: () => socketData,
            emitInBatch: (message: SubMessage) => {
                received.push(message);
            },
        } as unknown as PusherWebSocket;
        return { socket, socketData, received };
    }

    // What the space holds about a user: the record whose size makes a whole-record update costly.
    function userRecord({ socketData }: Watcher): SpaceUser {
        return SpaceUser.fromPartial({
            spaceUserId: socketData.spaceUserId,
            uuid: socketData.userUuid,
            name: socketData.name,
            playUri: socketData.roomId,
            roomName: "Open space",
            isLogged: true,
            availabilityStatus: AvailabilityStatus.ONLINE,
            tags: ["member", "editor"],
            chatID: `@${socketData.spaceUserId}:matrix.play.test`,
            visitCardUrl: `https://play.test/visit-card/${socketData.spaceUserId}`,
            characterTextures: ["body", "eyes", "hair", "clothes", "hat", "accessory"].map((layer) => ({
                id: layer,
                url: `https://play.test/resources/customisation/character_${layer}/${layer}_0.png`,
            })),
        });
    }

    function createRoom(worldProperties: string[]) {
        const manager = new SocketManager();
        const spaces = (manager as unknown as { spaces: Map<string, SpaceInterface> }).spaces;
        const watchers = Array.from({ length: WORLD_WATCHERS }, (_, index) => createWatcher(index));

        const createSpace = (localName: string, propertiesToSync: string[], members: Watcher[]) => {
            const space = new Space(
                `world.${localName}`,
                localName,
                new EventProcessor(),
                FilterType.ALL_USERS,
                vi.fn(),
                mock<SpaceConnectionInterface>(),
                "world",
                propertiesToSync,
            );
            // The back sends every update it receives to all the pushers that hold the space, this one included.
            space.spaceStreamToBackPromise = Promise.resolve({
                closed: false,
                write: (message: PusherToBackSpaceMessage) => {
                    if (message.message?.$case === "updateSpaceUserMessage") {
                        space.dispatcher.handleMessage({
                            message: {
                                $case: "updateSpaceUserMessage",
                                updateSpaceUserMessage: message.message.updateSpaceUserMessage,
                            },
                        });
                    }
                },
            } as unknown as BackSpaceConnection);

            for (const member of members) {
                const spaceUser: SpaceUserExtended = {
                    ...userRecord(member),
                    lowercaseName: member.socketData.name.toLowerCase(),
                };
                const { spaceUserId } = member.socketData;
                member.socketData.spaces.add(space.name);
                space._localConnectedUserWithSpaceUser.set(member.socket, spaceUser);
                space._localConnectedUser.set(spaceUserId, member.socket);
                space.users.set(spaceUserId, spaceUser);
                space._localWatchers.add(spaceUserId);
            }

            spaces.set(space.name, space);
        };

        createSpace("allWorldUser", worldProperties, watchers);
        createSpace("proximity-bubble", BUBBLE_PROPERTIES, watchers.slice(0, BUBBLE_MEMBERS));

        return { manager, speaker: watchers[0], watchers };
    }

    // Sends one change as the speaker's browser would and counts what reaches the watchers of each space.
    async function sendChange(
        worldProperties: string[],
        change: { availabilityStatus?: AvailabilityStatus; showVoiceIndicator?: boolean },
    ) {
        const { manager, speaker, watchers } = createRoom(worldProperties);

        await manager.handleSetPlayerDetails(speaker.socket, SetPlayerDetailsMessage.fromPartial(change));
        await flushPromises();

        const updates = (spaceName: string) =>
            watchers.flatMap(({ received }) =>
                received.flatMap((subMessage) =>
                    subMessage.message?.$case === "updateSpaceUserMessage" &&
                    subMessage.message.updateSpaceUserMessage.spaceName === spaceName
                        ? [subMessage]
                        : [],
                ),
            );

        return { speaker, world: updates("allWorldUser"), bubble: updates("proximity-bubble") };
    }

    const encodedSize = (subMessage: SubMessage) => SubMessage.encode(subMessage).finish().length;

    // The size one watcher used to receive: the whole record of the user next to the mask.
    function wholeRecordBytes(spaceName: string, updateMask: string[], speaker: Watcher): number {
        const user = { ...userRecord(speaker), showVoiceIndicator: true };
        return SubMessage.encode({
            message: { $case: "updateSpaceUserMessage", updateSpaceUserMessage: { spaceName, user, updateMask } },
        }).finish().length;
    }

    it("does not send a talk-indicator change to the world user list, and keeps sending it to the bubble", async () => {
        const { speaker, world, bubble } = await sendChange(WORLD_PROPERTIES, { showVoiceIndicator: true });

        expect(world).toHaveLength(0);
        expect(bubble).toHaveLength(BUBBLE_MEMBERS);
        for (const subMessage of bubble) {
            if (subMessage.message?.$case !== "updateSpaceUserMessage") {
                throw new Error("Unexpected message");
            }
            expect(subMessage.message.updateSpaceUserMessage.updateMask).toEqual(["showVoiceIndicator"]);
            expect(subMessage.message.updateSpaceUserMessage.user?.spaceUserId).toBe(speaker.socketData.spaceUserId);
            expect(subMessage.message.updateSpaceUserMessage.user?.showVoiceIndicator).toBe(true);
        }
        // The avatar's talk icon travels with the room traffic, not through the spaces.
        expect(speaker.socketData.backConnection.write).toHaveBeenCalledWith({
            message: {
                $case: "setPlayerDetailsMessage",
                setPlayerDetailsMessage: expect.objectContaining({ showVoiceIndicator: true }),
            },
        });
    });

    it("keeps sending a talk-indicator change to a world-sized space that lists the field", async () => {
        const { world, bubble } = await sendChange([...WORLD_PROPERTIES, "showVoiceIndicator"], {
            showVoiceIndicator: true,
        });

        expect(world).toHaveLength(WORLD_WATCHERS);
        expect(bubble).toHaveLength(BUBBLE_MEMBERS);
    });

    it("keeps sending a status change to the world user list and to the bubble", async () => {
        const { world, bubble } = await sendChange(WORLD_PROPERTIES, { availabilityStatus: AvailabilityStatus.AWAY });

        expect(world).toHaveLength(WORLD_WATCHERS);
        expect(bubble).toHaveLength(BUBBLE_MEMBERS);
        for (const subMessage of [...world, ...bubble]) {
            if (subMessage.message?.$case !== "updateSpaceUserMessage") {
                throw new Error("Unexpected message");
            }
            expect(subMessage.message.updateSpaceUserMessage.updateMask).toEqual(["availabilityStatus"]);
            expect(subMessage.message.updateSpaceUserMessage.user?.availabilityStatus).toBe(AvailabilityStatus.AWAY);
        }
    });

    it("emits a fraction of the sub-messages and bytes for one talk-indicator change", async () => {
        // Before, every space of the speaker got the change and each update carried the whole record. A world space
        // that lists the field takes the first path again; the size of the whole record is encoded here as it was sent.
        const before = await sendChange([...WORLD_PROPERTIES, "showVoiceIndicator"], { showVoiceIndicator: true });
        const beforeCount = before.world.length + before.bubble.length;
        const beforeBytes =
            before.world.length * wholeRecordBytes("allWorldUser", ["showVoiceIndicator"], before.speaker) +
            before.bubble.length * wholeRecordBytes("proximity-bubble", ["showVoiceIndicator"], before.speaker);

        const after = await sendChange(WORLD_PROPERTIES, { showVoiceIndicator: true });
        const afterSizes = [...after.world, ...after.bubble].map(encodedSize);

        expect(beforeCount).toBe(WORLD_WATCHERS + BUBBLE_MEMBERS);
        expect(afterSizes).toHaveLength(BUBBLE_MEMBERS);
        // An update carries the changed flag and the id of the user, not their name and their textures.
        expect(Math.max(...afterSizes)).toBeLessThan(100);
        expect(afterSizes.reduce((total, size) => total + size, 0) * 10).toBeLessThan(beforeBytes);
    });
});
