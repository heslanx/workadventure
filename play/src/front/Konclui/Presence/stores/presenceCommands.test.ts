import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
    clearWalkNotice,
    goToPerson,
    installPresenceCommands,
    walkNoticeStore,
    type PresenceCommands,
} from "./presenceCommands";

const ana = { name: "Ana Ribeiro", uuid: "ana-uuid", playUri: "https://office.example/map" };

describe("goToPerson", () => {
    const walkTo = vi.fn<PresenceCommands["walkTo"]>();

    beforeEach(() => {
        vi.useFakeTimers();
        walkTo.mockReset();
        installPresenceCommands({ walkTo });
        clearWalkNotice();
    });

    afterEach(() => {
        clearWalkNotice();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("asks to walk to the person, by the account and the room the server finds them by", () => {
        goToPerson(ana);

        expect(walkTo).toHaveBeenCalledTimes(1);
        expect(walkTo).toHaveBeenCalledWith(expect.objectContaining({ uuid: "ana-uuid", playUri: ana.playUri }));
    });

    it("says it is going at once, in the same turn as the press", () => {
        goToPerson(ana);

        expect(get(walkNoticeStore)).toEqual({ kind: "going", name: "Ana Ribeiro" });
    });

    it("lets the notice go after six seconds, not before", () => {
        goToPerson(ana);

        vi.advanceTimersByTime(5999);
        expect(get(walkNoticeStore)).toBeDefined();

        vi.advanceTimersByTime(1);
        expect(get(walkNoticeStore)).toBeUndefined();
    });

    it("restarts the six seconds when it says something else", () => {
        goToPerson(ana);
        vi.advanceTimersByTime(4000);

        goToPerson({ ...ana, name: "Bia Santos" });
        vi.advanceTimersByTime(4000);

        expect(get(walkNoticeStore)).toEqual({ kind: "going", name: "Bia Santos" });
    });

    it("says the walk could not be asked for, and reports why, when the request fails", () => {
        const error = new Error("no connection");
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        walkTo.mockImplementation(() => {
            throw error;
        });

        goToPerson(ana);

        expect(get(walkNoticeStore)).toEqual({ kind: "failed", name: "Ana Ribeiro" });
        expect(report).toHaveBeenCalledWith(expect.stringContaining("presence"), error);
    });

    it("clears the notice at once when the panel closes", () => {
        goToPerson(ana);

        clearWalkNotice();

        expect(get(walkNoticeStore)).toBeUndefined();
    });
});
