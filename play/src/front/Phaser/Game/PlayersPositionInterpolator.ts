/**
 * This class is in charge of computing the position of all players.
 * Player movement is delayed by 200ms so position depends on ticks.
 */
import type { HasPlayerMovedInterface } from "../../Api/Events/HasPlayerMovedInterface";
import type { PositionInterface } from "../../Connection/ConnexionModels";
import { PlayerMovement } from "./PlayerMovement";
import { RemoteSampleIntervals } from "./RemoteSampleInterval";

export class PlayersPositionInterpolator {
    playerMovements: Map<number, PlayerMovement> = new Map<number, PlayerMovement>();
    private readonly sampleIntervals = new RemoteSampleIntervals();

    updatePlayerPosition(userId: number, playerMovement: PlayerMovement): void {
        this.playerMovements.set(userId, playerMovement);
    }

    /**
     * Draws a sample received at `tick` from `current`, over the interval the player's samples are observed to arrive
     * at. A teleport is not drawn as a glide.
     */
    receiveSample(userId: number, current: PositionInterface, tick: number, sample: HasPlayerMovedInterface): void {
        const { duration, snap } = this.sampleIntervals.observe(userId, tick, sample);
        const start = snap ? { x: sample.x, y: sample.y } : current;
        this.updatePlayerPosition(userId, new PlayerMovement(start, tick, sample, tick + duration));
    }

    removePlayer(userId: number): void {
        this.playerMovements.delete(userId);
        this.sampleIntervals.forget(userId);
    }

    getUpdatedPositions(tick: number): Map<number, HasPlayerMovedInterface> {
        const positions = new Map<number, HasPlayerMovedInterface>();
        this.playerMovements.forEach((playerMovement: PlayerMovement, userId: number) => {
            if (playerMovement.isOutdated(tick)) {
                this.playerMovements.delete(userId);
            }
            positions.set(userId, playerMovement.getPosition(tick));
        });
        return positions;
    }
}
