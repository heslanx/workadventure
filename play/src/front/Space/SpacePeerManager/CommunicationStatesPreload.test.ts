import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceInterface } from "../SpaceInterface";
import type { StreamableSubjects } from "./SpacePeerManager";

const preloadLivekitClient = vi.hoisted(() => vi.fn());
vi.mock("../../Livekit/LivekitClientLoader", () => ({ preloadLivekitClient }));
vi.mock("../../WebRtc/SimplePeer", () => ({ SimplePeer: vi.fn() }));
vi.mock("../../Livekit/LivekitConnection", () => ({
    LivekitConnection: vi.fn(),
    CommunicationType: { NONE: "NONE", WEBRTC: "WEBRTC", LIVEKIT: "LIVEKIT" },
}));
vi.mock("../../Stores/MediaStore", () => ({}));

import { LivekitState } from "./LivekitState";
import { WebRTCState } from "./WebRTCState";

function usersOf(count: number): Map<string, unknown> {
    return new Map(Array.from({ length: count }, (_, index) => [`user-${index}`, {}]));
}

const noSubjects = {} as StreamableSubjects;

describe("preloading livekit-client from the communication states", () => {
    beforeEach(() => {
        preloadLivekitClient.mockClear();
    });

    it("starts the fetch when a WebRTC bubble reaches three people, and stops once the state is destroyed", () => {
        const usersStore = writable(usersOf(2));
        const peer = { destroy: vi.fn() };
        const state = new WebRTCState(
            { usersStore } as unknown as SpaceInterface,
            noSubjects,
            writable(new Set<string>()),
            writable(undefined),
            { create: () => peer } as never,
        );
        expect(preloadLivekitClient).not.toHaveBeenCalled();

        usersStore.set(usersOf(3));
        expect(preloadLivekitClient).toHaveBeenCalledOnce();

        state.destroy();
        expect(peer.destroy).toHaveBeenCalledOnce();
    });

    it("does not start the fetch for a WebRTC bubble destroyed before it grew", () => {
        const usersStore = writable(usersOf(2));
        const state = new WebRTCState(
            { usersStore } as unknown as SpaceInterface,
            noSubjects,
            writable(new Set<string>()),
            writable(undefined),
            { create: () => ({ destroy: vi.fn() }) } as never,
        );

        state.destroy();
        usersStore.set(usersOf(4));

        expect(preloadLivekitClient).not.toHaveBeenCalled();
    });

    it("starts the fetch as soon as a space is switched to LiveKit", () => {
        new LivekitState({} as SpaceInterface, noSubjects, writable(new Set<string>()), writable(undefined));

        expect(preloadLivekitClient).toHaveBeenCalledOnce();
    });
});
