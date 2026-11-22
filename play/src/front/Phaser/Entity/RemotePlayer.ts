import * as Sentry from "@sentry/svelte";
import * as Phaser from "phaser";
import { get } from "svelte/store";
import type { CancelablePromise } from "cancelable-promise";
import {
    AskPositionMessage_AskType,
    type PositionMessage,
    type PositionMessage_Direction,
    type SayMessage,
} from "@workadventure/messages";
import type { WokaMenuAction } from "../../Stores/WokaMenuStore";
import { wokaMenuStore } from "../../Stores/WokaMenuStore";
import { Character } from "../Entity/Character";
import type { AvatarBuildQueue } from "../Entity/AvatarBuildQueue";
import { acquireAvatarBake } from "../Entity/AvatarBakeCache";
import type { BakeLease } from "../Entity/AvatarBakeRegistry";
import { isAvatarZeroWorkEnabled } from "../Entity/AvatarZeroWork";
import type { GameScene } from "../Game/GameScene";
import { WOKA_SPEED } from "../../Enum/EnvironmentVariable";
import type { ActivatableInterface } from "../Game/ActivatableInterface";
import type { AvatarDetailLevel } from "../Game/AvatarDetail";
import { LL } from "../../../i18n/i18n-svelte";
import { blackListManager } from "../../WebRtc/BlackListManager";
import { openModerationModal } from "../../Components/Moderation/openModerationModal";
import { iframeListener } from "../../Api/IframeListener";
import banIcon from "../../Components/images/ban-icon.svg";
import { openDirectChatRoom } from "../../Chat/Utils";
import chat from "../../Components/images/chat.png";
import { userIsConnected } from "../../Stores/MenuStore";
import RequiresLoginForChatModal from "../../Chat/Components/RequiresLoginForChatModal.svelte";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { IconCamera, IconUserPlus } from "@wa-icons";
import { modals } from "@wa-modals";

/**
 * Class representing the sprite of a remote player (a player that plays on another computer)
 *
 * With an `avatarBuildQueue`, the player exists at once (it has a position and the scene can find it) but its sprites,
 * name and companion are created when the queue gets to it.
 */
/** How many turns of the build queue a restore of the sprites gets before it waits for the next promotion. */
const MAX_RESTORE_ATTEMPTS = 3;

export class RemotePlayer extends Character implements ActivatableInterface {
    public readonly userId: number;
    public readonly userUuid: string;
    public readonly activationRadius: number;

    private visitCardUrl: string | null;
    private culled = false;
    private dot = false;
    // See AvatarZeroWork: read once, so that a player is in one mode for its whole life.
    private readonly zeroWork = isAvatarZeroWorkEnabled();
    private bakeLease: BakeLease | undefined;
    // Whether a restore of the sprites of a dot that is promoted waits in the build queue. The queue has one slot per
    // avatar, and the same slot can hold the first build (name, companion, sprites), which a dot must not lose.
    private restoreQueued = false;
    private restoreAttempts = 0;
    private pathFollowingUpdateCallback: (time: number, delta: number) => void;

    constructor(
        userId: number,
        userUuid: string,
        Scene: GameScene,
        x: number,
        y: number,
        name: string,
        texturesPromise: CancelablePromise<string[]>,
        direction: PositionMessage_Direction,
        moving: boolean,
        visitCardUrl: string | null,
        companionTexturePromise: CancelablePromise<string> | undefined,
        activationRadius?: number,
        private chatID: string | undefined = undefined,
        sayMessage?: SayMessage,
        private readonly avatarBuildQueue?: AvatarBuildQueue,
    ) {
        super(Scene, x, y, texturesPromise, name, direction, moving, 1, true, companionTexturePromise);

        //set data
        this.userId = userId;
        this.userUuid = userUuid;
        this.visitCardUrl = visitCardUrl;
        this.setClickable(this.getDefaultWokaMenuActions().length > 0);
        this.activationRadius = activationRadius ?? 76;

        if (sayMessage) {
            this.say(sayMessage.message, sayMessage.type);
        }

        this.pathFollowingUpdateCallback = (_time: number, delta: number) => this.followPath(delta);
    }

