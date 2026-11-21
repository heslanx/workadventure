import { beforeEach, describe, expect, it, vi } from "vitest";

describe("the map tools commands", () => {
    // The registry holds its commands in the module, so each test starts from a module that has none.
    beforeEach(() => {
        vi.resetModules();
    });

    it("fails loudly when a tool is used before the commands are installed, instead of doing nothing", async () => {
        const { cancelWalk, centerOnPlayer, goToDesk } = await import("./mapToolsCommands");

        expect(() => centerOnPlayer()).toThrow("not installed");
        expect(() => goToDesk()).toThrow("not installed");
        expect(() => cancelWalk()).toThrow("not installed");
    });

    it("hands each tool to the command installed for it", async () => {
        const commands = { centerOnPlayer: vi.fn(), goToDesk: vi.fn(), cancelWalk: vi.fn() };
        const registry = await import("./mapToolsCommands");
        registry.installMapToolsCommands(commands);

        registry.centerOnPlayer();
        registry.goToDesk();
        registry.cancelWalk();

        expect(commands.centerOnPlayer).toHaveBeenCalledTimes(1);
        expect(commands.goToDesk).toHaveBeenCalledTimes(1);
        expect(commands.cancelWalk).toHaveBeenCalledTimes(1);
    });
});
