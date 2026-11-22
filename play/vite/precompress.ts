import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import type { Plugin } from "vite";
import {
    COMPRESSIBLE_EXTENSIONS,
    CONTENT_ENCODINGS,
    ENCODING_FILE_SUFFIX,
    TEXT_EXTENSIONS,
    type ContentEncoding,
} from "../src/pusher/services/ContentEncoding";

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** A file smaller than this is not worth a sibling: the saving is a fraction of one TCP segment. */
export const MIN_COMPRESSIBLE_BYTES = 1024;

/**
 * Brotli quality 11 is for what a visitor downloads on the way in. Above this size it costs seconds per file for a
 * few percent (MEASURED on the audio worklet bundle, 5.8 MB: quality 9 takes 1.6 s and 3.98 MB, quality 11 takes
 * 7.1 s and 3.95 MB), so a file this large gets BROTLI_QUALITY_LARGE.
 */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;
export const BROTLI_QUALITY_SMALL = zlibConstants.BROTLI_MAX_QUALITY;
export const BROTLI_QUALITY_LARGE = 9;

/** The Brotli quality of a file: source maps are only fetched by devtools and Sentry, so they never get the slow one. */
export function brotliQualityFor(extension: string, size: number): number {
    return extension === ".map" || size >= LARGE_FILE_BYTES ? BROTLI_QUALITY_LARGE : BROTLI_QUALITY_SMALL;
}

export interface EncodingTotals {
    /** Files that got a sibling for this coding because it is smaller than the original. */
    kept: number;
    /** Size of the eligible files as they are. */
    bytesBefore: number;
    /** What the eligible files weigh when the sibling is sent where there is one: the original size where there is none. */
    bytesAfter: number;
}

export interface PrecompressSummary {
    /** Compressible files of the output that are at least MIN_COMPRESSIBLE_BYTES long. */
    files: number;
    bytesBefore: number;
    br: EncodingTotals;
    gzip: EncodingTotals;
}

async function* walk(directory: string): AsyncGenerator<string> {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walk(entryPath);
        } else if (entry.isFile()) {
            yield entryPath;
        }
    }
}

function compress(encoding: ContentEncoding, content: Buffer, extension: string): Promise<Buffer> {
    if (encoding === "br") {
        return brotliCompressAsync(content, {
            params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQualityFor(extension, content.length),
                [zlibConstants.BROTLI_PARAM_MODE]: TEXT_EXTENSIONS.has(extension)
                    ? zlibConstants.BROTLI_MODE_TEXT
                    : zlibConstants.BROTLI_MODE_GENERIC,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: content.length,
                // The largest window every browser decodes: it helps on the multi-megabyte bundles and source maps.
                [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
            },
        });
    }
    return gzipAsync(content, { level: zlibConstants.Z_BEST_COMPRESSION, memLevel: zlibConstants.Z_MAX_MEMLEVEL });
}

/**
 * How many files are compressed at once. Brotli and gzip run on libuv's threadpool, which has UV_THREADPOOL_SIZE
 * threads (4 by default) and can only be resized before Node starts: more workers than threads would only queue.
 */
export function defaultConcurrency(
    threadpoolSize: string | undefined = process.env.UV_THREADPOOL_SIZE,
    processors: number = os.availableParallelism(),
): number {
    const threads = Number(threadpoolSize) || 4;
    return Math.max(1, Math.min(threads, processors));
}

/**
 * Writes `<file>.br` and `<file>.gz` next to every compressible file of `directory`, keeping a sibling only when it
 * is smaller than the original (and removing a stale one otherwise, also for a file now too small to be worth one).
 * Siblings take the original's modification time.
 */
export async function precompressDirectory(
    directory: string,
    concurrency = defaultConcurrency(),
): Promise<PrecompressSummary> {
    const summary: PrecompressSummary = {
        files: 0,
        bytesBefore: 0,
        br: { kept: 0, bytesBefore: 0, bytesAfter: 0 },
        gzip: { kept: 0, bytesBefore: 0, bytesAfter: 0 },
    };
    const candidates: string[] = [];
    for await (const file of walk(directory)) {
        const extension = path.extname(file).toLowerCase();
        // A ".br" or ".gz" is never in COMPRESSIBLE_EXTENSIONS, so a sibling of a previous run is never compressed again.
        if (COMPRESSIBLE_EXTENSIONS.has(extension)) {
            candidates.push(file);
        }
    }

    const compressFile = async (file: string): Promise<void> => {
        const stats = await fs.promises.stat(file);
        if (stats.size < MIN_COMPRESSIBLE_BYTES) {
            // The file may have shrunk since an earlier run over the same folder: its old siblings would be served
            // under its URL, as long as they are smaller than it.
            await Promise.all(
                CONTENT_ENCODINGS.map((encoding) =>
                    fs.promises.rm(file + ENCODING_FILE_SUFFIX[encoding], { force: true }),
                ),
            );
            return;
        }
        const content = await fs.promises.readFile(file);
        const extension = path.extname(file).toLowerCase();
        summary.files += 1;
        summary.bytesBefore += stats.size;
        // One coding after the other: a worker is then one task on the threadpool, not two.
        for (const encoding of CONTENT_ENCODINGS) {
            const sibling = file + ENCODING_FILE_SUFFIX[encoding];
            // eslint-disable-next-line no-await-in-loop
            const compressed = await compress(encoding, content, extension);
            const totals = summary[encoding];
            totals.bytesBefore += stats.size;
            if (compressed.length < stats.size) {
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.writeFile(sibling, compressed);
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.utimes(sibling, stats.atime, stats.mtime);
                totals.kept += 1;
                totals.bytesAfter += compressed.length;
            } else {
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.rm(sibling, { force: true });
                totals.bytesAfter += stats.size;
            }
        }
    };

    // A few workers take files from one queue, the largest first so that the last file to start is a small one.
    // Brotli at a high quality is slow, and a file is in memory only while it is compressed.
    const sizes = new Map(
        await Promise.all(candidates.map(async (file) => [file, (await fs.promises.stat(file)).size] as const)),
    );
    const queue = [...candidates].sort((a, b) => (sizes.get(a) ?? 0) - (sizes.get(b) ?? 0));
    const worker = async (): Promise<void> => {
        for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
            // eslint-disable-next-line no-await-in-loop
            await compressFile(file);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return summary;
}

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2) + " MB";

export function formatSummary(summary: PrecompressSummary): string {
    const part = (name: string, totals: EncodingTotals): string =>
        `${name} ${totals.kept} kept, ${megabytes(totals.bytesBefore)} -> ${megabytes(totals.bytesAfter)}`;
    return `[precompress] ${summary.files} files, ${megabytes(summary.bytesBefore)}: ${part("br", summary.br)}; ${part("gzip", summary.gzip)}`;
}

/**
 * At the end of `vite build`, writes the Brotli and gzip siblings the pusher serves (see PrecompressedStatic.ts).
 * It runs after every other plugin so that the public files and the source maps are in the output, and before the
 * Docker image copies it.
 */
export function precompressPlugin(): Plugin {
    let outDirectory = "";
    return {
        name: "workadventure-precompress",
        apply: "build",
        enforce: "post",
        configResolved(config) {
            outDirectory = path.resolve(config.root, config.build.outDir);
        },
        writeBundle: {
            order: "post",
            async handler() {
                const summary = await precompressDirectory(outDirectory);
                console.info(formatSummary(summary));
            },
        },
    };
}
