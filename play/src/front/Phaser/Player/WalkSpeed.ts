import { WOKA_SPEED } from "../../Enum/EnvironmentVariable";

// How fast a player walks. No Phaser import here: code that runs without a canvas reads these too.

/** Pixels walked per second for each unit of walking speed. */
export const PIXELS_PER_SECOND_PER_SPEED_UNIT = 20;

/** The walking speed while the speed-up key is held. */
export const SPEED_UP_WALK_SPEED = WOKA_SPEED * 2.5;

/**
 * The fastest a player moves on its own, in pixels per second: sped up and on a diagonal. The keyboard moves both
 * axes at full speed, so a diagonal covers the square root of two times the distance of a straight walk.
 */
export const MAX_WALK_SPEED_PX_PER_SECOND = SPEED_UP_WALK_SPEED * PIXELS_PER_SECOND_PER_SPEED_UNIT * Math.SQRT2;
