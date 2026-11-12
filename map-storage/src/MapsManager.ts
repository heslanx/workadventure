import type { Command } from "@workadventure/map-editor";
import { WamFile, WAMFileFormat } from "@workadventure/map-editor";
import type { EditMapCommandMessage } from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { wamFileMigration } from "@workadventure/map-editor/src/Migrations/WamFileMigration";
import { LockByKey } from "@workadventure/shared-utils/src/LockByKey";
import { fileSystem } from "./fileSystem";
import { MapListService } from "./Services/MapListService";
import { WebHookService } from "./Services/WebHookService";
import { WEB_HOOK_URL } from "./Enum/EnvironmentVariable";

/**
 * Time after which a map edition lock operation is considered stuck and rejected, so a wedged
 * operation cannot block map edition forever.
 */
const EDITION_LOCK_TIMEOUT_MS = 10_000;

/**
 * Save lifecycle of a map whose in-memory WAM is not on storage yet. A map without a state is clean.
 *
 * - "dirty": unsaved edits, a write starts when the timer fires.
 * - "retrying": the last write failed, the next attempt starts when the timer fires.
 * - "saving": the only write of this map is in flight, the timer fails it if it does not settle in
 *   time. `editedDuringWrite` is set when an edit landed after that write started: its completion
 *   must not make the map clean.
 *
 * Completion handlers change the state before they log or report, so a throwing logger cannot leave
 * a map "saving" without a timer.
 *
 * `lastEditAt` is the time of the newest unsaved edit, from which the retry horizon is measured.
 */
type MapSaveState =
    | {
          status: "dirty" | "retrying";
          timer: NodeJS.Timeout;
          lastEditAt: number;
          failedAttempts: number;
      }
    | {
          status: "saving";
          timer: NodeJS.Timeout;
          writeStartedAt: number;
          editedDuringWrite: boolean;
          lastEditAt: number;
          failedAttempts: number;
      };

class MapsManager {
    private loadedMaps: Map<string, WamFile>;
    private loadedMapsCommandsQueue: Map<string, EditMapCommandMessage[]>;

    private mapSaveStates: Map<string, MapSaveState>;

    private readonly editionLocks = new LockByKey<string>(
        (error, key, timeoutMs) => {
            Sentry.captureException(error, {
                tags: { key: String(key), location: "withTimeout" },
                extra: { timeoutMs },
            });
        },
        (error, key) => {
            console.error(`Edition lock callback failed for key: ${key}`, error);
            Sentry.captureException(error, {
                tags: { key: String(key), location: "editionLockCallback" },
            });
        },
    );

    private mapListService: MapListService;

    /**
     * Delay between a map becoming dirty and its save, between two consecutive saves of a map that
     * keeps being edited, and between two attempts of a failing save.
     */
    private readonly AUTO_SAVE_INTERVAL_MS: number = 15 * 1000; // 15 seconds
    /**
     * Time after which the command will be removed from the commands queue
     */
    private readonly COMMAND_TIME_IN_QUEUE_MS: number = this.AUTO_SAVE_INTERVAL_MS * 2;
    /**
     * Time without a new edit after which a failing save is abandoned, so maps edited during a storage
     * outage are not kept in memory forever. Measured from the newest unsaved edit: a map that is still
     * being edited keeps being retried.
     */
    private readonly SAVE_RETRY_HORIZON_MS: number = 60 * 60 * 1000; // 1 hour
    /**
     * Time after which a write that has not settled is counted as failed, so a hung storage call cannot
     * leave a map unsaved and unretried forever. Above the 60 s default S3 request timeout.
     */
    private readonly SAVE_WRITE_TIMEOUT_MS: number = 5 * 60 * 1000; // 5 minutes
    /**
     * During an outage, a failing save is logged on its first attempt and then once every this many
     * attempts (every 5 minutes at the autosave interval), not on every attempt of every dirty map.
     */
    private readonly SAVE_FAILURE_LOG_EVERY_ATTEMPTS: number = 20;

