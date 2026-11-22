import { constants, createBrotliCompress, createGzip } from "zlib";
import type { BrotliCompress, Gzip } from "zlib";
import * as path from "path";
import type { NextFunction, Request, Response } from "express";
import { mime } from "../Services/Mime";

/**
 * Compresses the text files map-storage serves (maps, collections, scripts...) on their way out.
 *
 * It is a middleware instead of a step of each storage back end: the disk and the S3 back ends both end up writing
 * the file to the response, so one wrapper around the response covers both, and a file is stored once, as uploaded
 * (what the editor, the zip export and the map list read).
 *
 * Only `zlib` is used. Brotli comes first, at a quality made for on-the-fly work (5 compresses a 2.4 MB JSON in a
 * fraction of a second; 11 would take seconds and block the answer), then gzip.
 */

export type ContentEncoding = "br" | "gzip";

/** In order of preference when the client weighs them the same. */
const SUPPORTED_ENCODINGS: readonly ContentEncoding[] = ["br", "gzip"];

const BROTLI_QUALITY = 5;
const GZIP_LEVEL = 6;
/** Under this size, the headers and the encoder cost more than they save. */
const MIN_COMPRESSIBLE_BYTES = 1024;

const COMPRESSIBLE_TYPES = new Set([
    "application/json",
    "application/xml",
    "application/javascript",
    "text/javascript",
    "text/xml",
    "text/css",
    "text/html",
    "text/plain",
    "image/svg+xml",
]);

export function isCompressibleContentType(contentType: string | undefined): boolean {
    if (!contentType) {
        return false;
    }
    const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    return COMPRESSIBLE_TYPES.has(type) || type.endsWith("+json") || type.endsWith("+xml");
}

/**
 * The encoding to answer an Accept-Encoding header with: the best weighted one we support, `br` before `gzip` on a
 * tie. An encoding weighted 0 is refused, `*` stands for the ones that are not named. No match: undefined (identity).
 */
export function negotiateEncoding(acceptEncoding: string | undefined): ContentEncoding | undefined {
    if (!acceptEncoding) {
        return undefined;
    }
    const weights = new Map<string, number>();
    for (const part of acceptEncoding.split(",")) {
        const [name, ...parameters] = part.split(";");
        const coding = name?.trim().toLowerCase();
        if (!coding) {
            continue;
        }
        let weight = 1;
        for (const parameter of parameters) {
            const match = /^\s*q\s*=\s*(\d*\.?\d+)\s*$/i.exec(parameter);
            if (match?.[1] !== undefined) {
                weight = Number(match[1]);
            }
        }
        weights.set(coding, weight);
    }

    let best: ContentEncoding | undefined;
    let bestWeight = 0;
    for (const encoding of SUPPORTED_ENCODINGS) {
        const weight = weights.get(encoding) ?? weights.get("*") ?? 0;
        if (weight > bestWeight) {
            best = encoding;
            bestWeight = weight;
        }
    }
    return best;
}

function appendVary(res: Response, field: string): void {
    const current = res.getHeader("Vary");
    const values = (Array.isArray(current) ? current.join(",") : String(current ?? ""))
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "");
    if (values.includes("*") || values.some((value) => value.toLowerCase() === field.toLowerCase())) {
        return;
    }
    res.setHeader("Vary", [...values, field].join(", "));
}

/** A compressed body is not byte-identical to the file, so its validator must be weak. */
function weakenEtag(res: Response): void {
    const etag = res.getHeader("ETag");
    if (typeof etag === "string" && !etag.startsWith("W/")) {
        res.setHeader("ETag", `W/${etag}`);
    }
}

