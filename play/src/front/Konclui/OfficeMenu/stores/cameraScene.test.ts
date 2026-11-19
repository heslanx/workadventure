import { afterEach, describe, expect, it, vi } from "vitest";
import { installCameraScene, openCameraScene } from "./cameraScene";

describe("the camera scene command", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("hands the request to the installed command", () => {
        const openScene = vi.fn();
        installCameraScene({ openCameraScene: openScene });

        openCameraScene();

        expect(openScene).toHaveBeenCalledOnce();
    });

    it("reports a command that was never installed instead of failing silently", () => {
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        // The registry is module state, so a fresh copy of the module is one nobody installed into.
        vi.resetModules();

        return import("./cameraScene").then((fresh) => {
            fresh.openCameraScene();

            expect(report).toHaveBeenCalledWith(expect.stringContaining("camera scene command is not installed"));
        });
    });
});
