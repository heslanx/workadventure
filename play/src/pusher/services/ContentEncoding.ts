import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import type { Request, Response } from "express";

/**
 * Content codings the pusher can answer with, from the most to the least preferred. The order breaks ties between
 * codings the client rates equally.
 */
export const CONTENT_ENCODINGS = ["br", "gzip"] as const;
export type ContentEncoding = (typeof CONTENT_ENCODINGS)[number];

/** The suffix of the file the build writes next to the original for each coding. */
export const ENCODING_FILE_SUFFIX: Record<ContentEncoding, string> = { br: ".br", gzip: ".gz" };

/**
 * Extensions of the files whose bytes shrink with Brotli or gzip. The build writes a sibling for these and the
 * server looks for one. Images, video, audio and WOFF2 are already compressed and are left out on purpose.
 */
export const COMPRESSIBLE_EXTENSIONS: ReadonlySet<string> = new Set([
    ".js",
    ".mjs",
    ".css",
    ".svg",
    ".json",
    ".webmanifest",
    ".xml",
    ".html",
    ".htm",
    ".txt",
    ".map",
    ".wasm",
    ".ttf",
    ".otf",
]);

/** Extensions whose bytes are text: Brotli's text mode helps on them and hurts on a binary such as WASM. */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(
    [...COMPRESSIBLE_EXTENSIONS].filter((extension) => ![".wasm", ".ttf", ".otf"].includes(extension)),
);

/**
 * The quality of each coding in an Accept-Encoding header (RFC 9110, 12.5.3), by lowercase token. A missing "q" is 1
 * and an unreadable one is 0.
 */
export function parseAcceptEncoding(header: string | undefined): Map<string, number> {
    const qualities = new Map<string, number>();
    for (const part of (header ?? "").split(",")) {
        const [token, ...parameters] = part.split(";").map((piece) => piece.trim());
        if (!token) {
            continue;
        }
        let quality = 1;
        for (const parameter of parameters) {
            const match = /^q\s*=\s*(.*)$/i.exec(parameter);
            if (match) {
                // A "q" that is not a number ("q=", "q=abc", "q=-1") is not a quality the client can mean: do not
                // offer that coding. A number above 1 counts as 1.
                quality = /^\d+(?:\.\d+)?$/.test(match[1]) ? Math.min(1, Number(match[1])) : 0;
            }
        }
        qualities.set(token.toLowerCase(), quality);
    }
    return qualities;
}

/**
 * The coding to answer with among the ones available, or undefined to send the file as it is: no header, an
 * identity-only header, or every available coding refused with "q=0". The "*" wildcard speaks for the codings the
 * header does not name.
 */
export function negotiateEncoding(
    header: string | undefined,
    available: readonly ContentEncoding[] = CONTENT_ENCODINGS,
): ContentEncoding | undefined {
    const qualities = parseAcceptEncoding(header);
    if (qualities.size === 0) {
        return undefined;
    }
    let best: ContentEncoding | undefined;
    let bestQuality = 0;
    // CONTENT_ENCODINGS is ordered by preference, and only a strictly better quality replaces the current choice.
    for (const encoding of CONTENT_ENCODINGS) {
        if (!available.includes(encoding)) {
            continue;
        }
        const quality =
            qualities.get(encoding) ??
            (encoding === "gzip" ? qualities.get("x-gzip") : undefined) ??
            qualities.get("*") ??
            0;
        if (quality > bestQuality) {
            best = encoding;
            bestQuality = quality;
        }
    }
    return best;
}

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * Sends a document that is built for each request (the templated index.html) with the coding the client prefers.
 * A 10 KB page costs about 0.1 ms to compress, which is below the time the template takes to render.
 *
 * Pass `compress: false` for a response that mixes a secret with text the requester controls: compressing it would
 * leak the secret through its length (BREACH).
 */
export async function sendDocument(
    req: Request,
    res: Response,
    body: string,
    options: { compress?: boolean } = {},
): Promise<void> {
    res.vary("Accept-Encoding");
    const encoding = options.compress === false ? undefined : negotiateEncoding(req.header("Accept-Encoding"));
    if (encoding === undefined) {
        res.send(body);
        return;
    }
    const bytes = Buffer.from(body, "utf8");
    const compressed =
        encoding === "br"
            ? await brotliCompressAsync(bytes, {
                  params: {
                      // Quality 4 compresses a page within a fraction of a millisecond; 11 would take tens of them.
                      [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
                      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
                      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
                  },
              })
            : await gzipAsync(bytes, { level: 6 });
    if (compressed.length >= bytes.length) {
        res.send(body);
        return;
    }
    res.set("Content-Encoding", encoding);
    res.send(compressed);
}
