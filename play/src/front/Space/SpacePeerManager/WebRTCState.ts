import type { Readable, Unsubscriber } from "svelte/store";
import { SimplePeer } from "../../WebRtc/SimplePeer";
import type { SpaceInterface } from "../SpaceInterface";
import type { LocalStreamStoreValue } from "../../Stores/MediaStore";
import type {
    SimplePeerConnectionInterface,
    PeerFactoryInterface,
    ICommunicationState,
    StreamableSubjects,
} from "./SpacePeerManager";
import { watchSpaceSizeForLivekitPreload } from "./LivekitPreload";

export const defaultPeerFactory: PeerFactoryInterface = {
    create: (
        _space: SpaceInterface,
        _streamableSubjects: StreamableSubjects,
        _blockedUsersStore: Readable<Set<string>>,
        _screenSharingLocalStreamStore: Readable<LocalStreamStoreValue | undefined>,
    ) => {
        const peer = new SimplePeer(_space, _streamableSubjects, _blockedUsersStore, _screenSharingLocalStreamStore);
        return peer;
    },
};

export class WebRTCState implements ICommunicationState {
    private readonly _peer: SimplePeerConnectionInterface;
    private readonly _stopLivekitPreload: Unsubscriber;

    constructor(
        private _space: SpaceInterface,
        private _streamableSubjects: StreamableSubjects,
        _blockedUsersStore: Readable<Set<string>>,
        _screenSharingLocalStreamStore: Readable<LocalStreamStoreValue | undefined>,
        private _peerFactory: PeerFactoryInterface = defaultPeerFactory,
    ) {
        this._peer = this._peerFactory.create(
            this._space,
            this._streamableSubjects,
            _blockedUsersStore,
            _screenSharingLocalStreamStore,
        );
        // A bubble that grows past what peer-to-peer carries moves to LiveKit: have the library by then
        this._stopLivekitPreload = watchSpaceSizeForLivekitPreload(this._space.usersStore);
    }

    destroy() {
        this._stopLivekitPreload();
        this._peer.destroy();
    }

    getPeer(): SimplePeerConnectionInterface | undefined {
        return this._peer;
    }

    shouldSynchronizeMediaState(): boolean {
        return true;
    }

    dispatchStream(mediaStream: MediaStream): void {
        this._peer.dispatchStream(mediaStream);
    }

    blockRemoteUser(userId: string): void {
        this._peer.blockedFromRemotePlayer(userId);
    }

    /**
     * Starts the shutdown process of the communication state. It does not remove all video peers immediately,
     * but any asynchronous operation receiving a new stream should be ignored after this call.
     */
    shutdown(): void {
        this._peer.shutdown();
    }

    retryAllFailedConnections(): void {
        this._peer.retryAllFailedConnections();
    }
}
