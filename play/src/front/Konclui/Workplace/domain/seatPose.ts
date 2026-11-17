/**
 * The anti-corruption layer for the public `officeSeat` player variable, which the map script publishes and
 * which reaches this client from every other player as free-form JSON.
 *
 * The checks are written by hand, not as a schema: a field that is out of range falls back to its default
 * while the rest of the pose is kept, and the scene parses the variable of every character it draws.
 */

type SeatDirection = "up" | "down" | "left" | "right";

export interface SeatPose {
    direction: SeatDirection;
    crop: number;
    dy: number;
    front?: { source: string; x: number; y: number };
}

const DEFAULT_POSE: Record<SeatDirection, { crop: number; dy: number }> = {
    up: { crop: 10, dy: -3 },
    down: { crop: 0, dy: -3 },
    left: { crop: 0, dy: -3 },
    right: { crop: 0, dy: -3 },
};

function isSeatDirection(value: unknown): value is SeatDirection {
    return value === "up" || value === "down" || value === "left" || value === "right";
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function parseFront(value: unknown, baseUrl: string): SeatPose["front"] {
    if (typeof value !== "object" || value === null || !("src" in value) || !("x" in value) || !("y" in value)) {
        return undefined;
    }
    if (
        typeof value.src !== "string" ||
        !isNumberInRange(value.x, -100_000, 100_000) ||
        !isNumberInRange(value.y, -100_000, 100_000)
    ) {
        return undefined;
    }

    try {
        const base = new URL(baseUrl);
        const source = new URL(value.src, base);
        // Another player chooses this address and every client in the room fetches it, so only an image the
        // map storage of this origin serves is accepted. A query or a fragment would name the same file under
        // any number of addresses, and each address is one more texture every client keeps.
        if (
            source.origin !== base.origin ||
            source.search !== "" ||
            source.hash !== "" ||
            !source.pathname.startsWith("/map-storage/") ||
            !source.pathname.endsWith(".png")
        ) {
            return undefined;
        }
        return { source: source.href, x: Math.round(value.x), y: Math.round(value.y) };
    } catch {
        // An address that does not parse is one more malformed field: the pose is kept without its front image.
        return undefined;
    }
}

/**
 * The seated pose a player variable describes, or `undefined` when the value is not a version 1 pose with a
 * direction. `baseUrl` is the address of the page, which a relative front image resolves against.
 */
export function parseSeatPose(value: unknown, baseUrl: string): SeatPose | undefined {
    if (typeof value !== "object" || value === null || !("v" in value) || value.v !== 1) {
        return undefined;
    }
    if (!("direction" in value) || !isSeatDirection(value.direction)) {
        return undefined;
    }

    const defaults = DEFAULT_POSE[value.direction];
    const crop =
        "crop" in value && Number.isInteger(value.crop) && isNumberInRange(value.crop, 0, 16)
            ? value.crop
            : defaults.crop;
    const dy = "dy" in value && isNumberInRange(value.dy, -16, 16) ? Math.round(value.dy) : defaults.dy;
    const front = "front" in value ? parseFront(value.front, baseUrl) : undefined;
    return { direction: value.direction, crop, dy, front };
}
