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
vi.mock("./Ambience/phaser/browserEffectsPort", () => ({ createBrowserEffectsPort: () => ({}) }));
vi.mock("../ExternalModule/ClientExtensionPoints", () => ({
    registerAppFrame: vi.fn(),
    registerActionBar: vi.fn(),
    registerSceneExtension: vi.fn(),
    setEmbeddedChatHost: vi.fn(),
}));

describe("installKonclui", () => {
    it("plugs Konclui into each extension point once, and registers each scene extension once", () => {
        installKonclui();
        installKonclui();

        expect(registerAppFrame).toHaveBeenCalledTimes(1);
        expect(registerActionBar).toHaveBeenCalledTimes(1);
        expect(setEmbeddedChatHost).toHaveBeenCalledTimes(1);
        expect(vi.mocked(registerSceneExtension).mock.calls.map(([extension]) => extension.id)).toEqual([
            "konclui.seatedPose",
            "konclui.sceneEffects",
        ]);
    });
});
