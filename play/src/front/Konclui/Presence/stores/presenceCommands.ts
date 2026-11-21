import { writable, type Readable } from "svelte/store";

// What the people panel asks of the game. The components may not reach the Phaser layer (AGENTS.md, layer table), so
// `installKonclui()` hands the Phaser implementation (`phaser/presenceActions.ts`) to this registry and the panel calls
// it from here, the way the dock calls its desk commands.

/** A person to walk to: what the server finds them by. */
export interface WalkTarget {
    readonly uuid: string;
    /** The room the person is in, which the server looks in. */
    readonly playUri: string;
}

export interface PresenceCommands {
    /**
     * Asks the server where the person is and walks the player there: the way upstream's user list does it ("Talk to").
     * It returns once the request is sent; the walk and its refusal (no path, a blocked area) are the scene's own.
     */
    walkTo(target: WalkTarget): void;
}

let installed: PresenceCommands | undefined;

export function installPresenceCommands(commands: PresenceCommands): void {
    installed = commands;
}

/** What the panel says about the last walk it started. It speaks once and fades: the walk itself is on the map. */
export type WalkNotice = { readonly kind: "going" | "failed"; readonly name: string };

const notice = writable<WalkNotice | undefined>(undefined);

/** The notice the panel announces, `undefined` when there is none. */
export const walkNoticeStore: Readable<WalkNotice | undefined> = { subscribe: notice.subscribe };

let fadeTimer: ReturnType<typeof setTimeout> | undefined;

function say(next: WalkNotice | undefined): void {
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    fadeTimer = undefined;
    notice.set(next);
    if (next !== undefined) {
        fadeTimer = setTimeout(() => {
            fadeTimer = undefined;
            notice.set(undefined);
        }, 6000);
    }
}

/** Clears the notice at once: the panel closed, and what it said is no longer about anything on screen. */
export function clearWalkNotice(): void {
    say(undefined);
}

/**
 * Walks to a person. It says "going" at once, in the panel, and says so again as a failure when the request could not
 * be made, so a press is never met with silence.
 */
export function goToPerson(person: WalkTarget & { readonly name: string }): void {
    say({ kind: "going", name: person.name });
    try {
        if (installed === undefined) throw new Error("[konclui] presence: the presence commands are not installed");
        installed.walkTo(person);
    } catch (error) {
        console.error("[konclui] presence: could not ask where the person is", error);
        say({ kind: "failed", name: person.name });
    }
}