    constructor() {
        this.loadedMaps = new Map<string, WamFile>();
        this.loadedMapsCommandsQueue = new Map<string, EditMapCommandMessage[]>();
        this.mapSaveStates = new Map<string, MapSaveState>();
        this.mapListService = new MapListService(fileSystem, new WebHookService(WEB_HOOK_URL));
    }

    public waitForLock(mapKey: string, callback: () => Promise<void>): Promise<void> {
        return this.editionLocks.waitForLock(mapKey, callback, EDITION_LOCK_TIMEOUT_MS);
    }

    public async executeCommand(mapKey: string, domain: string, command: Command): Promise<void> {
        const wamFile = this.getWamFile(mapKey);
        if (!wamFile) {
            throw new Error('Could not find WAM file with key "' + mapKey + '"');
        }
        let updatedWamFile: Awaited<ReturnType<Command["execute"]>>;
        try {
            updatedWamFile = await command.execute();
        } finally {
            // Marked after the command ran, so a write that started while it was running is known to be stale.
            this.markUnsaved(mapKey);
        }

        // Security check: Check that the map is valid after the change (it should be, but better safe than sorry)
        WAMFileFormat.parse(wamFile.getWam());

        if (updatedWamFile != undefined) {
            this.mapListService
                .updateWAMFileInCache(domain, mapKey.replace(domain, ""), updatedWamFile)
                .catch((e) => console.error(e));
        }
    }

    public getCommandsNewerThan(mapKey: string, commandId: string | undefined): EditMapCommandMessage[] {
        // shouldn't we just apply every command on this list to the new client?
        const queue = this.loadedMapsCommandsQueue.get(mapKey);
        if (queue) {
            if (commandId === undefined) {
                return queue;
            }
            const commandIndex = queue.findIndex((command) => command.id === commandId);
            if (commandIndex === -1) {
                // Most of the time, the last command id of the map will not be part of the queue
                // This is always true unless the last change was done less that 30 seconds ago.
                // In this case, let's apply the whole queue.
                return queue;
            }
            return queue.slice(commandIndex + 1);
        }
        return [];
    }

    public async getOrLoadWamFile(key: string): Promise<WamFile> {
        let wamFile = this.getWamFile(key);
        if (!wamFile) {
            wamFile = await this.loadWAMToMemory(key);
        }
        return wamFile;
    }

    public getWamFile(key: string): WamFile | undefined {
        return this.loadedMaps.get(key);
    }

    public getLoadedMaps(): string[] {
        return Array.from(this.loadedMaps.keys());
    }

    public async loadWAMToMemory(key: string): Promise<WamFile> {
        const file = await fileSystem.readFileAsString(key);
        const wam = WAMFileFormat.parse(wamFileMigration.migrate(JSON.parse(file)));

        const wamFile = new WamFile(wam);
        this.loadedMaps.set(key, wamFile);

        return wamFile;
    }

    public clearAfterUpload(key: string): void {
        console.info(`[${new Date().toISOString()}] UPLOAD/DELETE DETECTED. CLEAR CACHE FOR: ${key}`);
        this.loadedMaps.delete(key);
        this.loadedMapsCommandsQueue.delete(key);
        // The in-memory map is obsolete: no further write of it may start. A write already handed to
        // the storage cannot be cancelled, but its completion no longer finds its state and is ignored.
        const saveState = this.mapSaveStates.get(key);
        if (saveState) {
            clearTimeout(saveState.timer);
        }
        this.mapSaveStates.delete(key);
    }

    public addCommandToQueue(mapKey: string, message: EditMapCommandMessage): void {
        let queue = this.loadedMapsCommandsQueue.get(mapKey);
        if (queue === undefined) {
            queue = [];
            this.loadedMapsCommandsQueue.set(mapKey, queue);
        }
        queue.push(message);
        this.setCommandDeletionTimeout(mapKey, message.id);
        const wamFile = this.loadedMaps.get(mapKey);
        if (wamFile) {
            wamFile.updateLastCommandIdProperty(message.id);
            // The WAM changed (its last command id, and the map for commands that do not run through
            // executeCommand, such as custom entity deletion), so it must be saved.
            this.markUnsaved(mapKey);
        }
    }

