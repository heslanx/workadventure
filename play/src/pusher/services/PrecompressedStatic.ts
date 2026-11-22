import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import {
    COMPRESSIBLE_EXTENSIONS,
    CONTENT_ENCODINGS,
    ENCODING_FILE_SUFFIX,
    negotiateEncoding,
    type ContentEncoding,
} from "./ContentEncoding";

type StaticOptions = NonNullable<Parameters<typeof express.static>[1]>;

interface Served {
    encoding: ContentEncoding;
    originalPath: string;
    originalModified: Date;
}

const SERVED = Symbol("precompressedStatic");

/**
 * The absolute path of the file a request path names inside `root`, or undefined when the path is not a plain
 * file path: a "." or ".." segment (also written %2e), a hidden file, a NUL or a backslash. Those requests are
 * left to express.static, which answers them (or refuses them) on its own.
 */
export function resolveInsideRoot(root: string, requestPath: string): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        return undefined;
    }
    if (decoded.includes("\0") || decoded.includes("\\")) {
        return undefined;
    }
    const segments = decoded.split("/").filter((segment) => segment !== "");
    if (segments.length === 0 || segments.some((segment) => segment.startsWith("."))) {
        return undefined;
    }
    const file = path.join(root, ...segments);
    return file.startsWith(root + path.sep) ? file : undefined;
}

async function statFile(file: string): Promise<fs.Stats | undefined> {
    try {
        const stats = await fs.promises.stat(file);
        return stats.isFile() ? stats : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Replaces express.static for a folder of a build whose compressible files have a ".br" and a ".gz" sibling
 * (play/vite/precompress.ts). A GET or HEAD for such a file is answered with the sibling the client accepts; every
 * other request goes to a plain express.static with the same options.
 *
 * The sibling is served by express.static itself, from the sibling's path, so the cache headers (maxAge,
 * immutable, ...) and the conditional-request behaviour are the ones the original would have had. Only three
 * things change: Content-Type stays the original's, Content-Encoding is set, and the ETag carries the coding so
 * that two codings of one URL never share a validator. A Range request is answered from the original file, with no
 * coding, so a coded answer says "Accept-Ranges: none".
 */
export function precompressedStatic(rootDirectory: string, options: StaticOptions = {}): RequestHandler {
    const root = path.resolve(rootDirectory);
    const plain = express.static(root, options);
    const encoded = express.static(root, {
        ...options,
        setHeaders(res, filePath, stat) {
            options.setHeaders?.(res, filePath, stat);
            const served = (res as Response & { [SERVED]?: Served })[SERVED];
            if (!served) {
                return;
            }
            // express.static types the file from its extension, which here is ".br" or ".gz".
            res.type(path.extname(served.originalPath));
            res.setHeader("Content-Encoding", served.encoding);
            res.setHeader("Last-Modified", served.originalModified.toUTCString());
            // A Range request never reaches this handler (see below): it is answered from the original file. A coded
            // answer must not invite one, since the offsets of the two representations differ.
            res.setHeader("Accept-Ranges", "none");
            if (options.etag !== false) {
                // express.static sets its ETag after this callback and only when none is set: it is the same weak
                // "size-mtime" tag as for any file, plus the coding so that two codings never share a validator.
                const tag = `${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}-${served.encoding}`;
                res.setHeader("ETag", `W/"${tag}"`);
            }
        },
    });

    return (req: Request, res: Response, next: NextFunction): void => {
        serve(req, res, next).catch(next);
    };

    async function serve(req: Request, res: Response, next: NextFunction): Promise<void> {
        if (req.method !== "GET" && req.method !== "HEAD") {
            plain(req, res, next);
            return;
        }
        const originalPath = resolveInsideRoot(root, req.path);
        if (originalPath === undefined || !COMPRESSIBLE_EXTENSIONS.has(path.extname(originalPath).toLowerCase())) {
            plain(req, res, next);
            return;
        }
        const original = await statFile(originalPath);
        if (!original) {
            plain(req, res, next);
            return;
        }
        const siblings = await Promise.all(
            CONTENT_ENCODINGS.map(async (encoding) => {
                const stats = await statFile(originalPath + ENCODING_FILE_SUFFIX[encoding]);
                // The build only keeps a sibling that is smaller; this guards a stray larger one.
                return stats && stats.size < original.size ? encoding : undefined;
            }),
        );
        const available = siblings.filter((encoding): encoding is ContentEncoding => encoding !== undefined);
        if (available.length === 0) {
            plain(req, res, next);
            return;
        }

        // Both answers depend on Accept-Encoding, including the uncompressed one and a Range one.
        res.vary("Accept-Encoding");
        const encoding = req.headers.range ? undefined : negotiateEncoding(req.header("Accept-Encoding"), available);
        if (encoding === undefined) {
            plain(req, res, next);
            return;
        }

        (res as Response & { [SERVED]?: Served })[SERVED] = {
            encoding,
            originalPath,
            originalModified: original.mtime,
        };
        const originalUrl = req.url;
        req.url = req.path + ENCODING_FILE_SUFFIX[encoding] + originalUrl.slice(req.path.length);
        encoded(req, res, (error?: unknown) => {
            // The sibling vanished between the stat and the read, or express.static failed: undo the rewrite.
            req.url = originalUrl;
            delete (res as Response & { [SERVED]?: Served })[SERVED];
            if (error) {
                next(error);
                return;
            }
            plain(req, res, next);
        });
    }
}
