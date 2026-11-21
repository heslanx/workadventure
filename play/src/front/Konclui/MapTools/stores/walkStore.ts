import { writable, type Readable } from "svelte/store";
import { NOT_WALKING, type WalkState } from "../domain/walk";

const walk = writable<WalkState>(NOT_WALKING);
let current: WalkState = NOT_WALKING;

/** Whether the player walks, and what a live region says about it. The scene's tile controller writes it. */
export const walkStore: Readable<WalkState> = { subscribe: walk.subscribe };

/**
 * Hands the tools what the controller reports. A reading equal to the last one is dropped before the store, because a
 * store wakes its readers for any object it is given.
 */
export function publishWalk(next: WalkState): void {
    if (current.walking === next.walking && current.walkStatus === next.walkStatus) return;
    current = { walking: next.walking, walkStatus: next.walkStatus };
    walk.set(current);
}
