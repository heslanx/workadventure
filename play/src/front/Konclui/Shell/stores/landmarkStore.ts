import { derived, type Readable } from "svelte/store";
import { warningBannerStore } from "../../../Stores/MenuStore";
import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { mapDeletedPromptStore } from "../../../Stores/MapDeletedPromptStore";
import { viewportLandmark, type ViewportLandmark } from "../domain/shellActivation";
import { shellActiveStore } from "./shellStore";

/**
 * Whether upstream draws a `<main>` right now: the three surfaces that do (WarningBanner.svelte, ErrorScreen.svelte and
 * MapDeletedPrompt.svelte), read from their own stores and not from the document, so nothing observes the page.
 * The error screen and the deleted-map prompt end the shell, so only the banner can meet the shell's own landmark.
 * The banner leaves with a 500 ms fly: for that long its `<main>` is still in the page after its store is false, and the
 * area is the main too. That overlap is accepted, as it is brief and ends by itself.
 */
const upstreamMainDrawnStore: Readable<boolean> = derived(
    [warningBannerStore, errorScreenStore, mapDeletedPromptStore],
    ([banner, errorScreen, deleted]) => banner || errorScreen !== undefined || deleted,
);

/** The landmark of the office's area: the main one, or a region while upstream's own main is drawn. */
export const viewportLandmarkStore: Readable<ViewportLandmark> = derived(
    [shellActiveStore, upstreamMainDrawnStore],
    ([shellActive, upstreamMainDrawn]) => viewportLandmark({ shellActive, upstreamMainDrawn }),
);
