/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of the installed commands */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    installGameCommands,
    openWokaEditor,
    pauseTileAnimations,
    playerPosition,
    startPositionNames,
    type GameCommands,
} from "./gameCommands";

describe("the game commands registry", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reports a command sent before the integration installed them, and reads nothing", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        openWokaEditor();

        expect(error).toHaveBeenCalledTimes(1);
        expect(startPositionNames()).toEqual([]);
        expect(playerPosition()).toBeUndefined();
    });

    it("hands each command to what the integration installed", () => {
        const commands: GameCommands = {
            openNameEditor: vi.fn(),
            openWokaEditor: vi.fn(),
            openCompanionEditor: vi.fn(),
            openPwaInstall: vi.fn(),
            pauseTileAnimations: vi.fn(),
            startPositionNames: () => ["hall"],
            playerPosition: () => ({ x: 1, y: 2 }),
        };
        installGameCommands(commands);

        openWokaEditor();
        pauseTileAnimations(false);

        expect(commands.openWokaEditor).toHaveBeenCalledTimes(1);
        expect(commands.pauseTileAnimations).toHaveBeenCalledWith(false);
        expect(startPositionNames()).toEqual(["hall"]);
        expect(playerPosition()).toEqual({ x: 1, y: 2 });
    });
});
