/**
 * What decides whether the office shell is drawn right now.
 *
 * `shellEnabled` is the room's configuration and is known as soon as the room is. The other fields describe the
 * client's progress: the shell is drawn only once the game scene is ready and no entry or error screen covers it.
 */
export interface ShellGate {
    readonly shellEnabled: boolean;
    readonly sceneLoaded: boolean;
    readonly loading: boolean;
    readonly entryScreenVisible: boolean;
    readonly errorVisible: boolean;
}

export function isShellActive(gate: ShellGate): boolean {
    return gate.shellEnabled && gate.sceneLoaded && !gate.loading && !gate.entryScreenVisible && !gate.errorVisible;
}

/**
 * What decides whether the office frame is laid out: the gate above, plus whether the game scene has been created.
 *
 * The frame (the rail's column, the side panel's column and the gutter around the map) is laid out before the
 * chrome is drawn, so that the map is already where it will stay when the shell is revealed. A scene is created as
 * soon as its map has loaded, while the loading screen still fades and the scene is hidden until the room is joined.
 */
export interface ShellFrameGate extends ShellGate {
    readonly sceneCreated: boolean;
}

/**
 * Whether the game element is laid out inside the office frame. It is so from the moment a game scene exists in an
 * enabled room, and not while an entry or error screen is up: those are drawn across the whole window, over a canvas
 * that has to be as large as the window, so the frame waits for them to end. Whenever the shell is active the frame
 * is laid out.
 */
export function isShellFramed(gate: ShellFrameGate): boolean {
    return (
        gate.shellEnabled && !gate.entryScreenVisible && !gate.errorVisible && (gate.sceneCreated || gate.sceneLoaded)
    );
}

/**
 * Whether the frame is laid out but the chrome is not drawn yet: the map's box has just moved from the whole window
 * into the frame, and the scene behind it is still loading or joining its room.
 *
 * Chrome counts a layout shift for every visible box that moves, and a loading screen covering the box does not exempt
 * it. The map's box and all it holds are therefore not visible while this holds: they move, take the frame's size, and
 * are revealed with the chrome, with nothing left to move. The loading screen is the one thing that shows through, and
 * it stands on the window, so it does not move with them.
 *
 * This is the same on a first visit and on a reload: the frame cannot start laid out before the scene exists, because
 * the room's configuration and the entry screens are decided after the first paint (see `isShellFramed`).
 */
export function isShellSettling(gate: ShellFrameGate): boolean {
    return isShellFramed(gate) && !isShellActive(gate);
}

/** What the office's area is to assistive technology. */
export type ViewportLandmark = "main" | "region" | undefined;

/**
 * Which landmark the office's area is while the shell is drawn.
 *
 * The area is the page's main landmark, unless upstream draws a `<main>` of its own inside it: the warning banner, the
 * error screen and the deleted-map prompt each do, and a page has one main landmark. Then the area is a region with the
 * same name and the skip-to-main lands on upstream's. Outside the shell the area names nothing.
 */
export function viewportLandmark(state: { shellActive: boolean; upstreamMainDrawn: boolean }): ViewportLandmark {
    if (!state.shellActive) return undefined;
    return state.upstreamMainDrawn ? "region" : "main";
}
