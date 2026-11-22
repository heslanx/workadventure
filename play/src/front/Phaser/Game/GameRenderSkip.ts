/** Something drawn over the game, as far as the player can see through it. */
export interface MapCover {
    /** 1 when the map cannot be seen at all (the game container is hidden), below 1 when it shows through. */
    opacity: number;
}

/**
 * The full-screen meeting is `bg-contrast/80 backdrop-blur` (VideoMediaBox.svelte): the map shows through it, blurred,
 * so the avatars behind it still move. It does not cover the map, and the render is not skipped under it. The test
 * reads VideoMediaBox.svelte and fails when its background stops being 80%, so that this value is revisited with it.
 */
export const FULL_SCREEN_MEETING_COVER_OPACITY = 0.8;

/** A full-screen co-website hides the game container (`display: none`): nothing of the map is visible. */
export const FULL_SCREEN_COWEBSITE_COVER_OPACITY = 1;

/** Whether the map is fully covered, which is when its render can be skipped: one opaque cover is enough. */
export function isMapFullyCovered(covers: readonly MapCover[]): boolean {
    return covers.some((cover) => cover.opacity >= 1);
}

/** The covers the interface puts over the map. A cover that is not on screen is absent. */
export function mapCovers(state: { fullScreenCowebsite: boolean; fullScreenMeeting: boolean }): MapCover[] {
    const covers: MapCover[] = [];
    if (state.fullScreenCowebsite) {
        covers.push({ opacity: FULL_SCREEN_COWEBSITE_COVER_OPACITY });
    }
    if (state.fullScreenMeeting) {
        covers.push({ opacity: FULL_SCREEN_MEETING_COVER_OPACITY });
    }
    return covers;
}
