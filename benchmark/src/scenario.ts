import { MAP_BOUNDS, type Position } from "./protocol";

/**
 * Where the bots go and who does what. Everything here is a pure function of the global bot index (the process-local
 * index plus --index-offset) and the step, so the same bot walks the same path in any process and a test can state the
 * expected points as literals.
 */

export const PATTERN_KINDS = ["ellipse", "plaza", "ring", "walk-stop"] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

/** How one bot moves. `step` counts the moves a bot has sent; step 0 is where it joins. */
export interface MotionPlan {
    /**
     * Number of steps after which the positions repeat exactly, or undefined when they never do. The move probe matches
     * an arrival to the latest step with the same position, so its look-back window must stay below this.
     */
    readonly periodSteps: number | undefined;
    positionAt(pathIndex: number, step: number): Position;
    /** False on the move that ends a walk: the bot stands still from there on. */
    movingAt(pathIndex: number, step: number): boolean;
    /** Move ticks the bot stays silent after sending `step`; a standing bot sends nothing. */
    pauseTicksAfter(pathIndex: number, step: number): number;
}

const GOLDEN_ANGLE = 2.399963229728653;
/** frac(i * (sqrt(5) - 1) / 2): a low-discrepancy sequence, so any run of consecutive indexes is evenly spread. */
const GOLDEN_FRACTION = 0.6180339887498949;

// Today's baseline path: a 736 x 545 px ellipse around (1056, 745), 0.05 rad per move, back at the start after 377.
const ELLIPSE = {
    centerX: 1056,
    centerY: 745,
    radiusX: 736,
    radiusY: 545,
    angleStep: 0.05,
    periodSteps: 377,
};

// A crowd around one point: a 300 px circle walked in 52 moves of about 36 px, the walking speed of the avatar.
const RING = { centerX: 1056, centerY: 745, radius: 300, periodSteps: 52 };

// The Plateia of the Konclui office: every bot walks a closed lap of it, on one of four lanes 16 px apart.
const PLAZA = {
    x: 192,
    y: 416,
    width: 416,
    height: 544,
    lanes: 4,
    laneInset: 16,
    periodSteps: 54,
};

// Stop and go over the whole floor: 12 moves to the next stop, then a pause of 5 to 30 ticks.
const WALK = {
    legSteps: 12,
    radius: 300,
    minOffset: 60,
    margin: 320,
    minPauseTicks: 5,
    pauseSpan: 26,
};

function ellipsePosition(pathIndex: number, step: number): Position {
    const angle = pathIndex * GOLDEN_ANGLE + step * ELLIPSE.angleStep;
    return {
        x: Math.round(ELLIPSE.centerX + ELLIPSE.radiusX * Math.sin(angle)),
        y: Math.round(ELLIPSE.centerY + ELLIPSE.radiusY * Math.cos(angle)),
    };
}

function ringPosition(pathIndex: number, step: number): Position {
    const angle = pathIndex * GOLDEN_ANGLE + (2 * Math.PI * (step % RING.periodSteps)) / RING.periodSteps;
    return {
        x: Math.round(RING.centerX + RING.radius * Math.sin(angle)),
        y: Math.round(RING.centerY + RING.radius * Math.cos(angle)),
    };
}

/** The point `arc` px along a closed rectangle walked clockwise from its top-left corner. */
function rectanglePoint(x: number, y: number, width: number, height: number, arc: number): Position {
    if (arc < width) {
        return { x: x + arc, y };
    }
    if (arc < width + height) {
        return { x: x + width, y: y + (arc - width) };
    }
    if (arc < 2 * width + height) {
        return { x: x + width - (arc - width - height), y: y + height };
    }
    return { x, y: y + height - (arc - 2 * width - height) };
}

function plazaPosition(pathIndex: number, step: number): Position {
    const inset = (pathIndex % PLAZA.lanes) * PLAZA.laneInset;
    const width = PLAZA.width - 2 * inset;
    const height = PLAZA.height - 2 * inset;
    const phase = fraction(pathIndex * GOLDEN_FRACTION) * PLAZA.periodSteps;
    const lapPosition = ((step % PLAZA.periodSteps) + phase) % PLAZA.periodSteps;
    const arc = (lapPosition / PLAZA.periodSteps) * 2 * (width + height);
    const point = rectanglePoint(PLAZA.x + inset, PLAZA.y + inset, width, height, arc);
    return { x: Math.round(point.x), y: Math.round(point.y) };
}

