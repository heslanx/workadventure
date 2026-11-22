// @vitest-environment jsdom
import { Subject } from "rxjs";
import { writable } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LivekitClient from "livekit-client";

const sentryMock = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/svelte", () => sentryMock);

const roomMock = vi.hoisted(() => ({ prepareConnection: vi.fn<() => Promise<unknown>>() }));
vi.mock("./LiveKitRoom", () => {
    class LiveKitRoomClosedBeforeConnectError extends Error {}
    class LiveKitRoom {
        prepareConnection = roomMock.prepareConnection;
        joinRoom = vi.fn().mockResolvedValue(undefined);
        dispatchStream = vi.fn();
        destroy = vi.fn();
        forceWebSocketClose = vi.fn();
    }
    return { LiveKitRoom, LiveKitRoomClosedBeforeConnectError };
});
vi.mock("../Stores/MediaStore", () => ({ streamingMegaphoneStore: { set: vi.fn() } }));

import type { SpaceInterface } from "../Space/SpaceInterface";
import { CommunicationMessageType } from "../Space/SpacePeerManager/CommunicationMessageType";
import { LivekitConnection } from "./LivekitConnection";
import { LiveKitRoomClosedBeforeConnectError } from "./LiveKitRoom";
import { LivekitClientLoadError, loadLivekitClient } from "./LivekitClientLoader";

describe("LivekitConnection, when a room cannot be prepared or joined", () => {
    let lk: typeof LivekitClient;
    let invitations: Subject<unknown>;
    let consoleError: ReturnType<typeof vi.spyOn>;
    let consoleWarn: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
        lk = await loadLivekitClient();
    });

    beforeEach(() => {
        invitations = new Subject();
        consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        sentryMock.captureException.mockClear();
        const space = {
            observePrivateEvent: (type: string) =>
                type === CommunicationMessageType.LIVEKIT_INVITATION_MESSAGE ? invitations : new Subject(),
        } as unknown as SpaceInterface;
        new LivekitConnection(space, {} as never, writable(new Set<string>()), writable(undefined), {
            set: vi.fn(),
        } as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function inviteAndFail(error: unknown): Promise<void> {
        roomMock.prepareConnection.mockRejectedValueOnce(error);
        invitations.next({ livekitInvitationMessage: { serverUrl: "wss://livekit.example.com", token: "token" } });
        // The rejection travels through the async function and its catch handler
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }

    it("ignores a room that was closed before it was created: the user left the space", async () => {
        await inviteAndFail(new LiveKitRoomClosedBeforeConnectError());

        expect(consoleError).not.toHaveBeenCalled();
        expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    it("ignores a failed load of livekit-client: the room already reported it and asks for a new invitation", async () => {
        await inviteAndFail(new LivekitClientLoadError(new Error("offline")));

        expect(consoleError).not.toHaveBeenCalled();
        expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    it("ignores the error livekit-client raises when the user leaves before the connection completes", async () => {
        await inviteAndFail(lk.ConnectionError.cancelled("Client initiated disconnect"));

        expect(consoleError).not.toHaveBeenCalled();
        expect(sentryMock.captureException).not.toHaveBeenCalled();
    });

    it.each([
        ["ServerUnreachable", () => lk.ConnectionError.serverUnreachable("cannot connect")],
        ["Timeout", () => lk.ConnectionError.timeout("cannot connect")],
    ])(
        "only warns when the server cannot be reached (%s): a new invitation is already requested",
        async (_reason, createError) => {
            await inviteAndFail(createError());

            expect(consoleWarn).toHaveBeenCalledOnce();
            expect(consoleError).not.toHaveBeenCalled();
            expect(sentryMock.captureException).not.toHaveBeenCalled();
        },
    );

    it("reports an unexpected error, including a connection error of another kind", async () => {
        const unexpected = new Error("boom");
        await inviteAndFail(unexpected);
        const notAllowed = lk.ConnectionError.notAllowed("not allowed", 403);
        await inviteAndFail(notAllowed);

        expect(sentryMock.captureException).toHaveBeenCalledTimes(2);
        expect(sentryMock.captureException).toHaveBeenNthCalledWith(1, unexpected);
        expect(sentryMock.captureException).toHaveBeenNthCalledWith(2, notAllowed);
        expect(consoleError).toHaveBeenCalledTimes(2);
    });
});
