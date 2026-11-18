import { derived, type Readable } from "svelte/store";
import { isSamePlace, type Place } from "../domain/place";
import { presenceStore } from "./presenceStore";
import { throttledStore } from "./throttledStore";

/**
 * The place the chip shows and announces: where the current player stands, but changing at most once every two
 * seconds, so a walk along an area's edge does not make the screen reader read out each step.
 */
export const placeStore: Readable<Place | undefined> = throttledStore(
    derived(presenceStore, (reading) => reading?.place),
    isSamePlace,
);
