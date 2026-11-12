import type { WAMFileFormat } from "@workadventure/map-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystemInterface } from "../Upload/FileSystemInterface";

// Hoisted above the imports below: EnvironmentVariable exits the process when these are missing, and
// MapsManager binds to the storage singleton when it is imported.
const { storage } = vi.hoisted(() => {
    process.env.API_URL = "http://admin.test";
    process.env.MAP_STORAGE_API_TOKEN = "token";
    process.env.PUSHER_URL = "http://play.test";

    interface StartedWrite {
        path: string;
        succeed: () => void;
        fail: () => void;
    }

    const unsupported = (): never => {
        throw new Error("Not used by the autosave lifecycle");
    };

    /**
     * In-memory storage whose WAM writes can be failed or held open. A write only becomes visible in
     * `files` when it succeeds, so the last write to finish wins, as on a real backend.
     */
    class ControllableStorage implements FileSystemInterface {
        public readonly files = new Map<string, string>();
        public writeMode: "succeed" | "fail" | "hold" = "succeed";
        public writesStarted = 0;
        public maxConcurrentWrites = 0;
        private inFlight: StartedWrite[] = [];

        public reset(): void {
            this.files.clear();
            this.writeMode = "succeed";
            this.writesStarted = 0;
            this.maxConcurrentWrites = 0;
            this.inFlight = [];
        }

        /** Settles the held writes, most recently started first. */
        public settleHeldWritesNewestFirst(outcome: "succeed" | "fail"): void {
            for (const write of [...this.inFlight].reverse()) {
                write[outcome]();
            }
        }

        /** Settles the held write that started first. */
        public settleOldestHeldWrite(outcome: "succeed" | "fail"): void {
            this.inFlight[0]?.[outcome]();
        }

        public readFileAsString(virtualPath: string): Promise<string> {
            const file = this.files.get(virtualPath);
            return file === undefined ? Promise.reject(new Error(`No file at ${virtualPath}`)) : Promise.resolve(file);
        }

        public writeStringAsFile(virtualPath: string, content: string): Promise<void> {
            this.writesStarted++;
            return new Promise<void>((resolve, reject) => {
                const settle = (): void => {
                    this.inFlight = this.inFlight.filter((write) => write !== started);
                };
                const started: StartedWrite = {
                    path: virtualPath,
                    succeed: () => {
                        settle();
                        this.files.set(virtualPath, content);
                        resolve();
                    },
                    fail: () => {
                        settle();
                        reject(new Error("Storage unavailable"));
                    },
                };
                this.inFlight.push(started);
                this.maxConcurrentWrites = Math.max(
                    this.maxConcurrentWrites,
                    this.inFlight.filter((write) => write.path === virtualPath).length,
                );
                if (this.writeMode !== "hold") {
                    started[this.writeMode]();
                }
            });
        }

        public deleteFiles(virtualPath: string): Promise<void> {
            this.files.delete(virtualPath);
            return Promise.resolve();
        }

        public deleteFilesExceptWAM = unsupported;
        public writeFile = unsupported;
        public exist = unsupported;
        public move = unsupported;
        public copy = unsupported;
        public serveStaticFile = unsupported;
        public listFiles = unsupported;
        public archiveDirectory = unsupported;
        public writeByteArrayAsFile = unsupported;
    }

    return { storage: new ControllableStorage() };
});

vi.mock("../fileSystem", () => ({ fileSystem: storage }));

import { mapsManager } from "../MapsManager";

const DOMAIN = "play.test";
const AUTOSAVE_INTERVAL_MS = 15_000;
const LONG_AFTER_LAST_EDIT_MS = 5 * 60_000;
const RETRY_HORIZON_MS = 60 * 60_000;
const WRITE_TIMEOUT_MS = 5 * 60_000;
const REPLACEMENT_WAIT_MS = 60_000;
const UPLOADED_WAM = JSON.stringify({
    version: "1.0.0",
    mapUrl: "http://play.test/uploaded.tmj",
    entities: {},
    areas: [],
    entityCollections: [],
});

