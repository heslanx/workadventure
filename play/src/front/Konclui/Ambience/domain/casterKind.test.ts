import { describe, expect, it } from "vitest";
import { classifyPiece, kindFromKey, type CasterKind, type KindInput } from "./casterKind";

interface FixtureRow extends KindInput {
    readonly kind: CasterKind;
}

// The 14 cases both lanes' tests carry verbatim (the plan's contract table). The tags are the editor's.
const SHARED: readonly [name: string, kind: CasterKind, tags?: string[]][] = [
    ["Costela-de-adão grande", "stand", ["Plantas"]],
    ["Tapete de lã 10×5", "floor", ["Tapetes e pisos"]],
    ["Carpete navy da sala de jogos", "floor"],
    ["Grama em vaso (sobre móvel)", "top", ["Plantas"]],
    ["Quadro: a equipe", "hang", ["Decoração de parede"]],
    ["Luminária pendente", "hang"],
    ["TV de parede", "hang", ["Tecnologia e telas"]],
    ["iMac (sobre móvel)", "top", ["Tecnologia e telas"]],
    // after the review of 2026-11-23: the reception's iMac stood on its own desk's front; a picture of a notebook is a picture
    ["Computador iMac", "top", ["Tecnologia e telas"]],
    ["Quadro: Koru no notebook", "hang", ["Peças da marca"]],
    ["Luminária de arco com cúpula", "stand", ["Luminárias"]],
    ["Sofá de três lugares", "stand", ["Sofás e poltronas"]],
    ["Vaso de parede pequeno", "hang"],
    ["Relógio de parede minimalista", "hang"],
    ["Painéis acústicos hexagonais", "hang"], // tagless, as the Python table has it: the plural is a word of its own
    ["Prateleira flutuante com livros", "hang"],
];

describe("classifyPiece", () => {
    it.each(SHARED)("calls %s %s", (name, kind, tags) => {
        expect(classifyPiece({ name, tags })).toBe(kind);
    });

    // Seen failing with the word `tela` matched anywhere in the name (the old unanchored regex): Costela is a herb.
    it("matches words whole: Costela-de-adão is not a screen", () => {
        expect(classifyPiece({ name: "Costela-de-adão grande" })).toBe("stand");
        expect(/tela/i.test("Costela-de-adão")).toBe(true); // the substring rule this replaces
        expect(classifyPiece({ name: "Tela de pintura" })).toBe("stand");
        expect(classifyPiece({ name: "Estante de metal" })).toBe("stand");
        expect(classifyPiece({ name: "Mesa de tv" })).toBe("hang");
    });

    it("takes the floor first: a tag, a depth offset of -100 or less, or a floors folder", () => {
        expect(classifyPiece({ name: "Qualquer coisa", tags: ["Tapetes e pisos"] })).toBe("floor");
        expect(classifyPiece({ name: "Mancha escura", depthOffset: -100 })).toBe("floor");
        expect(classifyPiece({ name: "Placa de piso (sobre móvel)", depthOffset: -150 })).toBe("floor");
        expect(classifyPiece({ name: "Peça", depthOffset: -99 })).toBe("stand");
        expect(classifyPiece({ name: "Peça", key: "x/floors/wood.png" })).toBe("floor");
    });

    it("takes a piece on furniture before its other words, and a wall folder or tag as a hanging piece", () => {
        expect(classifyPiece({ name: "Quadro pequeno (sobre móvel)" })).toBe("top");
        expect(classifyPiece({ name: "Peça", key: "pack/walldecor/a.png" })).toBe("hang");
        expect(classifyPiece({ name: "Peça", key: "pack/doors/a.png" })).toBe("hang");
        expect(classifyPiece({ name: "Peça", tags: ["Decoração de parede"] })).toBe("hang");
    });

    // The build prefixes "/" to the key before it looks for a folder; a key that starts with the folder was stand here.
    it("finds a folder at the start of the key, as the build does", () => {
        expect(classifyPiece({ name: "Peça", key: "walldecor/a.png" })).toBe("hang");
        expect(classifyPiece({ name: "Peça", key: "floors/a.png" })).toBe("floor");
        expect(classifyPiece({ name: "Peça", key: "xwalldecor/a.png" })).toBe("stand");
    });

    it("tells an editor-added piece with no prefab by its folder alone", () => {
        expect(kindFromKey("pack/floors/a.png")).toBe("floor");
        expect(kindFromKey("pack/walls/a.png")).toBe("hang");
        expect(kindFromKey("pack/sprites/a.png")).toBe("stand");
        // and a prefab with a deep depth offset becomes a floor piece
        expect(classifyPiece({ name: "Novo", depthOffset: -200 })).toBe("floor");
    });

    // The fixture is written by the asset lane (fx.py --dump-kinds); until it is there this reads nothing and passes.
    const fixtures = import.meta.glob<FixtureRow[]>("./__fixtures__/placed-kinds.json", {
        eager: true,
        import: "default",
    });
    const rows = Object.values(fixtures)[0] ?? [];
    it.skipIf(rows.length === 0)(
        `agrees with the build's Python classifier on all ${rows.length} placed pieces`,
        () => {
            const wrong = rows.filter((row) => classifyPiece(row) !== row.kind).map((row) => row.name);
            expect(wrong).toEqual([]);
        },
    );
});