type RawWrite = (chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => boolean;
type RawEnd = (chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown) => Response;

/**
 * The type the file is served with. A 304 has none when `send` answered it (it drops the `Content-*` headers), so
 * the extension decides there, the same way both back ends pick their Content-Type.
 */
function servedContentType(req: Request, res: Response): string | undefined {
    const header = res.getHeader("Content-Type");
    if (typeof header === "string") {
        return header;
    }
    return mime.getType(path.extname(req.path)) ?? undefined;
}

/** A request can cross several routes that all carry the middleware: the response is wrapped once. */
const wrappedResponses = new WeakSet<Response>();

export function compressFiles(req: Request, res: Response, next: NextFunction): void {
    if ((req.method !== "GET" && req.method !== "HEAD") || wrappedResponses.has(res)) {
        next();
        return;
    }
    wrappedResponses.add(res);

    const encoding = negotiateEncoding(req.get("Accept-Encoding"));
    // Called back with the response as `this`, below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const rawWriteHead = res.writeHead as (statusCode: number, ...args: unknown[]) => Response;
    const rawWrite = res.write.bind(res) as RawWrite;
    const rawEnd = res.end.bind(res) as RawEnd;
    let encoder: BrotliCompress | Gzip | undefined;
    /** The file size, when the back end told it: lets Brotli size its window. */
    let sizeHint = 0;

    /** Decides, once, just before the headers go out. Returns the encoding to apply to the body, if any. */
    function decide(): ContentEncoding | undefined {
        // Errors, 206 (Range) and redirects are left as they are; a 304 only needs the validators of a 200.
        if (res.statusCode !== 200 && res.statusCode !== 304) {
            return undefined;
        }
        if (!isCompressibleContentType(servedContentType(req, res))) {
            return undefined;
        }
        // Whatever the client accepts, the answer depends on it.
        appendVary(res, "Accept-Encoding");

        if (!encoding || req.headers.range !== undefined || res.getHeader("Content-Encoding") !== undefined) {
            return undefined;
        }
        if (/(^|,)\s*no-transform\s*(,|$)/i.test(String(res.getHeader("Cache-Control") ?? ""))) {
            return undefined;
        }
        const length = Number(res.getHeader("Content-Length"));
        if (res.getHeader("Content-Length") !== undefined && length < MIN_COMPRESSIBLE_BYTES) {
            return undefined;
        }

        weakenEtag(res);
        sizeHint = Number.isFinite(length) ? length : 0;
        if (res.statusCode === 304) {
            return undefined;
        }
        res.setHeader("Content-Encoding", encoding);
        res.removeHeader("Content-Length");
        res.removeHeader("Accept-Ranges");
        return encoding;
    }

    function startEncoder(chosen: ContentEncoding): void {
        encoder =
            chosen === "br"
                ? createBrotliCompress({
                      params: {
                          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
                          [constants.BROTLI_PARAM_SIZE_HINT]: sizeHint,
                      },
                  })
                : createGzip({ level: GZIP_LEVEL });
        const stream = encoder;
        stream.on("data", (chunk: Buffer) => {
            if (!rawWrite(chunk)) {
                stream.pause();
            }
        });
        stream.on("drain", () => res.emit("drain"));
        stream.on("end", () => {
            rawEnd();
        });
        stream.on("error", (error) => {
            res.destroy(error);
        });
        // One more "close" listener on the response (see S3FileSystem.serveStaticFile, which counts them).
        res.setMaxListeners(res.getMaxListeners() + 2);
        res.on("drain", () => stream.resume());
        res.once("close", () => stream.destroy());
    }

    res.writeHead = function (this: Response, statusCode: number, ...args: unknown[]): Response {
        res.writeHead = rawWriteHead;
        // Headers handed to writeHead win over setHeader: make them visible to decide().
        const last = args[args.length - 1];
        if (last !== null && typeof last === "object") {
            const entries: [unknown, unknown][] = [];
            if (Array.isArray(last)) {
                for (let i = 0; i + 1 < last.length; i += 2) {
                    entries.push([last[i], last[i + 1]]);
                }
            } else {
                entries.push(...Object.entries(last));
            }
            for (const [name, value] of entries) {
                res.setHeader(String(name), value as string);
            }
            args.pop();
        }
        res.statusCode = statusCode;
        const chosen = decide();
        if (chosen && req.method === "GET") {
            startEncoder(chosen);
        }
        return rawWriteHead.call(this, statusCode, ...args);
    } as typeof res.writeHead;

    res.write = function (chunk: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean {
        if (!res.headersSent) {
            res.writeHead(res.statusCode);
        }
        if (encoder) {
            return encoder.write(chunk, encodingOrCallback as BufferEncoding, callback as () => void);
        }
        return rawWrite(chunk, encodingOrCallback, callback);
    } as typeof res.write;

    res.end = function (chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown): Response {
        if (!res.headersSent) {
            res.writeHead(res.statusCode);
        }
        if (encoder) {
            const done = [encodingOrCallback, callback].find((arg) => typeof arg === "function") as
                | (() => void)
                | undefined;
            if (done) {
                res.once("finish", done);
            }
            if (typeof chunk === "function") {
                res.once("finish", chunk as () => void);
                encoder.end();
            } else if (chunk !== undefined && chunk !== null) {
                if (typeof encodingOrCallback === "string") {
                    encoder.end(chunk, encodingOrCallback as BufferEncoding);
                } else {
                    encoder.end(chunk);
                }
            } else {
                encoder.end();
            }
            return res;
        }
        return rawEnd(chunk, encodingOrCallback, callback);
    } as typeof res.end;

    next();
}
