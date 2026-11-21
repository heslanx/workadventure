/**
 * What a walk looks like from outside the map: whether the player walks now, and what a live region says about it. The
 * scene's tile controller computes both; the tools only show them.
 */
export interface WalkState {
    readonly walking: boolean;
    readonly walkStatus: "idle" | "going" | "cancelled";
}

export const NOT_WALKING: WalkState = { walking: false, walkStatus: "idle" };