function fraction(value: number): number {
    return value - Math.floor(value);
}

/** A 32-bit integer mix of three numbers, as a number in [0, 1). Deterministic, not cryptographic. */
export function hash01(a: number, b: number, salt: number): number {
    let hash = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + salt, 0xc2b2ae35);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x2c1b3c6d);
    hash ^= hash >>> 12;
    hash = Math.imul(hash, 0x297a2d39);
    hash ^= hash >>> 15;
    return (hash >>> 0) / 4294967296;
}

/**
 * Stop number `stopIndex` of a bot: near its own home spot on the floor, so bots spread over the whole map. Stops lie
 * on alternating sides of home, at least 60 px from it, so two consecutive stops are at least 120 px apart and a leg
 * never rounds several moves onto one pixel.
 */
function walkStop(pathIndex: number, stopIndex: number): Position {
    const homeX = WALK.margin + hash01(pathIndex, 0, 1) * (MAP_BOUNDS.width - 2 * WALK.margin);
    const homeY = WALK.margin + hash01(pathIndex, 0, 2) * (MAP_BOUNDS.height - 2 * WALK.margin);
    const side = stopIndex % 2 === 0 ? 1 : -1;
    return {
        x: homeX + side * (WALK.minOffset + hash01(pathIndex, stopIndex + 1, 3) * (WALK.radius - WALK.minOffset)),
        y: homeY + (hash01(pathIndex, stopIndex + 1, 4) * 2 - 1) * WALK.radius,
    };
}

function walkStopPosition(pathIndex: number, step: number): Position {
    if (step <= 0) {
        const start = walkStop(pathIndex, 0);
        return { x: Math.round(start.x), y: Math.round(start.y) };
    }
    const leg = Math.floor((step - 1) / WALK.legSteps);
    const progress = (((step - 1) % WALK.legSteps) + 1) / WALK.legSteps;
    const from = walkStop(pathIndex, leg);
    const to = walkStop(pathIndex, leg + 1);
    return {
        x: Math.round(from.x + (to.x - from.x) * progress),
        y: Math.round(from.y + (to.y - from.y) * progress),
    };
}

function endsLeg(step: number): boolean {
    return step > 0 && (step - 1) % WALK.legSteps === WALK.legSteps - 1;
}

const ALWAYS_MOVING = {
    movingAt: () => true,
    pauseTicksAfter: () => 0,
};

export function motionFor(pattern: PatternKind): MotionPlan {
    switch (pattern) {
        case "ellipse":
            return {
                ...ALWAYS_MOVING,
                periodSteps: ELLIPSE.periodSteps,
                positionAt: ellipsePosition,
            };
        case "ring":
            return {
                ...ALWAYS_MOVING,
                periodSteps: RING.periodSteps,
                positionAt: ringPosition,
            };
        case "plaza":
            return {
                ...ALWAYS_MOVING,
                periodSteps: PLAZA.periodSteps,
                positionAt: plazaPosition,
            };
        case "walk-stop":
            return {
                periodSteps: undefined,
                positionAt: walkStopPosition,
                movingAt: (_pathIndex, step) => !endsLeg(step),
                pauseTicksAfter: (pathIndex, step) =>
                    endsLeg(step) ? WALK.minPauseTicks + Math.floor(hash01(pathIndex, step, 5) * WALK.pauseSpan) : 0,
            };
    }
}

/** Each role draws from its own irrational rotation, so who walks and who watches the roster are independent. */
export type Role = "walker" | "member" | "watcher";
const ROLE_ROTATION: Record<Role, number> = {
    walker: GOLDEN_FRACTION,
    member: 0.7320508075688772,
    watcher: 0.7320508075688772,
};

/**
 * Whether the bot with this global index has the role, for a population share of `share`. Over any run of consecutive
 * indexes the count of selected bots differs from share x length by less than two, whatever the offset. A watcher is
 * always a member when its share is not above the members' share, because both read the same rotation.
 */
export function hasRole(role: Role, pathIndex: number, share: number): boolean {
    if (share >= 1) {
        return true;
    }
    if (share <= 0) {
        return false;
    }
    return fraction(pathIndex * ROLE_ROTATION[role]) < share;
}
