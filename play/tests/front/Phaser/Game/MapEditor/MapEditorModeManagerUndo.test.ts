import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { Command } from "@workadventure/map-editor";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/svelte", () => ({ captureException }));

// The manager only needs its history here; the tools, stores and scene are irrelevant to undo.
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/AreaEditorTool", () => ({ AreaEditorTool: class {} }));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/FloorEditorTool", () => ({ FloorEditorTool: class {} }));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/EntityEditorTool", () => ({
    EntityEditorTool: class {},
}));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/WAMSettingsEditorTool", () => ({
    WAMSettingsEditorTool: class {},
}));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/TrashEditorTool", () => ({ TrashEditorTool: class {} }));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/ExplorerTool", () => ({ ExplorerTool: class {} }));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Tools/CloseTool", () => ({ CloseTool: class {} }));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Commands/Area/UpdateAreaFrontCommand", () => ({
    UpdateAreaFrontCommand: class {},
}));
vi.mock("../../../../../src/front/Phaser/Game/MapEditor/Commands/Entity/UpdateEntityFrontCommand", () => ({
    UpdateEntityFrontCommand: class {},
}));
vi.mock("../../../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../../src/front/Stores/MapEditorStore", () => ({
    mapEditorAskToClaimPersonalAreaStore: {},
    mapEditorModeStore: {},
    mapEditorSelectedToolStore: {},
}));
vi.mock("../../../../../src/front/Stores/MenuStore", () => ({
    mapEditorActivated: {},
    mapEditorActivatedForThematics: {},
}));
vi.mock("../../../../../src/front/Stores/PersonalDeskStore", () => ({
    isInsidePersonalAreaStore: {},
    personalAreaDataStore: {},
}));
vi.mock("../../../../../src/front/Connection/LocalUserStore", () => ({ localUserStore: {} }));
vi.mock("../../../../../src/front/Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../../../src/front/Stores/ErrorStore", () => ({ warningMessageStore: {} }));
vi.mock("../../../../../src/front/Components/MapEditor/offerUndo", () => ({ offerUndo: vi.fn() }));
vi.mock("../../../../../src/i18n/i18n-svelte", () => ({ default: {} }));

import { MapEditorModeManager } from "../../../../../src/front/Phaser/Game/MapEditor/MapEditorModeManager";
import type { FrontCommandInterface } from "../../../../../src/front/Phaser/Game/MapEditor/Commands/FrontCommandInterface";

type TestCommand = Command & FrontCommandInterface;

// Seed the private history without booting a Phaser scene.
type ManagerInternals = {
    localCommandsHistory: TestCommand[];
    pendingCommands: TestCommand[];
    currentCommandIndex: number;
    scene: { connection: unknown };
};

function createManager(history: TestCommand[]): { manager: MapEditorModeManager; internals: ManagerInternals } {
    const manager = Object.create(MapEditorModeManager.prototype) as MapEditorModeManager;
    const internals = manager as unknown as ManagerInternals & { runningUndoRedoCommand: Promise<void> };
    internals.localCommandsHistory = history;
    internals.pendingCommands = [];
    internals.currentCommandIndex = history.length - 1;
    internals.runningUndoRedoCommand = Promise.resolve();
    internals.scene = { connection: {} };
    return { manager, internals };
}

function createCommand(undoExecute: () => Promise<void>): {
    command: TestCommand;
    undoCommand: TestCommand;
    undoExecuteMock: Mock<() => Promise<void>>;
} {
    const undoExecuteMock = vi.fn(undoExecute);
    const undoCommand = { execute: undoExecuteMock, emitEvent: vi.fn() } as unknown as TestCommand;
    const command = { getUndoCommand: () => undoCommand } as unknown as TestCommand;
    return { command, undoCommand, undoExecuteMock };
}

describe("MapEditorModeManager undo", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        captureException.mockClear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("resolves true and records the undo once when the undo runs", async () => {
        const { command, undoCommand, undoExecuteMock } = createCommand(() => Promise.resolve());
        const { manager, internals } = createManager([command]);

        await expect(manager.undoCommandIfLast(command)).resolves.toBe(true);

        expect(undoExecuteMock).toHaveBeenCalledTimes(1);
        expect(internals.pendingCommands).toEqual([undoCommand]);
        expect(internals.currentCommandIndex).toBe(-1);
        expect(internals.localCommandsHistory).toEqual([command]);
        expect(captureException).not.toHaveBeenCalled();
    });

    it("resolves false and still reports the error when the undo throws", async () => {
        const failure = new Error("undo failed");
        const { command, undoExecuteMock } = createCommand(() => Promise.reject(failure));
        const { manager, internals } = createManager([command]);

        await expect(manager.undoCommandIfLast(command)).resolves.toBe(false);

        expect(undoExecuteMock).toHaveBeenCalledTimes(1);
        expect(captureException).toHaveBeenCalledWith(failure);
        expect(internals.pendingCommands).toEqual([]);
    });

    it("resolves false and undoes nothing when the command is no longer the last one", async () => {
        const stale = createCommand(() => Promise.resolve());
        const newer = createCommand(() => Promise.resolve());
        const { manager, internals } = createManager([stale.command, newer.command]);

        await expect(manager.undoCommandIfLast(stale.command)).resolves.toBe(false);

        expect(stale.undoExecuteMock).not.toHaveBeenCalled();
        expect(newer.undoExecuteMock).not.toHaveBeenCalled();
        expect(internals.pendingCommands).toEqual([]);
        expect(internals.currentCommandIndex).toBe(1);
    });

    it("keeps the public undoCommand resolving without a value for the keyboard", async () => {
        const { command, undoExecuteMock } = createCommand(() => Promise.resolve());
        const { manager } = createManager([command]);

        await expect(manager.undoCommand()).resolves.toBeUndefined();
        expect(undoExecuteMock).toHaveBeenCalledTimes(1);
    });
});
