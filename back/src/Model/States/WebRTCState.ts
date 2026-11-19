import type { SpaceUser } from "@workadventure/messages";
import { MAX_P2P_PEERS } from "../../Enum/EnvironmentVariable";
import { WebRTCCommunicationStrategy } from "../Strategies/WebRTCCommunicationStrategy";
import { CommunicationType } from "../Types/CommunicationTypes";
import type { ICommunicationSpace } from "../Interfaces/ICommunicationSpace";
import { CommunicationState } from "./AbstractCommunicationState";

export class WebRTCState extends CommunicationState<WebRTCCommunicationStrategy> {
    protected _communicationType: CommunicationType = CommunicationType.WEBRTC;
    protected _nextCommunicationType: CommunicationType = CommunicationType.LIVEKIT;

    constructor(
        protected readonly _space: ICommunicationSpace,
        users: ReadonlyMap<string, SpaceUser>,
        usersToNotify: ReadonlyMap<string, SpaceUser>,
        maxPeers: number | undefined = MAX_P2P_PEERS,
    ) {
        super(_space, new WebRTCCommunicationStrategy(_space, users, usersToNotify, maxPeers), users, usersToNotify);
    }
}
