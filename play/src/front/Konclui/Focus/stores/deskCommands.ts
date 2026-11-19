// What the dock asks of the game about the user's desk. The components may not reach the Phaser layer
// (AGENTS.md, layer table), so `installKonclui()` hands the Phaser implementation (`phaser/deskActions.ts`) to this
// registry and the components call it from here, the way the preferences dialog calls its game commands.

export interface DeskCommands {
    /** Walks the player to their personal desk. Rejects when the walk cannot be made. */
    walkToDesk(): Promise<void>;
}

let installed: DeskCommands | undefined;

export function installDeskCommands(commands: DeskCommands): void {
    installed = commands;
}

export async function walkToDesk(): Promise<void> {
    if (installed === undefined) {
        throw new Error("[konclui] focus: the desk commands are not installed");
    }
    await installed.walkToDesk();
}