    protected requestBuildTurn(grant: () => void): void {
        // What a dot builds (sprites, name, companion) is hidden in the call that builds it.
        const build = () => {
            grant();
            if (this.dot || this.isZeroWorkCulled()) {
                this.applyDetail();
            }
        };
        if (this.avatarBuildQueue === undefined) {
            build();
            return;
        }
        this.avatarBuildQueue.enqueue(this, build);
    }

    /**
     * Tells the player that it is out of the camera view and not drawn (`true`), or drawn again (`false`): see
     * RemotePlayerCulling, which hides the sprites and the companion itself.
     *
     * The name is a DOM element that Phaser's visibility does not reach, so the player hides it here. A culled player's
     * moves then leave nothing to draw, which is what lets the scene skip the frame they would ask for.
     */
    public setCulled(culled: boolean): void {
        const wasCulled = this.culled;
        this.culled = culled;
        this.applyDetail();
        if (wasCulled && !culled && this.zeroWork) {
            // The moves made while culled were remembered, not played.
            this.replayAnimation();
        }
    }

    public isCulled(): boolean {
        return this.culled;
    }

    /**
     * Draws the player in full, or as a dot that AvatarDotLayer draws in its place: then its sprites, name and companion
     * are hidden and not animated, and its companion does not move. A culled player stays culled whatever its detail; drawn again, it shows its detail.
     */
    public setDetail(detail: AvatarDetailLevel): void {
        const dot = detail === "dot";
        if (dot === this.dot) {
            return;
        }
        this.dot = dot;
        this.applyDetail();
        if (dot) {
            if (this.zeroWork) {
                // A dot holds no sprites. One that waits for its restore has nothing to restore any more. Only that
                // restore is taken out of the queue: the slot may hold the first build, which still has to run.
                if (this.restoreQueued) {
                    this.restoreQueued = false;
                    this.avatarBuildQueue?.remove(this);
                }
                this.restoreAttempts = 0;
                this.dropSprites();
            }
            return;
        }
        if (this.hasDroppedSprites()) {
            // The sprites come back in a turn of the build queue, as the first ones did: a crowd promoted at once
            // (the player crosses the map) is spread over frames instead of built in one.
            this.restoreAttempts = 0;
            this.requestRestore();
            return;
        }
        // The moves made as a dot were remembered, not played.
        this.replayAnimation();
    }

    private requestRestore(): void {
        this.restoreQueued = true;
        this.requestBuildTurn(() => {
            this.restoreQueued = false;
            this.restoreDroppedSprites();
        });
    }

    private restoreDroppedSprites(): void {
        if (this.dot || !this.hasDroppedSprites()) {
            return;
        }
        if (this.restoreSprites()) {
            this.restoreAttempts = 0;
            this.applyDetail();
            return;
        }
        // The failure is reported by restoreSprites(). A few more turns, then it waits for the next promotion: a
        // build that keeps failing must not take a slot of the queue every frame for good.
        this.restoreAttempts += 1;
        if (this.restoreAttempts < MAX_RESTORE_ATTEMPTS) {
            this.requestRestore();
            return;
        }
        console.error(`Gave up building the sprites of player ${this.userId} after ${this.restoreAttempts} tries`);
    }

    public getDetail(): AvatarDetailLevel {
        return this.dot ? "dot" : "full";
    }

    protected isAnimated(): boolean {
        return !this.dot && !this.isZeroWorkCulled();
    }

    protected holdsSprites(): boolean {
        return !(this.zeroWork && this.dot);
    }

    protected resolveTextures(layers: string[]): string[] {
        const lease = acquireAvatarBake(this.scene, layers);
        if (lease === undefined) {
            return layers;
        }
        this.bakeLease = lease;
        return [lease.key];
    }

    protected releaseTextures(): void {
        this.bakeLease?.release();
        this.bakeLease = undefined;
    }

    protected discardTextures(error: unknown): void {
        // The registry reports it once for the recipe and keeps the next avatars of it on their layers.
        this.bakeLease?.discard(error);
        this.bakeLease = undefined;
    }

    // The companion has an arcade body of its own, which is stepped every frame like the player's.
    private setCompanionBodyEnabled(enabled: boolean): void {
        const companion = this.companion;
        const body = companion?.body;
        if (companion === undefined || !(body instanceof Phaser.Physics.Arcade.Body) || body.enable === enabled) {
            return;
        }
        if (enabled) {
            this.scene.physics.world.enableBody(companion);
        } else {
            this.scene.physics.world.disableBody(body);
        }
    }

