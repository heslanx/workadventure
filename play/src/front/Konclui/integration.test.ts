import { describe, expect, it, vi } from "vitest";
import {
    registerActionBar,
    registerAppFrame,
    registerSceneExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import { installKonclui } from "./integration";

vi.mock("./Shell/components/Frame.svelte", () => ({ default: {} }));
vi.mock("./Shell/components/Dock.svelte", () => ({ default: {} }));
vi.mock("./Shell/stores/shellStore", () => ({ shellActiveStore: {}, shellEnabledStore: {} }));
vi.mock("../ExternalModule/ClientExtensionPoints", () => ({
    registerAppFrame: vi.fn(),
    registerActionBar: vi.fn(),
    registerSceneExtension: vi.fn(),
    setEmbeddedChatHost: vi.fn(),
}));

describe("installKonclui", () => {
    it("plugs Konclui into each extension point once, and registers the seated-pose extension once", () => {
        installKonclui();
        installKonclui();

        expect(registerAppFrame).toHaveBeenCalledTimes(1);
        expect(registerActionBar).toHaveBeenCalledTimes(1);
        expect(setEmbeddedChatHost).toHaveBeenCalledTimes(1);
        expect(registerSceneExtension).toHaveBeenCalledTimes(1);
        expect(vi.mocked(registerSceneExtension).mock.calls[0][0].id).toBe("konclui.seatedPose");
    });
});
