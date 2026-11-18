import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterType, SpaceUser } from "@workadventure/messages";
import { emptySpaceState } from "@workadventure/shared-utils";
import { LivekitCommunicationStrategy } from "../src/Model/Strategies/LivekitCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

const GRACE_PERIOD_MS = 30_000;

type Filter = ICommunicationSpace["filterType"];

function createUser(spaceUserId: string): SpaceUser {
    return SpaceUser.fromPartial({
        spaceUserId,
        uuid: `uuid-${spaceUserId}`,
        name: spaceUserId,
    });
}

describe("LivekitCommunicationStrategy", () => {
    it("stops recording through the server path when the last streaming user leaves", async () => {
        const dispatchPrivateEvent = vi.fn();
        const stopRecordingByServer = vi.fn().mockResolvedValue(undefined);

        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: true, recorder: "recorder-1", status: "recording" }),
            dispatchPrivateEvent,
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            updateState: vi.fn(),
            stopRecordingByServer,
            getUser: vi.fn(),
            world: "world",
            getState: () => emptySpaceState(),
            filterType: FilterType.ALL_USERS,
        };

        const livekitService = {
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const streamer = createUser("streamer-1");
        const receiver = createUser("listener-1");

        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
                receivingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(streamer.spaceUserId, streamer);
        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
                receivingUsers: Map<string, SpaceUser>;
            }
        ).receivingUsers.set(receiver.spaceUserId, receiver);

        strategy.deleteUser(streamer);

        await vi.waitFor(() => {
            expect(stopRecordingByServer).toHaveBeenCalled();
            expect(livekitService.deleteRoom).toHaveBeenCalledWith("test-space");
        });
    });

    it("keeps recording running while another streaming user remains", async () => {
        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: true, recorder: "recorder-1", status: "recording" }),
            dispatchPrivateEvent: vi.fn(),
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            updateState: vi.fn(),
            stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
            getUser: vi.fn(),
            world: "world",
            getState: () => emptySpaceState(),
            filterType: FilterType.ALL_USERS,
        };

        const livekitService = {
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const firstStreamer = createUser("streamer-1");
        const secondStreamer = createUser("streamer-2");

        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(firstStreamer.spaceUserId, firstStreamer);
        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(secondStreamer.spaceUserId, secondStreamer);

        strategy.deleteUser(firstStreamer);

        await vi.waitFor(() => {
            expect(
                (
                    strategy as unknown as {
                        streamingUsers: Map<string, SpaceUser>;
                    }
                ).streamingUsers.has(secondStreamer.spaceUserId),
            ).toBe(true);
        });

        expect(space.stopRecordingByServer).not.toHaveBeenCalled();
        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
    });
});