    private setCommandDeletionTimeout(mapKey: string, commandId: string): void {
        setTimeout(() => {
            const queue = this.loadedMapsCommandsQueue.get(mapKey);
            if (!queue || queue.length === 0) {
                return;
            }
            if (queue[0].id === commandId) {
                queue.splice(0, 1);

                // If we don't have any commands anymore, let's remove the map from memory.
                if (queue.length === 0) {
                    this.evictIfIdle(mapKey);
                }
            } else {
                console.error(
                    `[${new Date().toISOString()}] Command with id ${commandId} that is scheduled from removal in the queue is not the first command. This should never happen (unless the queue was purged and recreated within 30 seconds... unlikely.`,
                );
            }
        }, this.COMMAND_TIME_IN_QUEUE_MS);
    }

    /**
     * Removes the map from memory once it has neither queued commands nor unsaved changes. Storage is
     * then the only copy, so a map that is not saved yet must stay loaded.
     *
     * We acquire the per-map lock to ensure we don't evict while a command is executing or about to
     * be queued (addCommandToQueue is called synchronously after executeCommand inside the same lock).
     */
    private evictIfIdle(mapKey: string): void {
        this.editionLocks
            .waitForLock(
                mapKey,
                () => {
                    // Re-check after acquiring the lock: a new command may have been added while we
                    // were waiting.
                    const queue = this.loadedMapsCommandsQueue.get(mapKey);
                    if ((!queue || queue.length === 0) && !this.mapSaveStates.has(mapKey)) {
                        this.loadedMapsCommandsQueue.delete(mapKey);
                        this.loadedMaps.delete(mapKey);
                    }
                    return Promise.resolve();
                },
                EDITION_LOCK_TIMEOUT_MS,
            )
            .catch((e) => {
                console.error("Error while acquiring or processing lock for cleaning map key ", mapKey, e);
                Sentry.captureException(e);
            });
    }

    private markUnsaved(mapKey: string): void {
        const now = Date.now();
        const saveState = this.mapSaveStates.get(mapKey);
        if (saveState === undefined) {
            this.scheduleSave(mapKey, "dirty", this.AUTO_SAVE_INTERVAL_MS, now, 0);
            return;
        }
        // A scheduled write saves the map as it is when it starts, so only the edit time changes.
        saveState.lastEditAt = now;
        if (saveState.status === "saving") {
            saveState.editedDuringWrite = true;
        }
    }

    private scheduleSave(
        mapKey: string,
        status: "dirty" | "retrying",
        delayMs: number,
        lastEditAt: number,
        failedAttempts: number,
    ): void {
        const state: MapSaveState = {
            status,
            timer: setTimeout(() => this.startSave(mapKey, state), delayMs),
            lastEditAt,
            failedAttempts,
        };
        this.mapSaveStates.set(mapKey, state);
    }

    private startSave(mapKey: string, scheduled: MapSaveState): void {
        const wamFile = this.loadedMaps.get(mapKey);
        if (!wamFile) {
            this.mapSaveStates.delete(mapKey);
            return;
        }
        const saving: MapSaveState & { status: "saving" } = {
            status: "saving",
            timer: setTimeout(() => {
                this.onSaveFailed(
                    mapKey,
                    saving,
                    new Error(`Write of map ${mapKey} did not settle within ${this.SAVE_WRITE_TIMEOUT_MS}ms`),
                );
            }, this.SAVE_WRITE_TIMEOUT_MS),
            writeStartedAt: Date.now(),
            editedDuringWrite: false,
            // Read when the write starts: edits made while it was scheduled updated the scheduled state.
            lastEditAt: scheduled.lastEditAt,
            failedAttempts: scheduled.failedAttempts,
        };
        this.mapSaveStates.set(mapKey, saving);
        console.info(`[${new Date().toISOString()}] saving map ${mapKey}`);
        (async () => {
            await fileSystem.writeStringAsFile(mapKey, JSON.stringify(wamFile.getWam()));
        })()
            .then(
                () => this.onSaveSucceeded(mapKey, saving),
                (e: unknown) => this.onSaveFailed(mapKey, saving, e),
            )
            .catch((e: unknown) => {
                console.error(`[${new Date().toISOString()}] Error while handling the save of map ${mapKey}`, e);
                Sentry.captureException(e, { tags: { key: mapKey, location: "autosaveCompletion" } });
            });
    }

