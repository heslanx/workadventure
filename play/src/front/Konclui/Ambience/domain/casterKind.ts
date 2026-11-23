// What a placed piece is to the shading, from its prefab: it decides who casts a shadow, who receives only a contact
// band, and who is a floor piece that takes no relief. The build's Python classifier (hq-office fx.py) is the same
// rules in the same order; a fixture of the placed map's pieces (__fixtures__/placed-kinds.json) is tested on both sides.

/**
 * stand: stands on the floor and casts a shadow on it. top: sits on furniture. hang: hangs on a wall or door. floor: a
 * rug, a floor piece or a stain: no relief, no shadow, and it does not hide what is under it.
 */
export type CasterKind = "stand" | "top" | "hang" | "floor";

export const CASTER_KINDS: readonly CasterKind[] = ["stand", "top", "hang", "floor"];

/** What the classifier reads of a prefab (the editor's name and tags, a depth offset) and of its picture's key. */
export interface KindInput {
    readonly name?: string;
    readonly tags?: readonly string[];
    readonly depthOffset?: number;
    /** The sprite key (the texture key from "entities/" on), for its folder. */
    readonly key?: string;
}

// A word is matched whole, in any letters (Portuguese accents included), never as a substring: "tela" would otherwise
// match "Costela-de-adão" and take the herb off the floor.
const word = (alternatives: readonly string[]): RegExp =>
    new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "iu");

const HANG_WORDS = word([
    "quadro",
    "pôster",
    "poster",
    "relógio",
    "clock",
    "painel",
    "painéis",
    "janela",
    "cortina",
    "espelho",
    "letreiro",
    "prateleira flutuante",
    "pendente",
    "placa",
    "tv",
    "luminária de parede",
    "vaso de parede",
]);
// A computer is on a desk whether or not its name says "(sobre móvel)": "Computador iMac" stood on the reception desk, so its
// shadow fell on the desk's own front and nothing showed on the desk top.
const TOP_WORDS = word(["imac", "notebook", "laptop", "macbook"]);
const FLOOR_WORDS = word(["tapete", "carpete", "capacho", "piso", "mancha", "grama", "rug", "carpet"]);
const TOP_NAME = /\(sobre móvel\)/iu;
const WALL_FOLDER = /\/(walldecor|walls|doors)\//;
const FLOOR_FOLDER = /\/floors\//;
// The folders are read from "/" + the key, as the build does: a key that starts with the folder ("walldecor/a.png") is in it.
const inFolder = (folder: RegExp, key: string): boolean => folder.test(`/${key}`);

/** The kind of a piece, by the rules in this order: floor tag, depth or folder; top; hang; top by name; floor by name; else stand. */
export function classifyPiece({ name = "", tags = [], depthOffset, key = "" }: KindInput): CasterKind {
    if (
        tags.includes("Tapetes e pisos") ||
        (depthOffset !== undefined && depthOffset <= -100) ||
        inFolder(FLOOR_FOLDER, key)
    ) {
        return "floor";
    }
    if (TOP_NAME.test(name)) return "top";
    if (tags.includes("Decoração de parede") || inFolder(WALL_FOLDER, key) || HANG_WORDS.test(name)) return "hang";
    if (TOP_WORDS.test(name)) return "top";
    if (FLOOR_WORDS.test(name)) return "floor";
    return "stand";
}

/** What an unknown picture with no prefab can be told from its folder alone: a floor, a wall piece, or a standing one. */
export function kindFromKey(key: string): CasterKind {
    return classifyPiece({ key });
}
