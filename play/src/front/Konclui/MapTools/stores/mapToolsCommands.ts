// What the map tools ask of the game. The components may not reach the Phaser layer (AGENTS.md, layer table), so
// `installKonclui()` hands the implementations to this registry and the components call them from here, the way the
// dock's desk button does.

export interface MapToolsCommands {
    /** Brings the view back to the avatar and follows it again. */
    readonly centerOnPlayer: () => void;
    /** Takes the player to their desk. */
    readonly goToDesk: () => void;
    /** Ends the walk in progress where the player stands. */
    readonly cancelWalk: () => void;
}

let installed: MapToolsCommands | undefined;

export function installMapToolsCommands(commands: MapToolsCommands): void {
    installed = commands;
}

function commands(): MapToolsCommands {
    if (installed === undefined) {
        throw new Error("[konclui] map tools: the commands are not installed");
    }
    return installed;
}

export function centerOnPlayer(): void {
    commands().centerOnPlayer();
}

export function goToDesk(): void {
    commands().goToDesk();
}

export function cancelWalk(): void {
    commands().cancelWalk();
}