// mapsManager is a process singleton: every test edits its own map.
let mapCount = 0;
let mapKey: string;

function storedWam(key: string): WAMFileFormat | undefined {
    const file = storage.files.get(key);
    return file === undefined ? undefined : (JSON.parse(file) as WAMFileFormat);
}

/** Applies an edit the way MapStorageServer does: lock, load, execute, then record the command. */
async function edit(commandId: string): Promise<void> {
    await mapsManager.waitForLock(mapKey, async () => {
        const wamFile = await mapsManager.getOrLoadWamFile(mapKey);
        await mapsManager.executeCommand(mapKey, DOMAIN, {
            commandId,
            execute: () => {
                wamFile.getWam().metadata = { name: `edited by ${commandId}` };
                return Promise.resolve();
            },
        });
        mapsManager.addCommandToQueue(mapKey, { id: commandId, editMapMessage: undefined });
    });
}

function errorLogsAboutMap(key: string): number {
    return vi.mocked(console.error).mock.calls.filter(([message]) => String(message).includes(key)).length;
}

/** Edits the map, lets its autosave write start and holds that write open; later writes succeed. */
async function editAndHoldItsWrite(commandId: string): Promise<void> {
    await edit(commandId);
    storage.writeMode = "hold";
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    storage.writeMode = "succeed";
}

/** Lets the held writes succeed, most recently started first, and stops holding the following ones. */
async function releaseHeldWritesNewestFirst(): Promise<void> {
    storage.writeMode = "succeed";
    storage.settleHeldWritesNewestFirst("succeed");
    await vi.advanceTimersByTimeAsync(0);
}

