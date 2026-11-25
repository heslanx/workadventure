// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Phaser from "phaser";
import { describe, expect, it } from "vitest";

// A card that floats over the canvas (the office shell's side panel) is a DOM element above it, so the browser hits it
// first. Phaser also listens on the window and sees a press whose target is the card; what keeps that press from walking
// the avatar is that Phaser reports it as outside the canvas, and the game's walk and drag handlers only follow the events
// of presses on the canvas. This test holds both halves, so an upgrade of Phaser or a change of those handlers shows here.
describe("a press on a card over the canvas", () => {
    type Processor = (this: unknown, pointer: unknown) => number;
    const prototype = Phaser.Input.InputPlugin.prototype as unknown as Record<string, Processor>;

    function emittedFor(
        processor: "processDownEvents" | "processUpEvents",
        target: Element,
        canvas: Element,
    ): string[] {
        const emitted: string[] = [];
        const plugin = {
            // A game object under the pointer is not what is in question: the walk is a scene-level event.
            _temp: [],
            _eventData: { cancelled: false },
            _eventContainer: {},
            isActive: () => true,
            emit: (event: string) => emitted.push(event),
            manager: { game: { canvas } },
        };
        prototype[processor].call(plugin, { downElement: target, upElement: target });
        return emitted;
    }

    const canvas = document.createElement("canvas");
    const card = document.createElement("aside");

    it("is a press on the canvas for Phaser only when its target is the canvas", () => {
        expect(emittedFor("processDownEvents", canvas, canvas)).toEqual([Phaser.Input.Events.POINTER_DOWN]);
        expect(emittedFor("processUpEvents", canvas, canvas)).toEqual([Phaser.Input.Events.POINTER_UP]);
    });

    it("is outside the game for Phaser when its target is the card", () => {
        expect(emittedFor("processDownEvents", card, canvas)).toEqual([Phaser.Input.Events.POINTER_DOWN_OUTSIDE]);
        expect(emittedFor("processUpEvents", card, canvas)).toEqual([Phaser.Input.Events.POINTER_UP_OUTSIDE]);
    });

    it("is not what the game walks on: the walk follows POINTER_UP, and an outside release only ends a gesture", () => {
        const input = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "../../../../src/front/Phaser/UserInput/UserInputManager.ts"),
            "utf8",
        );

        expect(input).toMatch(/input\.on\(Phaser\.Input\.Events\.POINTER_UP, \(pointer: Pointer, gameObjects/);
        expect(input).toMatch(/input\.on\(Phaser\.Input\.Events\.POINTER_DOWN, \(pointer: Pointer, gameObjects/);
        expect(input).toMatch(/input\.on\(Phaser\.Input\.Events\.POINTER_UP_OUTSIDE, this\.cancelPointerGesture\)/);
        expect(input).not.toMatch(/Events\.POINTER_DOWN_OUTSIDE/);
    });
});