    private isZeroWorkCulled(): boolean {
        return this.zeroWork && this.culled;
    }

    private applyDetail(): void {
        this.setNameHidden(this.culled || this.dot);
        // The companion follows the detail whether or not it is culled: a dot's companion neither moves nor animates.
        this.companion?.setSuspended(this.dot || this.isZeroWorkCulled());
        if (this.zeroWork) {
            const idle = this.dot || this.culled;
            this.setFrameWorkSuspended(idle);
            this.setCompanionBodyEnabled(!idle);
        }
        if (this.culled) {
            // The culling hid everything that existed when it ran. Sprites built since (a restore, a first build)
            // are active, and would be advanced every frame for nobody.
            if (this.zeroWork) {
                this.deactivateSprites();
            }
            return;
        }
        const drawn = !this.dot;
        this.setVisible(drawn);
        this.setActive(drawn);
        for (const sprite of this.sprites.values()) {
            sprite.setActive(drawn);
        }
        this.companion?.setVisible(drawn);
        this.companion?.setActive(drawn);
        for (const sprite of this.companion?.sprites.values() ?? []) {
            sprite.setActive(drawn);
        }
    }

    private deactivateSprites(): void {
        for (const sprite of this.sprites.values()) {
            sprite.setActive(false);
        }
        for (const sprite of this.companion?.sprites.values() ?? []) {
            sprite.setActive(false);
        }
    }

    public updatePosition(position: PositionMessage): void {
        this.stopMoveTo();
        // A dot only remembers the pose (see isAnimated()); its suspended companion only remembers the target.
        this.playAnimation(position.direction, position.moving);
        this.setPosition(position.x, position.y);

        if (this.companion) {
            this.companion.setTarget(position.x, position.y, position.direction);
        }
    }