describe("LivekitCommunicationStrategy room grace period", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function createBroadcast(filterType: Filter = FilterType.LIVE_STREAMING_USERS) {
        const dispatchPrivateEvent = vi.fn<ICommunicationSpace["dispatchPrivateEvent"]>();
        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: false, recorder: null, status: "idle" }),
            dispatchPrivateEvent,
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "megaphone",
            getPropertiesToSync: () => [],
            updateState: vi.fn(),
            stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
            getUser: vi.fn(),
            world: "world",
            getState: () => emptySpaceState(),
            filterType,
        };
        const livekitService = {
            createRoom: vi.fn().mockResolvedValue(undefined),
            deleteRoom: vi.fn().mockResolvedValue(undefined),
            generateToken: vi.fn().mockResolvedValue("token"),
            getLivekitFrontendUrl: () => "wss://livekit.example",
        };
        const strategy = new LivekitCommunicationStrategy(space, livekitService as never, GRACE_PERIOD_MS);

        /** What the given user was sent, in order: "invitation" or "disconnect". */
        const messagesTo = (spaceUserId: string): string[] =>
            dispatchPrivateEvent.mock.calls
                .map(([privateEvent]) => privateEvent)
                .filter((privateEvent) => privateEvent.receiverUserId === spaceUserId)
                .map((privateEvent) =>
                    privateEvent.spaceEvent?.event?.$case === "livekitInvitationMessage" ? "invitation" : "disconnect",
                );

        // The tokens and the queued operations settle on microtasks and the room close on a timer
        const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

        return { strategy, livekitService, space, messagesTo, settle };
    }

    it("invites every listener when the first speaker starts", async () => {
        const { strategy, messagesTo, settle } = createBroadcast();
        await strategy.addUserToNotify(createUser("listener-1"));
        await strategy.addUserToNotify(createUser("listener-2"));

        await strategy.addUser(createUser("speaker-1"));
        await settle();

        expect(messagesTo("listener-1")).toEqual(["invitation"]);
        expect(messagesTo("listener-2")).toEqual(["invitation"]);
        expect(messagesTo("speaker-1")).toEqual(["invitation"]);
    });

    it("keeps the room and its listeners after the last speaker left, until the grace period ends", async () => {
        const { strategy, livekitService, messagesTo, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        await strategy.addUserToNotify(createUser("listener-1"));
        await strategy.addUser(speaker);

        strategy.deleteUser(speaker);
        await settle(GRACE_PERIOD_MS - 1);

        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
        expect(messagesTo("listener-1")).toEqual(["invitation"]);

        await settle(1);

        expect(livekitService.deleteRoom).toHaveBeenCalledExactlyOnceWith("megaphone");
        expect(messagesTo("listener-1")).toEqual(["invitation", "disconnect"]);
    });

    it("does not invite the listeners again when a speaker starts within the grace period", async () => {
        const { strategy, livekitService, messagesTo, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        await strategy.addUserToNotify(createUser("listener-1"));
        await strategy.addUser(speaker);
        strategy.deleteUser(speaker);
        await settle(GRACE_PERIOD_MS / 2);

        await strategy.addUser(createUser("speaker-2"));
        await settle(GRACE_PERIOD_MS * 2);

        expect(messagesTo("listener-1")).toEqual(["invitation"]);
        expect(messagesTo("speaker-2")).toEqual(["invitation"]);
        expect(livekitService.createRoom).toHaveBeenCalledTimes(1);
        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
    });

    it("lets a listener become the speaker within the grace period without a new invitation", async () => {
        const { strategy, livekitService, messagesTo, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        const promoted = createUser("listener-1");
        await strategy.addUserToNotify(promoted);
        await strategy.addUser(speaker);
        strategy.deleteUser(speaker);
        await settle(GRACE_PERIOD_MS / 2);

        await strategy.addUser(promoted);
        await settle(GRACE_PERIOD_MS * 2);

        // Still connected with the token it got at the first session
        expect(messagesTo("listener-1")).toEqual(["invitation"]);
        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
    });

    it("invites the listeners again when a speaker starts after the room was closed", async () => {
        const { strategy, livekitService, messagesTo, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        await strategy.addUserToNotify(createUser("listener-1"));
        await strategy.addUser(speaker);
        strategy.deleteUser(speaker);
        await settle(GRACE_PERIOD_MS);

        await strategy.addUser(createUser("speaker-2"));
        await settle();

        expect(livekitService.createRoom).toHaveBeenCalledTimes(2);
        expect(messagesTo("listener-1")).toEqual(["invitation", "disconnect", "invitation"]);
    });

    it("closes the room of a broadcast without listeners as soon as the speaker left", async () => {
        const { strategy, livekitService, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        await strategy.addUser(speaker);

        strategy.deleteUser(speaker);
        await settle();

        expect(livekitService.deleteRoom).toHaveBeenCalledExactlyOnceWith("megaphone");
    });

    it("closes the room of a meeting as soon as the last member left, whoever is watching", async () => {
        const { strategy, livekitService, settle } = createBroadcast(FilterType.ALL_USERS);
        const member = createUser("member-1");
        await strategy.addUserToNotify(createUser("watcher-1"));
        await strategy.addUser(member);

        strategy.deleteUser(member);
        await settle();

        expect(livekitService.deleteRoom).toHaveBeenCalledExactlyOnceWith("megaphone");
    });

    it("stops the recording as soon as the last speaker left, not after the grace period", async () => {
        const { strategy, space, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        await strategy.addUserToNotify(createUser("listener-1"));
        await strategy.addUser(speaker);

        strategy.deleteUser(speaker);
        await settle();

        expect(space.stopRecordingByServer).toHaveBeenCalledTimes(1);
    });

    it("creates the room again when a speaker restarts within the grace period after the room failed to be created", async () => {
        const { strategy, livekitService, messagesTo, settle } = createBroadcast();
        livekitService.createRoom.mockRejectedValueOnce(new Error("livekit down"));
        const speaker = createUser("speaker-1");
        await strategy.addUserToNotify(createUser("listener-1"));
        await expect(strategy.addUser(speaker)).rejects.toThrow("livekit down");
        strategy.deleteUser(speaker);
        await settle(1_000);

        await strategy.addUser(speaker);
        await settle();

        expect(livekitService.createRoom).toHaveBeenCalledTimes(2);
        expect(messagesTo("listener-1").at(-1)).toBe("invitation");
        expect(messagesTo("speaker-1").at(-1)).toBe("invitation");
    });

    it("invites the listeners at the first session even if a user who never spoke was removed before", async () => {
        const { strategy, messagesTo, settle } = createBroadcast();
        await strategy.addUserToNotify(createUser("listener-1"));
        strategy.deleteUser(createUser("never-spoke"));
        await settle(1_000);

        await strategy.addUser(createUser("speaker-1"));
        await settle();

        expect(messagesTo("listener-1").at(-1)).toBe("invitation");
    });

    it("deletes the kept room right away on cleanup", async () => {
        const { strategy, livekitService, settle } = createBroadcast();
        const speaker = createUser("speaker-1");
        await strategy.addUserToNotify(createUser("listener-1"));
        await strategy.addUser(speaker);
        strategy.deleteUser(speaker);
        await settle(GRACE_PERIOD_MS / 2);

        strategy.cleanup();
        await settle();

        expect(livekitService.deleteRoom).toHaveBeenCalledTimes(1);

        await settle(GRACE_PERIOD_MS * 2);

        expect(livekitService.deleteRoom).toHaveBeenCalledTimes(1);
    });
});