describe("MapsManager autosave", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        storage.reset();
        mapKey = `${DOMAIN}/autosave-${++mapCount}.wam`;
        storage.files.set(
            mapKey,
            JSON.stringify({
                version: "1.0.0",
                mapUrl: "http://play.test/map.tmj",
                entities: {},
                areas: [],
                entityCollections: [],
            }),
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("on healthy storage", () => {
        it("should persist the edited map and release it from memory", async () => {
            await edit("cmd-1");

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)).toMatchObject({ lastCommandId: "cmd-1", metadata: { name: "edited by cmd-1" } });
            expect(mapsManager.getLoadedMaps()).not.toContain(mapKey);
            expect((await mapsManager.getOrLoadWamFile(mapKey)).getLastCommandId()).toBe("cmd-1");
        });

        it("should write a map edited once a single time", async () => {
            await edit("cmd-1");

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.writesStarted).toBe(1);
        });

        it("should write a continuously edited map once per autosave interval", async () => {
            for (let second = 0; second <= 60; second += 5) {
                // Edits are applied one after the other, five seconds apart.
                // eslint-disable-next-line no-await-in-loop
                await edit(`cmd-at-${second}s`);
                // eslint-disable-next-line no-await-in-loop
                await vi.advanceTimersByTimeAsync(5_000);
            }

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-at-60s");
            expect(storage.writesStarted).toBe(5);
        });

        it("should persist a change made by a command that only went through the command queue", async () => {
            // Custom entity commands mutate the WAM outside mapsManager.executeCommand, then get queued.
            await mapsManager.waitForLock(mapKey, async () => {
                const wamFile = await mapsManager.getOrLoadWamFile(mapKey);
                wamFile.getWam().metadata = { name: "edited by entity-cmd" };
                mapsManager.addCommandToQueue(mapKey, { id: "entity-cmd", editMapMessage: undefined });
            });

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)).toMatchObject({
                lastCommandId: "entity-cmd",
                metadata: { name: "edited by entity-cmd" },
            });
        });
    });

    describe("when a save fails", () => {
        it("should persist the edit once storage recovers, without waiting for another edit", async () => {
            await edit("cmd-1");
            storage.writeMode = "fail";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            storage.writeMode = "succeed";

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-1");
        });

        it("should keep the unsaved edit in memory after its command history expired", async () => {
            await edit("cmd-1");
            storage.writeMode = "fail";

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect((await mapsManager.getOrLoadWamFile(mapKey)).getLastCommandId()).toBe("cmd-1");
        });

        it("should report the failure, then give up and release the map past the retry horizon", async () => {
            await edit("cmd-1");
            storage.writeMode = "fail";

            await vi.advanceTimersByTimeAsync(RETRY_HORIZON_MS + AUTOSAVE_INTERVAL_MS);
            const attemptsWithinHorizon = storage.writesStarted;
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(console.error).toHaveBeenCalledWith(expect.stringContaining(mapKey), expect.any(Error));
            expect(storage.writesStarted).toBe(attemptsWithinHorizon);
            expect(mapsManager.getLoadedMaps()).not.toContain(mapKey);
        });

        it("should measure the retry horizon from the newest edit, not the first one", async () => {
            await edit("cmd-1");
            storage.writeMode = "fail";
            await vi.advanceTimersByTimeAsync(RETRY_HORIZON_MS - 10_000);
            await edit("cmd-2");
            await vi.advanceTimersByTimeAsync(60_000);
            storage.writeMode = "succeed";

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-2");
        });

        it("should log a failing save on its first attempt and then periodically, not on every attempt", async () => {
            await edit("cmd-1");
            storage.writeMode = "fail";

            await vi.advanceTimersByTimeAsync(10 * 60_000);

            expect(storage.writesStarted).toBe(40);
            expect(errorLogsAboutMap(mapKey)).toBeGreaterThanOrEqual(1);
            expect(errorLogsAboutMap(mapKey)).toBeLessThanOrEqual(3);
        });

        it("should still retry and report the handler error when logging the failure throws", async () => {
            vi.mocked(console.error).mockImplementation((message: unknown) => {
                if (String(message).includes("failed (attempt 1")) {
                    throw new Error("Logger unavailable");
                }
            });
            await edit("cmd-1");
            storage.writeMode = "fail";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            storage.writeMode = "succeed";

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-1");
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining(`Error while handling the save of map ${mapKey}`),
                expect.objectContaining({ message: "Logger unavailable" }),
            );
        });

        it("should stop retrying once the map was replaced or deleted", async () => {
            await edit("cmd-1");
            storage.writeMode = "fail";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            mapsManager.clearAfterUpload(mapKey);
            storage.files.delete(mapKey);
            storage.writeMode = "succeed";

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.files.has(mapKey)).toBe(false);
        });
    });

    describe("when a save is slower than the autosave interval", () => {
        it("should never run two writes of the same map at once", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            await edit("cmd-2");

            await vi.advanceTimersByTimeAsync(2 * AUTOSAVE_INTERVAL_MS);

            expect(storage.maxConcurrentWrites).toBe(1);
        });

        it("should end with the newest edit stored when the first write is the last to finish", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            await edit("cmd-2");
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + 6_000);

            await releaseHeldWritesNewestFirst();
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-2");
        });

        it("should count a write that never settles as failed and retry it", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            storage.writeMode = "succeed";

            await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 2 * AUTOSAVE_INTERVAL_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-1");
        });

        it("should end with the newest edit stored when a write past its timeout lands after its retry", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + WRITE_TIMEOUT_MS);
            await edit("cmd-2");
            storage.writeMode = "succeed";
            // The retry stores cmd-2, then the command history expires while the timed-out write still runs.
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            await releaseHeldWritesNewestFirst();
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-2");
            expect(mapsManager.getLoadedMaps()).not.toContain(mapKey);
        });
    });

    describe("when an edit lands while a save is in flight", () => {
        it("should persist that newer edit with a follow-up write", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            await edit("cmd-2");
            await vi.advanceTimersByTimeAsync(1_000);

            await releaseHeldWritesNewestFirst();
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-2");
        });

        // The held write fails, so this covers retries only: a held write that succeeds after the replacement
        // is covered in "when the map is deleted or replaced while its save is in flight".
        it("should not retry the abandoned state after the map was replaced by an upload", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            await edit("cmd-2");
            mapsManager.clearAfterUpload(mapKey);
            storage.settleHeldWritesNewestFirst("fail");
            storage.files.set(mapKey, "replacement upload");
            storage.writeMode = "succeed";

            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.files.get(mapKey)).toBe("replacement upload");
        });
    });

    // A write handed to storage cannot be cancelled, so the delete and the upload wait for it.
    describe("when the map is deleted or replaced while its save is in flight", () => {
        it("should keep the deleted map deleted when the write in flight lands after the delete", async () => {
            await editAndHoldItsWrite("cmd-1");
            // UploadController.deleteFile.
            const deleting = mapsManager.replaceStoredMaps([mapKey], () => storage.deleteFiles(mapKey));

            await releaseHeldWritesNewestFirst();
            await expect(deleting).resolves.toBe("replaced");
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.files.has(mapKey)).toBe(false);
        });

        it("should keep the uploaded map when the write in flight lands after the upload", async () => {
            await editAndHoldItsWrite("cmd-1");
            // Upload endpoints replace the file, then the back servers relay handleClearAfterUpload.
            const uploading = mapsManager.replaceStoredMaps([mapKey], () =>
                storage.writeStringAsFile(mapKey, UPLOADED_WAM),
            );

            await releaseHeldWritesNewestFirst();
            await expect(uploading).resolves.toBe("replaced");
            mapsManager.clearAfterUpload(mapKey);
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.files.get(mapKey)).toBe(UPLOADED_WAM);
        });

        it("should keep the deleted map deleted when a write past its timeout lands after the delete", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + WRITE_TIMEOUT_MS);
            // The first write timed out and is still held. Its retry succeeds and the map is released.
            storage.writeMode = "succeed";
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);
            const deleting = mapsManager.replaceStoredMaps([mapKey], () => storage.deleteFiles(mapKey));

            await releaseHeldWritesNewestFirst();
            await expect(deleting).resolves.toBe("replaced");

            expect(storage.files.has(mapKey)).toBe(false);
        });

        it("should reject the delete and leave storage unchanged when the write in flight settles after the wait", async () => {
            await editAndHoldItsWrite("cmd-1");
            const deleteFiles = vi.fn(() => storage.deleteFiles(mapKey));
            const deleting = mapsManager.replaceStoredMaps([mapKey], deleteFiles);

            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            await expect(deleting).resolves.toBe("writesInFlight");
            await releaseHeldWritesNewestFirst();
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(deleteFiles).not.toHaveBeenCalled();
            expect(storedWam(mapKey)?.lastCommandId).toBe("cmd-1");
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining(`A write of map ${mapKey} did not settle`),
            );
        });

        it("should keep and save the edit made after the write in flight began when the delete is rejected", async () => {
            await editAndHoldItsWrite("cmd-1");
            await edit("cmd-2");
            const deleting = mapsManager.replaceStoredMaps([mapKey], () => storage.deleteFiles(mapKey));

            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            await expect(deleting).resolves.toBe("writesInFlight");
            expect(mapsManager.getWamFile(mapKey)?.getLastCommandId()).toBe("cmd-2");
            await releaseHeldWritesNewestFirst();
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storedWam(mapKey)).toMatchObject({ lastCommandId: "cmd-2", metadata: { name: "edited by cmd-2" } });
        });

        it("should load the map only once its replacement finished", async () => {
            // No write is in flight, so the replacement drops the map and runs. Its own write of the file is held.
            storage.writeMode = "hold";
            const uploading = mapsManager.replaceStoredMaps([mapKey], () =>
                storage.writeStringAsFile(mapKey, UPLOADED_WAM),
            );
            await vi.advanceTimersByTimeAsync(0);
            let loaded = false;
            const loading = mapsManager.getOrLoadWamFile(mapKey).finally(() => {
                loaded = true;
            });

            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            expect(loaded).toBe(false);
            await releaseHeldWritesNewestFirst();
            await uploading;

            expect((await loading).getWam().mapUrl).toBe("http://play.test/uploaded.tmj");
        });

        it("should give every load that waited for the replacement the same map", async () => {
            storage.writeMode = "hold";
            const uploading = mapsManager.replaceStoredMaps([mapKey], () =>
                storage.writeStringAsFile(mapKey, UPLOADED_WAM),
            );
            await vi.advanceTimersByTimeAsync(0);
            const first = mapsManager.getOrLoadWamFile(mapKey);
            const second = mapsManager.getOrLoadWamFile(mapKey);

            await releaseHeldWritesNewestFirst();
            await uploading;

            expect(await first).toBe(await second);
            expect(mapsManager.getWamFile(mapKey)).toBe(await first);
        });

        it("should not keep a map whose read was in flight when its replacement started", async () => {
            const storedBeforeUpload = storage.files.get(mapKey) ?? "";
            let finishRead = (): void => undefined;
            vi.spyOn(storage, "readFileAsString").mockImplementationOnce(
                () =>
                    new Promise<string>((resolve) => {
                        finishRead = () => resolve(storedBeforeUpload);
                    }),
            );
            const loading = mapsManager.getOrLoadWamFile(mapKey);

            await mapsManager.replaceStoredMaps([mapKey], () => storage.writeStringAsFile(mapKey, UPLOADED_WAM));
            // The read returns the file as it was before the upload, once the upload finished.
            finishRead();

            expect((await loading).getWam().mapUrl).toBe("http://play.test/uploaded.tmj");
        });

        it("should keep the deleted map deleted when an edit arrives while the delete waits", async () => {
            await editAndHoldItsWrite("cmd-1");
            const deleting = mapsManager.replaceStoredMaps([mapKey], () => storage.deleteFiles(mapKey));
            storage.writeMode = "hold";
            const editing = edit("cmd-2").catch(() => undefined);
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);

            // Only the write of cmd-1: a write of cmd-2 started during the wait stays held until after the delete.
            storage.settleOldestHeldWrite("succeed");
            await vi.advanceTimersByTimeAsync(0);
            await releaseHeldWritesNewestFirst();
            await expect(deleting).resolves.toBe("replaced");
            await editing;
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.files.has(mapKey)).toBe(false);
        });

        it("should keep the deleted map deleted when an edit made while the delete waits starts its own write", async () => {
            await edit("cmd-1");
            storage.writeMode = "hold";
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS + WRITE_TIMEOUT_MS);
            // The write of cmd-1 timed out and is still held. Its retry is due in one autosave interval.
            const deleting = mapsManager.replaceStoredMaps([mapKey], () => storage.deleteFiles(mapKey));
            await edit("cmd-2");
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);

            // Only the write of cmd-1: the retry, which carries cmd-2 and started during the wait, stays held.
            storage.settleOldestHeldWrite("succeed");
            await vi.advanceTimersByTimeAsync(0);
            await releaseHeldWritesNewestFirst();
            await expect(deleting).resolves.toBe("replaced");
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(storage.files.has(mapKey)).toBe(false);
        });
    });

    describe("when two replacements of a map overlap", () => {
        it("(known defect) should run the later replacement while the earlier one runs, so the earlier one lands last", async () => {
            storage.writeMode = "hold";
            const first = mapsManager.replaceStoredMaps([mapKey], () => storage.writeStringAsFile(mapKey, "first"));
            await vi.advanceTimersByTimeAsync(0);
            storage.writeMode = "succeed";
            const second = mapsManager.replaceStoredMaps([mapKey], () => storage.writeStringAsFile(mapKey, "second"));
            await vi.advanceTimersByTimeAsync(0);

            await releaseHeldWritesNewestFirst();
            await Promise.all([first, second]);

            expect(storage.files.get(mapKey)).toBe("first");
        });
    });
});