    /**
     * Move to a position using pathfinding (same logic as GameScene.moveTo).
     * Uses the PathfindingManager to find a path and follows it with proper walking animation.
     * Named moveToPosition to avoid conflict with Phaser Container.moveTo.
     * @param position Target position in game pixels
     * @param tryFindingNearestAvailable If true, finds nearest available tile when exact target is blocked
     * @param speed Walking speed (default: WOKA_SPEED)
     * @returns Promise that resolves with final position and whether the move was cancelled
     */
    public async moveToPosition(
        position: { x: number; y: number },
        tryFindingNearestAvailable = false,
        speed: number | undefined = undefined,
    ): Promise<{ x: number; y: number; cancelled: boolean }> {
        this.stopMoveTo();

        const gameScene = this.scene;
        const path = await gameScene
            .getPathfindingManager()
            .findPathFromGameCoordinates({ x: this.x, y: this.y }, position, tryFindingNearestAvailable);

        if (path.length === 0) {
            throw new Error("No path found");
        }

        const pathFollowingPromise = this.setPathToFollow(path, speed ?? WOKA_SPEED);
        this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.pathFollowingUpdateCallback);
        return pathFollowingPromise;
    }

    /**
     * Stop any ongoing moveTo.
     */
    public stopMoveTo(): void {
        if (this.isFollowingPath()) {
            this.finishFollowingPath(true);
        }
    }

    public finishFollowingPath(cancelled = false, blocked = false): void {
        super.finishFollowingPath(cancelled, blocked);
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.pathFollowingUpdateCallback);
        this.scene.markDirty();
    }

    public getVisitCardUrl(): string | null {
        return this.visitCardUrl;
    }

    public setChatID(chatID: string | undefined): void {
        this.chatID = chatID;
        this.setClickable(this.getDefaultWokaMenuActions().length > 0);
    }

    public registerWokaMenuAction(action: WokaMenuAction): void {
        wokaMenuStore.addAction({
            ...action,
            priority: action.priority ?? 0,
            callback: () => {
                action.callback();
                wokaMenuStore.removeRemotePlayer(this.userUuid);
            },
        });
    }

    public unregisterWokaMenuAction(actionName: string) {
        wokaMenuStore.removeAction(actionName);
    }

    public activate(): void {
        this.toggleActionsMenu();
    }

    public deactivate(): void {
        wokaMenuStore.removeRemotePlayer(this.userUuid);
    }

    public destroy(): void {
        this.avatarBuildQueue?.remove(this);
        this.stopMoveTo();
        wokaMenuStore.removeRemotePlayer(this.userUuid);
        super.destroy();
    }

    public isActivatable(): boolean {
        return this.isClickable();
    }

    private toggleActionsMenu(): void {
        // Track the open woka menu action
        analyticsClient.trackAdminEvent("user.woka_menu.opened");

        // Close the woka menu if it is already open by the same remote player
        const wokaMenuStoreValue = get(wokaMenuStore);
        if (
            wokaMenuStoreValue?.userUuid !== undefined &&
            wokaMenuStoreValue.userUuid !== "" &&
            wokaMenuStoreValue.userUuid === this.userUuid
        ) {
            wokaMenuStore.removeRemotePlayer(this.userUuid);
            return;
        }

        // Initialize the woka menu
        wokaMenuStore.initialize(this.playerName, this.userId, this.userUuid, this.visitCardUrl ?? undefined);

        // Add the default actions to the woka menu
        for (const action of this.getDefaultWokaMenuActions()) {
            wokaMenuStore.addAction(action);
        }

        // Send the remote player clicked event to the iframe listener
        const userFound = this.scene.getRemotePlayersRepository().getPlayers().get(this.userId);
        if (!userFound) {
            console.error("Undefined clicked player!");
            return;
        }

        // Send the remote player clicked event to the iframe listener
        iframeListener.sendRemotePlayerClickedEvent(userFound);
    }

    private getDefaultWokaMenuActions(): WokaMenuAction[] {
        const actions: WokaMenuAction[] = [];
        actions.push({
            actionName: get(LL).report.moderate.action(),
            protected: true,
            priority: -1,
            style: "is-error bg-white/10 hover:bg-pop-red/20 [&_.btn-label]:text-pop-red-text",
            testId: "wokamenu-block-user-button",
            callback: () => {
                // Track the report user action
                analyticsClient.trackAdminEvent("user.report.clicked");

                openModerationModal(this.userUuid, this.playerName);
            },
            actionIcon: banIcon,
        });
        if (!blackListManager.isBlackListed(this.userUuid)) {
            actions.push({
                actionName: get(LL).chat.userList.TalkTo(),
                protected: false,
                priority: 1,
                style: "bg-white/10 hover:bg-white/30",
                callback: () => {
                    // Track the talk to user action
                    analyticsClient.trackAdminEvent("user.go_to_clicked");

                    if (this.scene.connection != undefined)
                        this.scene.connection.emitAskPosition(
                            this.userUuid,
                            this.scene.roomUrl,
                            AskPositionMessage_AskType.MOVE,
                            this.userId,
                        );
                },
                actionIcon: IconCamera,
            });
        }
        if (this.chatID != undefined) {
            actions.push({
                actionName: get(LL).chat.userList.sendMessage(),
                protected: false,
                priority: 2,
                style: "bg-white/10 hover:bg-white/30",
                callback: () => {
                    // Track the opened chat action
                    analyticsClient.trackAdminEvent("chat.opened");

                    if (!get(userIsConnected)) {
                        modals.open(RequiresLoginForChatModal);
                        return;
                    }

                    openDirectChatRoom(this.chatID!, this.playerName).catch((error) => {
                        console.error("Error opening direct chat room:", error);
                        Sentry.captureException(error, {
                            extra: {
                                userId: this.userUuid,
                                chatId: this.chatID!,
                                playUri: this.scene.roomUrl,
                                username: this.playerName,
                            },
                        });
                    });
                },
                actionIcon: chat,
            });
        }
        // Add new action invite user to meet me
        actions.push({
            actionName: get(LL).chat.userList.invite(),
            protected: false,
            priority: 3,
            style: "bg-white/10 hover:bg-white/30",
            callback: () => {
                const sent = this.scene.inviteManager?.requestMeetingInvitation(this.userUuid, this.userId);
                if (sent) {
                    try {
                        this.scene.playSound("meeting-in", 0.15);
                    } catch (error) {
                        Sentry.captureException(error);
                    }
                }
            },
            actionIcon: IconUserPlus,
        });

        return actions;
    }
}
