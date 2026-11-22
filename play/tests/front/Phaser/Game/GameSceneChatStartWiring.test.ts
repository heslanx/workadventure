import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// GameScene pulls Phaser and the whole game in, so these read its source: they guard the wiring that no unit test of
// ChatStart or GameManager sees (the scene swapping back to the upstream call keeps those green).
const SRC = resolve(__dirname, "../../../../src/front");
const gameScene = readFileSync(resolve(SRC, "Phaser/Game/GameScene.ts"), "utf8");
const lines = gameScene.split("\n");

/** The body of a method, from its signature line to the next method of the same indentation. */
function methodBody(signature: RegExp): string {
    const start = lines.findIndex((line) => signature.test(line));
    expect(start, `no method matches ${signature}`).toBeGreaterThanOrEqual(0);
    const indent = lines[start].match(/^\s*/)?.[0] ?? "";
    const end = lines.findIndex((line, index) => index > start && line === `${indent}}`);
    return lines.slice(start, end + 1).join("\n");
}

describe("the wiring of the chat start in the GameScene", () => {
    it("never opens the chat connection itself: it only waits for it", () => {
        expect(gameScene).not.toMatch(/gameManager\s*\.getChatConnection\(/);
        expect(gameScene.match(/gameManager\s*\.awaitChatConnection\(\)/g)).toHaveLength(2);
    });

    it("begins its own wait for the chat start before it awaits the connection", () => {
        const create = methodBody(/^\s{4}(public )?create\(\)/);
        const begin = create.indexOf("gameManager.beginChatStartWait()");
        const wait = create.indexOf(".awaitChatConnection()");

        expect(begin).toBeGreaterThan(-1);
        expect(wait).toBeGreaterThan(begin);
    });

    it("starts the chat when the map is playable, right after the first playable frame is announced", () => {
        const loaded = gameScene.indexOf("gameSceneIsLoadedStore.set(true);");
        const start = gameScene.indexOf("gameManager.startChatConnectionWhenIdle();");

        expect(loaded).toBeGreaterThan(-1);
        expect(start).toBeGreaterThan(loaded);
        expect(start - loaded).toBeLessThan(400);
        expect(gameScene.match(/startChatConnectionWhenIdle\(\)/g)).toHaveLength(1);
    });

    it("claims the prefetched WAM and TMJ, and falls back on Phaser's loader for a TMJ", () => {
        expect(gameScene).toContain("mapPrefetch.takeWam(");
        const tmj = methodBody(/^\s{4}private doLoadTMJFile\(/);
        expect(tmj).toContain("mapPrefetch.takeTmj(");
        // A failed prefetch ends in the loader that has the error screen, not in a retrying request.
        expect(tmj).toContain("this.loadTMJFileWithPhaser(mapUrlFile)");
        expect(tmj).not.toContain("axiosWithRetry");
    });
});
