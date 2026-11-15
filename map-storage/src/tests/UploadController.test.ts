import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import bodyParser from "body-parser";
import ZipStream from "zip-stream";
import type { File } from "unzipper";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WAMFileFormat } from "@workadventure/map-editor";
import type { FileSystemInterface } from "../Upload/FileSystemInterface";
import type { MapListService } from "../Services/MapListService";

// Hoisted above the imports below: EnvironmentVariable exits the process when these are missing, and
// MapsManager binds to the storage singleton when it is imported.
const { storage } = vi.hoisted(() => {
    process.env.API_URL = "http://admin.test";
    process.env.MAP_STORAGE_API_TOKEN = "token";
    process.env.PUSHER_URL = "http://play.test";

    const unsupported = (): never => {
        throw new Error("Not used by these endpoints");
    };

    /**
     * In-memory storage, keyed by storage path, whose WAM writes can be held open. A write only becomes
     * visible in `files` when it is released, as on a real backend.
     */
    class InMemoryStorage implements FileSystemInterface {
        public readonly files = new Map<string, string>();
        private holding = false;
        private heldWrites: (() => void)[] = [];
        private afterNextWamList: (() => void) | undefined;

        public reset(): void {
            this.files.clear();
            this.holding = false;
            this.heldWrites = [];
            this.afterNextWamList = undefined;
        }

        public createWamAfterNextWamList(create: () => void): void {
            this.afterNextWamList = create;
        }

        /** Holds the following writes open until releaseHeldWrites. */
        public holdWrites(): void {
            this.holding = true;
        }

        public releaseHeldWrites(): void {
            this.holding = false;
            for (const release of this.heldWrites.splice(0)) {
                release();
            }
        }

        public readFileAsString(virtualPath: string): Promise<string> {
            const file = this.files.get(virtualPath);
            return file === undefined ? Promise.reject(new Error(`No file at ${virtualPath}`)) : Promise.resolve(file);
        }

        public writeStringAsFile(virtualPath: string, content: string): Promise<void> {
            return new Promise<void>((resolve) => {
                const write = (): void => {
                    this.files.set(virtualPath, content);
                    resolve();
                };
                if (this.holding) {
                    this.heldWrites.push(write);
                } else {
                    write();
                }
            });
        }

        public async writeFile(zipEntry: File, targetFilePath: string): Promise<void> {
            this.files.set(targetFilePath, (await zipEntry.buffer()).toString("utf-8"));
        }

        public deleteFiles(virtualPath: string): Promise<void> {
            this.files.delete(virtualPath);
            return Promise.resolve();
        }

        /** Same selection as S3FileSystem, using the upload's WAM deletion snapshot. */
        public deleteFilesExceptWAM(
            directory: string,
            filesFromZip: string[],
            wamPathsToDelete: readonly string[],
        ): Promise<void> {
            const prefix = directory.endsWith("/") ? directory : `${directory}/`;
            for (const key of [...this.files.keys()].filter((key) => key.startsWith(prefix))) {
                const relativePath = key.slice(prefix.length);
                if (relativePath.includes(".wam")) {
                    if (!wamPathsToDelete.includes(relativePath)) {
                        continue;
                    }
                    if (filesFromZip.includes(relativePath.replace(".wam", ".tmj")) && !filesFromZip.includes(relativePath)) {
                        continue;
                    }
                }
                this.files.delete(key);
            }
            return Promise.resolve();
        }

        public exist(virtualPath: string): Promise<boolean> {
            return Promise.resolve(this.files.has(virtualPath));
        }

        /** Moves every key under the prefix, as a real backend does for a directory. */
        public move(virtualPath: string, newVirtualPath: string): Promise<void> {
            const under = [...this.files.keys()].filter(
                (key) => key === virtualPath || key.startsWith(`${virtualPath}/`),
            );
            if (under.length === 0) {
                return Promise.reject(new Error(`No file at ${virtualPath}`));
            }
            for (const key of under) {
                const moved = `${newVirtualPath}${key.slice(virtualPath.length)}`;
                this.files.set(moved, this.files.get(key) as string);
                this.files.delete(key);
            }
            return Promise.resolve();
        }

        /** Copies every key under the prefix, failing on an existing destination as the disk backend does. */
        public copy(virtualPath: string, newVirtualPath: string): Promise<void> {
            const under = [...this.files.keys()].filter(
                (key) => key === virtualPath || key.startsWith(`${virtualPath}/`),
            );
            if (under.length === 0) {
                return Promise.reject(new Error(`No file at ${virtualPath}`));
            }
            for (const key of under) {
                const copied = `${newVirtualPath}${key.slice(virtualPath.length)}`;
                if (this.files.has(copied)) {
                    return Promise.reject(new Error(`Destination exists: ${copied}`));
                }
            }
            for (const key of under) {
                this.files.set(`${newVirtualPath}${key.slice(virtualPath.length)}`, this.files.get(key) as string);
            }
            return Promise.resolve();
        }

        /** Same listing as S3FileSystem: every key under the prefix, relative to it. */
        public listFiles(virtualDirectory: string, extension?: string): Promise<string[]> {
            const files = [...this.files.keys()]
                .filter((key) => key.startsWith(virtualDirectory))
                .filter((key) => extension === undefined || key.endsWith(extension))
                .map((key) => key.slice(virtualDirectory.length).replace(/^\//, ""));
            if (extension === ".wam" && this.afterNextWamList !== undefined) {
                const create = this.afterNextWamList;
                this.afterNextWamList = undefined;
                create();
            }
            return Promise.resolve(files);
        }

        public serveStaticFile = unsupported;
        public archiveDirectory = unsupported;
        public writeByteArrayAsFile = unsupported;
    }

    return { storage: new InMemoryStorage() };
});

vi.mock("../fileSystem", () => ({ fileSystem: storage }));
vi.mock("../Services/Authentication", () => ({
    passportAuthenticator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../Services/UploadDetector", () => ({
    uploadDetector: { refresh: () => Promise.resolve(), delete: () => Promise.resolve() },
}));

import { mapsManager } from "../MapsManager";
import { UploadController } from "../Upload/UploadController";
import { mapPathUsingDomain } from "../Services/PathMapper";

const DOMAIN = "play.test";
const AUTOSAVE_INTERVAL_MS = 15_000;
const LONG_AFTER_LAST_EDIT_MS = 5 * 60_000;
const REPLACEMENT_WAIT_MS = 60_000;

function wam(name: string): string {
    return JSON.stringify({
        version: "1.0.0",
        mapUrl: `http://play.test/${name}.tmj`,
        entities: {},
        areas: [],
        entityCollections: [],
    });
}

const mapListService = {
    generateCacheFile: () => Promise.resolve(),
    updateWAMFileInCache: () => Promise.resolve(),
} as unknown as MapListService;

let server: Server;
let baseUrl: string;

// mapsManager is a process singleton: every test uses its own directory.
let directoryCount = 0;
let directory: string;

function keyOf(fileName: string): string {
    return mapPathUsingDomain(`${directory}/${fileName}`, DOMAIN);
}

function request(method: string, urlPath: string, body?: RequestInit["body"], contentType?: string): Promise<Response> {
    const headers: Record<string, string> = { "X-Map-Storage-Host": DOMAIN };
    if (contentType !== undefined) {
        headers["Content-Type"] = contentType;
    }
    return fetch(`${baseUrl}${urlPath}`, { method, headers, body });
}

async function zipOf(files: Record<string, string>): Promise<Blob> {
    const archive = new ZipStream();
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise((resolve) => {
        archive.on("end", resolve);
    });
    for (const [name, content] of Object.entries(files)) {
        // Entries are added one after the other, as zip-stream requires.
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve, reject) => {
            archive.entry(content, { name }, (error) => (error ? reject(error) : resolve()));
        });
    }
    archive.finalize();
    await ended;
    return new Blob([Buffer.concat(chunks)]);
}