    private onSaveSucceeded(mapKey: string, saving: MapSaveState & { status: "saving" }): void {
        if (this.mapSaveStates.get(mapKey) !== saving) {
            // The map was replaced or deleted, or this write timed out, while it was in flight.
            return;
        }
        clearTimeout(saving.timer);
        if (!saving.editedDuringWrite) {
            this.mapSaveStates.delete(mapKey);
            this.evictIfIdle(mapKey);
        } else {
            // The write that just finished misses the newer edits. Save them one interval after that
            // write started, as a map that keeps being edited was saved until now.
            const sinceWriteStarted = Date.now() - saving.writeStartedAt;
            this.scheduleSave(
                mapKey,
                "dirty",
                Math.max(0, this.AUTO_SAVE_INTERVAL_MS - sinceWriteStarted),
                saving.lastEditAt,
                0,
            );
        }
        if (saving.failedAttempts > 0) {
            console.info(
                `[${new Date().toISOString()}] Saving map ${mapKey} succeeded after ${saving.failedAttempts} failed attempts`,
            );
        }
    }

    private onSaveFailed(mapKey: string, saving: MapSaveState & { status: "saving" }, error: unknown): void {
        if (this.mapSaveStates.get(mapKey) !== saving) {
            // The map was replaced or deleted, or this write timed out, while it was in flight.
            return;
        }
        clearTimeout(saving.timer);
        const failedAttempts = saving.failedAttempts + 1;
        const sinceLastEditMs = Date.now() - saving.lastEditAt;
        if (sinceLastEditMs >= this.SAVE_RETRY_HORIZON_MS) {
            this.mapSaveStates.delete(mapKey);
            this.evictIfIdle(mapKey);
            console.error(
                `[${new Date().toISOString()}] SAVING MAP ${mapKey} FAILED ${failedAttempts} TIMES, LAST EDIT ${sinceLastEditMs}ms AGO. GIVING UP, UNSAVED CHANGES ARE LOST UNLESS THE MAP IS EDITED AGAIN`,
                error,
            );
            Sentry.captureException(error, {
                tags: { key: mapKey, location: "autosaveAbandoned" },
                extra: { failedAttempts, sinceLastEditMs },
            });
            return;
        }
        this.scheduleSave(mapKey, "retrying", this.AUTO_SAVE_INTERVAL_MS, saving.lastEditAt, failedAttempts);
        if (failedAttempts === 1 || failedAttempts % this.SAVE_FAILURE_LOG_EVERY_ATTEMPTS === 0) {
            console.error(
                `[${new Date().toISOString()}] Saving map ${mapKey} failed (attempt ${failedAttempts}, last edit ${sinceLastEditMs}ms ago). Retrying every ${this.AUTO_SAVE_INTERVAL_MS}ms, logging every ${this.SAVE_FAILURE_LOG_EVERY_ATTEMPTS} attempts`,
                error,
            );
        }
        if (failedAttempts === 1) {
            // Once per failing streak: an outage must not report every attempt of every dirty map.
            Sentry.captureException(error, {
                tags: { key: mapKey, location: "autosaveFailed" },
            });
        }
    }
}

export const mapsManager = new MapsManager();
