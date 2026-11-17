import { describe, expect, it, vi } from "vitest";
import { mount } from "svelte";
import {
    registerActionBar,
    registerAppFrame,
    registerSceneExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import { installKonclui } from "./integration";
import { gameActions } from "./Preferences/phaser/gameActions";
import { installGameCommands } from "./Preferences/stores/gameCommands";

vi.mock("./Shell/components/Frame.svelte", () => ({ default: {} }));
vi.mock("./Shell/components/Dock.svelte", () => ({ default: {} }));
vi.mock("./Shell/stores/shellStore", () => ({ shellActiveStore: {}, shellEnabledStore: {} }));
vi.mock("./Ambience/phaser/browserEffectsPort", () => ({ createBrowserEffectsPort: () => ({}) }));
vi.mock("./Preferences/components/PreferencesHost.svelte", () => ({ default: {} }));
vi.mock("./Preferences/phaser/gameActions", () => ({ gameActions: { openNameEditor: vi.fn() } }));
vi.mock("./Preferences/stores/gameCommands", () => ({ installGameCommands: vi.fn() }));
vi.mock("svelte", () => ({ mount: vi.fn() }));
vi.stubGlobal("document", { createElement: () => ({}), body: { append: vi.fn() } });
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
        expect(mount).toHaveBeenCalledTimes(1);
        expect(installGameCommands).toHaveBeenCalledTimes(1);
        expect(installGameCommands).toHaveBeenCalledWith(gameActions);
        expect(vi.mocked(registerSceneExtension).mock.calls.map(([extension]) => extension.id)).toEqual([
            "konclui.seatedPose",
            "konclui.sceneEffects",
        ]);
    });
});
