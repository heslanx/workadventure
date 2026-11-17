// The sections of the preferences dialog, in the order of its list (owner, 19/10/2026: the source's dialog, "Preferências"
// above and "Você" below). Pets and the view modes of the source are not here: nothing in this client draws them yet.

export const PANES = [
    { id: "general", group: "preferences" },
    { id: "media", group: "preferences" },
    { id: "sounds", group: "preferences" },
    { id: "notifications", group: "preferences" },
    { id: "mini", group: "preferences" },
    { id: "performance", group: "preferences" },
    { id: "shortcuts", group: "preferences" },
    { id: "profile", group: "you" },
] as const;

export type PaneId = (typeof PANES)[number]["id"];

export type PaneGroup = (typeof PANES)[number]["group"];

export const PANE_IDS: readonly PaneId[] = PANES.map((pane) => pane.id);

export const DEFAULT_PANE: PaneId = "general";

/** Other names a caller may use for a section: upstream's menu keys and the device a caller wants to show. */
const ALIASES: Readonly<Record<string, PaneId>> = {
    settings: "general",
    credit: "general",
    help: "general",
    report: "general",
    contact: "general",
    language: "general",
    camera: "media",
    microphone: "media",
    speaker: "media",
    audio: "media",
    video: "media",
    sound: "sounds",
    music: "sounds",
    pip: "mini",
    pictureInPicture: "mini",
    effects: "performance",
    fx: "performance",
};

function isPaneId(name: string): name is PaneId {
    return (PANE_IDS as readonly string[]).includes(name);
}

/** The section a name opens: a section id, one of its aliases, or the first section for anything else. */
export function paneFrom(name: string | undefined): PaneId {
    if (name === undefined) return DEFAULT_PANE;
    if (isPaneId(name)) return name;
    return Object.hasOwn(ALIASES, name) ? ALIASES[name] : DEFAULT_PANE;
}

/**
 * The index a key moves to in a list of `count` items, wrapping at both ends, or undefined for a key that does not
 * move. Both arrow axes move, so the same list works upright and laid out in a row.
 */
export function indexAfter(index: number, key: string, count: number): number | undefined {
    if (count <= 0) return undefined;
    switch (key) {
        case "ArrowDown":
        case "ArrowRight":
            return (index + 1) % count;
        case "ArrowUp":
        case "ArrowLeft":
            return (index - 1 + count) % count;
        case "Home":
            return 0;
        case "End":
            return count - 1;
        default:
            return undefined;
    }
}

/** The section a key moves to from `current` in the section list, or undefined for a key that does not move. */
export function paneAfter(current: PaneId, key: string): PaneId | undefined {
    const next = indexAfter(PANE_IDS.indexOf(current), key, PANE_IDS.length);
    return next === undefined ? undefined : PANE_IDS[next];
}