async function uploadZip(files: Record<string, string>): Promise<Response> {
    const form = new FormData();
    form.append("directory", directory);
    form.append("file", await zipOf(files), "maps.zip");
    return request("POST", "/upload", form);
}

/** Applies an edit the way MapStorageServer does, leaving the map loaded with an unsaved change. */
async function edit(key: string, commandId: string): Promise<void> {
    await mapsManager.waitForLock(key, async () => {
        const wamFile = await mapsManager.getOrLoadWamFile(key);
        await mapsManager.executeCommand(key, DOMAIN, {
            commandId,
            execute: () => {
                wamFile.getWam().metadata = { name: `edited by ${commandId}` };
                return Promise.resolve();
            },
        });
        mapsManager.addCommandToQueue(key, { id: commandId, editMapMessage: undefined });
    });
}

/** The name an edit gave to the stored map, if any. */
function storedName(fileName: string): string | null | undefined {
    const file = storage.files.get(keyOf(fileName));
    return file === undefined ? undefined : (JSON.parse(file) as WAMFileFormat).metadata?.name;
}

/** Lets real I/O (the loopback request) progress while the autosave timers stay frozen. */
async function until(condition: () => boolean): Promise<void> {
    while (!condition()) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
    }
}

describe("UploadController", () => {
    beforeAll(async () => {
        const app = express();
        app.use(bodyParser.json());
        new UploadController(app, storage, mapListService);
        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => {
            server.once("listening", resolve);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    });

    beforeEach(() => {
        // Only the timers of the autosave lifecycle: the loopback request needs the real event loop.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        storage.reset();
        directory = `upload-${++directoryCount}`;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("DELETE of a map whose autosave write is in flight", () => {
        it("should answer 503 and leave storage unchanged when the write does not settle in time", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const deleting = request("DELETE", `/${directory}/a.wam`);
            await until(() => replacing.mock.calls.length > 0);
            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            const response = await deleting;

            expect(response.status).toBe(503);
            expect(response.headers.get("Retry-After")).toBe("60");
            expect(storage.files.get(keyOf("a.wam"))).toBe(wam("a"));
        });

        it("should delete the map once the write landed, and keep it deleted", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const deleting = request("DELETE", `/${directory}/a.wam`);
            await until(() => replacing.mock.calls.length > 0);
            storage.releaseHeldWrites();
            const response = await deleting;
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(204);
            expect(storage.files.has(keyOf("a.wam"))).toBe(false);
        });
    });

    describe("zip upload", () => {
        it("should answer 503 and write nothing when a map of the zip has a write in flight", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            storage.files.set(keyOf("b.wam"), wam("b"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            const before = new Map(storage.files);
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const uploading = uploadZip({ "a.wam": wam("a-uploaded"), "c.wam": wam("c-uploaded") });
            await until(() => replacing.mock.calls.length > 0);
            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            const response = await uploading;

            expect(response.status).toBe(503);
            expect(storage.files).toEqual(before);
        });

        it("should answer 503 and write nothing when a map the zip deletes has a write in flight", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            const before = new Map(storage.files);
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const uploading = uploadZip({ "b.wam": wam("b") });
            await until(() => replacing.mock.calls.length > 0);
            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            const response = await uploading;

            expect(response.status).toBe(503);
            expect(storage.files).toEqual(before);
        });

        it("should keep a map the zip deleted deleted when it had an unsaved edit", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");

            const response = await uploadZip({ "b.wam": wam("b") });
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(200);
            expect(storage.files.has(keyOf("a.wam"))).toBe(false);
            expect(storage.files.get(keyOf("b.wam"))).toBe(wam("b"));
        });

        it("should not delete a WAM created after the upload's deletion snapshot", async () => {
            storage.createWamAfterNextWamList(() => storage.files.set(keyOf("created-during-upload.wam"), wam("created")));

            const response = await uploadZip({ "b.wam": wam("b") });

            expect(response.status).toBe(200);
            expect(storage.files.get(keyOf("created-during-upload.wam"))).toBe(wam("created"));
            expect(storage.files.get(keyOf("b.wam"))).toBe(wam("b"));
        });

        it("should not let a pending autosave overwrite a WAM generated from the uploaded TMJ", async () => {
            storage.files.set(keyOf("maps/a.wam"), wam("a"));
            await edit(keyOf("maps/a.wam"), "cmd-1");
            storage.files.delete(keyOf("maps/a.wam"));
            const tiledMap = JSON.parse(
                readFileSync(new URL("../../tests/assets/maps/empty.tmj", import.meta.url), "utf8"),
            ) as {
                properties: { name: string; type: string; value: string | boolean }[];
                tilesets: { image: string }[];
            };
            tiledMap.tilesets[0].image = "../assets/tileset1.png";
            tiledMap.properties.push({ name: "mapName", type: "string", value: "generated from zip" });

            const response = await uploadZip({
                "maps/a.tmj": JSON.stringify(tiledMap),
                "maps/empty.js": "",
                "assets/tileset1.png": "",
            });
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(200);
            expect(storedName("maps/a.wam")).toBe("generated from zip");
        });
    });

    describe("POST /move of a map", () => {
        it("should move the map with its unsaved edit, and not recreate it at its old path", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");

            const response = await request(
                "POST",
                "/move",
                JSON.stringify({ source: `${directory}/a.wam`, destination: `${directory}/b.wam` }),
                "application/json",
            );
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(200);
            expect(storedName("b.wam")).toBe("edited by cmd-1");
            expect(storage.files.has(keyOf("a.wam"))).toBe(false);
        });

        it("should move the map with an edit made while the write of an earlier edit was in flight", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
            await edit(keyOf("a.wam"), "cmd-2");
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const moving = request(
                "POST",
                "/move",
                JSON.stringify({ source: `${directory}/a.wam`, destination: `${directory}/b.wam` }),
                "application/json",
            );
            await until(() => replacing.mock.calls.length > 0);
            storage.releaseHeldWrites();
            const response = await moving;
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(200);
            expect(storedName("b.wam")).toBe("edited by cmd-2");
            expect(storage.files.has(keyOf("a.wam"))).toBe(false);
        });

        it("should answer 503 and keep the map and its edit when the save of the edit does not settle in time", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const moving = request(
                "POST",
                "/move",
                JSON.stringify({ source: `${directory}/a.wam`, destination: `${directory}/b.wam` }),
                "application/json",
            );
            await until(() => replacing.mock.calls.length > 0);
            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            const response = await moving;
            storage.releaseHeldWrites();
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(503);
            expect(storedName("a.wam")).toBe("edited by cmd-1");
            expect(storage.files.has(keyOf("b.wam"))).toBe(false);
        });

        it("should answer 409 when the destination appeared while the move waited for a write", async () => {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const first = request(
                "POST",
                "/move",
                JSON.stringify({ source: `${directory}/a.wam`, destination: `${directory}/b.wam` }),
                "application/json",
            );
            await until(() => replacing.mock.calls.length > 0);
            // A second request writes the destination while the first one waits.
            storage.files.set(keyOf("b.wam"), wam("b"));
            storage.releaseHeldWrites();
            const response = await first;
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(409);
            expect(storage.files.get(keyOf("b.wam"))).toBe(wam("b"));
            expect(storedName("a.wam")).toBe("edited by cmd-1");
        });
    });

    describe("POST /move of a directory that holds maps", () => {
        it("should hold the maps under it, so a moved map with an unsaved edit is not saved back at its old path", async () => {
            storage.files.set(keyOf("inner/a.wam"), wam("a"));
            await edit(keyOf("inner/a.wam"), "cmd-1");
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const response = await request(
                "POST",
                "/move",
                JSON.stringify({ source: `${directory}/inner`, destination: `${directory}/moved` }),
                "application/json",
            );
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(200);
            expect(replacing).toHaveBeenCalledWith(
                expect.arrayContaining([keyOf("inner/a.wam")]),
                expect.any(Function),
                { saveFirst: [keyOf("inner/a.wam")] },
            );
            expect(storedName("inner/a.wam")).toBeUndefined();
            expect(storedName("moved/a.wam")).toBe("edited by cmd-1");
        });
    });

    describe("POST /copy of a directory that holds maps", () => {
        it("should hold the maps under it, so a loaded dirty map is not saved back over the copy", async () => {
            storage.files.set(keyOf("inner/a.wam"), wam("a"));
            await edit(keyOf("inner/a.wam"), "cmd-1");
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const response = await request(
                "POST",
                "/copy",
                JSON.stringify({ source: `${directory}/inner`, destination: `${directory}/copied` }),
                "application/json",
            );
            await vi.advanceTimersByTimeAsync(LONG_AFTER_LAST_EDIT_MS);

            expect(response.status).toBe(201);
            expect(replacing).toHaveBeenCalledWith(
                expect.arrayContaining([keyOf("inner/a.wam")]),
                expect.any(Function),
            );
            expect(storage.files.has(keyOf("copied/a.wam"))).toBe(true);
        });
    });

    describe("the temporary file Multer stored the upload in", () => {
        let uploads: string;

        beforeEach(() => {
            uploads = mkdtempSync(path.join(tmpdir(), "uploads-"));
            // Multer stores each upload in os.tmpdir(), which reads TMPDIR on every call.
            vi.stubEnv("TMPDIR", uploads);
        });

        afterEach(() => {
            vi.unstubAllEnvs();
            rmSync(uploads, { recursive: true, force: true });
        });

        /** Starts an autosave write of a.wam and holds it open. */
        async function holdAWriteOfA(): Promise<void> {
            storage.files.set(keyOf("a.wam"), wam("a"));
            await edit(keyOf("a.wam"), "cmd-1");
            storage.holdWrites();
            await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
        }

        it("should be deleted when the zip upload answers 503", async () => {
            await holdAWriteOfA();
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");

            const uploading = uploadZip({ "a.wam": wam("a-uploaded") });
            await until(() => replacing.mock.calls.length > 0);
            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            const response = await uploading;
            await until(() => readdirSync(uploads).length === 0);

            expect(response.status).toBe(503);
        });

        it("should be deleted when the PUT of a map answers 503", async () => {
            await holdAWriteOfA();
            const replacing = vi.spyOn(mapsManager, "replaceStoredMaps");
            const form = new FormData();
            form.append("file", new Blob([wam("a-uploaded")]), "a.wam");

            const uploading = request("PUT", `/${directory}/a.wam`, form);
            await until(() => replacing.mock.calls.length > 0);
            await vi.advanceTimersByTimeAsync(REPLACEMENT_WAIT_MS);
            const response = await uploading;
            await until(() => readdirSync(uploads).length === 0);

            expect(response.status).toBe(503);
        });

        it("should be deleted when the zip upload succeeds", async () => {
            const response = await uploadZip({ "a.wam": wam("a") });
            await until(() => readdirSync(uploads).length === 0);

            expect(response.status).toBe(200);
        });

        it("should be deleted when the zip upload is rejected", async () => {
            const form = new FormData();
            form.append("directory", "../elsewhere");
            form.append("file", await zipOf({ "a.wam": wam("a") }), "maps.zip");

            const response = await request("POST", "/upload", form);
            await until(() => readdirSync(uploads).length === 0);

            expect(response.status).toBe(400);
        });

        it("should be deleted when the zip upload fails", async () => {
            const form = new FormData();
            form.append("directory", directory);
            form.append("file", new Blob(["not a zip"]), "maps.zip");

            const response = await request("POST", "/upload", form);
            await until(() => readdirSync(uploads).length === 0);

            expect(response.status).toBe(500);
        });
    });
});
