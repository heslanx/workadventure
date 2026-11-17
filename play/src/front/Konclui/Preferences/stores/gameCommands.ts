// What the dialog asks of the running game: open an editor scene, pause the map's animations, read the map's start
// positions and the player's place. The components may not reach the Phaser layer (AGENTS.md, layer table), so
// `installKonclui()` hands the Phaser implementation (`phaser/gameActions.ts`) to this registry, and the
// components call it from here.

export interface MapPosition {
    readonly x: number;
    readonly y: number;
}

export interface GameCommands {
    openNameEditor(): void;
    openWokaEditor(): void;
    openCompanionEditor(): void;
    openPwaInstall(): void;
    /** Pauses or resumes the map's tile animations now. */
    pauseTileAnimations(paused: boolean): void;
    /** The map's start positions; empty outside a map. */
    startPositionNames(): string[];
    /** Where the player stands, in map pixels; undefined until the map has a player. */
    playerPosition(): MapPosition | undefined;
}

let installed: GameCommands | undefined;

export function installGameCommands(commands: GameCommands): void {
    installed = commands;
}

function commands(): GameCommands | undefined {
    if (installed === undefined) console.error("[konclui] preferences: the game commands are not installed");
    return installed;
}

export function openNameEditor(): void {
    commands()?.openNameEditor();
}

export function openWokaEditor(): void {
    commands()?.openWokaEditor();
}

export function openCompanionEditor(): void {
    commands()?.openCompanionEditor();
}

export function openPwaInstall(): void {
    commands()?.openPwaInstall();
}

export function pauseTileAnimations(paused: boolean): void {
    commands()?.pauseTileAnimations(paused);
}

export function startPositionNames(): string[] {
    return commands()?.startPositionNames() ?? [];
}

export function playerPosition(): MapPosition | undefined {
    return commands()?.playerPosition();
}
