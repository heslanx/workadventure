/** Small pure helpers of the driver: where the colour frame may be, which presets to run, what a path serves as. */
import { basename, dirname, join, resolve, sep } from "node:path";
import { DEFAULT_PRESET, PRESETS, presetNames } from "./model";

/**
 * Where a whole-map render of a built map may sit, in the order the lab tries: next to the build (preview.png), in
 * fx/, and in the sibling "renders<N>" of a "dist<N>" (the build script writes dist2 and renders2 side by side).
 */
export function frameCandidates(dist: string): string[] {
    const root = resolve(dist);
    const suffix = /^dist(.*)$/.exec(basename(root))?.[1];
    const siblings = suffix === undefined ? [] : [join(dirname(root), `renders${suffix}`, "preview.png")];
    return [join(root, "preview.png"), join(root, "fx", "preview.png"), ...siblings];
}

/** The presets a run covers: "all", one name, or the default one. Throws for a name that does not exist. */
export function presetsToRun(name: string | undefined): string[] {
    if (name === undefined) return [DEFAULT_PRESET];
    if (name === "all") return presetNames();
    if (!(name in PRESETS)) throw new Error(`unknown preset "${name}": ${presetNames().join(", ")}, all`);
    return [name];
}

const TYPES: Readonly<Record<string, string>> = {
    ".png": "image/png",
    ".json": "application/json",
    ".wam": "application/json",
    ".tmj": "application/json",
    ".html": "text/html",
    ".js": "text/javascript",
};

export function contentType(path: string): string {
    const dot = path.lastIndexOf(".");
    return (dot < 0 ? undefined : TYPES[path.slice(dot).toLowerCase()]) ?? "application/octet-stream";
}

/** The file under `root` that a request path names, or null for anything that leaves it (.. and absolute escapes). */
export function safeJoin(root: string, requestPath: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        return null;
    }
    const base = resolve(root);
    const target = resolve(base, `.${decoded.startsWith("/") ? "" : "/"}${decoded}`);
    return target === base || target.startsWith(base + sep) ? target : null;
}

/** "19.3" -> "19-3": a name safe for a directory. */
export function slug(text: string): string {
    return text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
