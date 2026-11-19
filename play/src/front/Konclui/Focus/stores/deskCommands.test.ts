import { describe, expect, it, vi } from "vitest";
import { installDeskCommands, walkToDesk } from "./deskCommands";

describe("the desk commands registry", () => {
    it("rejects a walk asked for before the integration installed the commands, instead of doing nothing", async () => {
        await expect(walkToDesk()).rejects.toThrow("the desk commands are not installed");
    });

    it("hands the walk to what the integration installed, and passes its failure on", async () => {
        const walk = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("no path"));
        installDeskCommands({ walkToDesk: walk });

        await walkToDesk();
        await expect(walkToDesk()).rejects.toThrow("no path");

        expect(walk).toHaveBeenCalledTimes(2);
    });
});
