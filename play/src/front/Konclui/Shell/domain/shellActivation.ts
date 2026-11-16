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
