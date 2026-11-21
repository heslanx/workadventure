import { get, writable, type Readable } from "svelte/store";
import { isSameCrowd, type CrowdReading } from "../domain/crowd";
import { rosterListOpenStore } from "./worldRoster";

// What the scene reads of the people around the player, kept for the people panel. The scene extension
// (`phaser/presenceExtension.ts`) reads the Phaser characters and calls `publishCrowd`; it does not write the store
// itself, so the layer that sees Phaser never owns Konclui state (`integration.ts` hands it these functions).

const reading = writable<CrowdReading | undefined>(undefined);
let current: CrowdReading | undefined;

/** The latest reading; `undefined` until the scene has read once while the panel was open, and again once it closed. */
export const crowdStore: Readable<CrowdReading | undefined> = { subscribe: reading.subscribe };

/** Publishes a reading. One equal to the last is dropped, so the panel hears about a change and not about each look. */
export function publishCrowd(next: CrowdReading | undefined): void {
    if (isSameCrowd(current, next)) return;
    current = next;
    reading.set(next);
}

/** Whether the panel reads the crowd right now: the scene computes it only then. */
export function crowdWanted(): boolean {
    return get(rosterListOpenStore);
}
