import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ roomMetadata: {} }));

// The shared stub lacks the variable under test and two privacy defaults LocalAdmin reads, so this file adds them; the
// variable under test is read through a getter that each test points at its own value.
vi.mock("../../src/pusher/enums/EnvironmentVariable", async () => ({
    ...(await import("./mocks/pusherEnvironmentVariableMock")),
    DEFAULT_CAMERA_PRIVACY_SETTINGS: false,
    DEFAULT_MICROPHONE_PRIVACY_SETTINGS: true,
    get LOCAL_ADMIN_ROOM_METADATA() {
        return state.roomMetadata;
    },
}));

import { EnvironmentVariables } from "../../src/pusher/enums/EnvironmentVariableValidator";
import { localAdmin } from "../../src/pusher/services/LocalAdmin";

const OPT_OUT_ROOM = "/~/konclui-office/opt-out.wam";
const SHELL_OPT_OUT = { konclui: { shell: false } };

async function metadataServedFor(playUri: string): Promise<unknown> {
    const details = await localAdmin.fetchMapDetails(playUri);
    if (!("metadata" in details)) {
        throw new Error(`Expected map details with metadata for ${playUri}, got ${JSON.stringify(details)}`);
    }
    return details.metadata;
}

describe("LocalAdmin room metadata", () => {
    afterEach(() => {
        state.roomMetadata = {};
    });

    it("serves only the default metadata when the variable is absent", async () => {
        await expect(metadataServedFor(`http://play.test${OPT_OUT_ROOM}`)).resolves.toEqual({ enableTutorial: true });
    });

    it("merges the entry of the requested room into the default metadata", async () => {
        state.roomMetadata = { [OPT_OUT_ROOM]: SHELL_OPT_OUT };

        await expect(metadataServedFor(`http://play.test${OPT_OUT_ROOM}`)).resolves.toEqual({
            enableTutorial: true,
            ...SHELL_OPT_OUT,
        });
    });

    it("lets the entry of a room override a default key", async () => {
        state.roomMetadata = { [OPT_OUT_ROOM]: { enableTutorial: false } };

        await expect(metadataServedFor(`http://play.test${OPT_OUT_ROOM}`)).resolves.toEqual({ enableTutorial: false });
    });

    it("compares the room on its path only, whatever the scheme, host, port, query or fragment", async () => {
        state.roomMetadata = { [OPT_OUT_ROOM]: SHELL_OPT_OUT };

        await expect(
            metadataServedFor(`https://other.example:8443${OPT_OUT_ROOM}?token=abc&x=1#spot`),
        ).resolves.toMatchObject(SHELL_OPT_OUT);
    });

    it.each([
        ["another room", "/~/konclui-office/office.wam"],
        ["a path that only ends with the key", `/~/other${OPT_OUT_ROOM}`],
        ["a path that only starts with the key", `${OPT_OUT_ROOM}.bak`],
    ])("serves no extra metadata to %s", async (_description, roomPath) => {
        state.roomMetadata = { [OPT_OUT_ROOM]: SHELL_OPT_OUT };

        await expect(metadataServedFor(`http://play.test${roomPath}`)).resolves.toEqual({ enableTutorial: true });
    });
});

describe("LOCAL_ADMIN_ROOM_METADATA validation", () => {
    const schema = EnvironmentVariables.shape.LOCAL_ADMIN_ROOM_METADATA;

    it.each([undefined, "", "   "])("accepts %j as no metadata at all", (value) => {
        expect(schema.parse(value)).toEqual({});
    });

    it("parses a JSON object of room paths to metadata objects", () => {
        const value = JSON.stringify({ [OPT_OUT_ROOM]: SHELL_OPT_OUT, "/_/global/maps.test/map.json": {} });

        expect(schema.parse(value)).toEqual({ [OPT_OUT_ROOM]: SHELL_OPT_OUT, "/_/global/maps.test/map.json": {} });
    });

    it("rejects malformed JSON with a message on the variable itself", () => {
        const result = schema.safeParse('{"/~/a.wam": {');

        expect(result.success).toBe(false);
        // The startup report only prints the errors attached to the variable: they must not hide under a nested path.
        expect(result.error?.format()._errors).toEqual([expect.stringMatching(/^Must be valid JSON: /)]);
    });

    it.each([
        ["a string", '{"/~/a.wam": "shell"}'],
        ["a number", '{"/~/a.wam": 1}'],
        ["null", '{"/~/a.wam": null}'],
        ["an array", '{"/~/a.wam": [{"konclui": {"shell": false}}]}'],
    ])("rejects a room entry that is %s, naming the room", (_description, value) => {
        const result = schema.safeParse(value);

        expect(result.success).toBe(false);
        expect(result.error?.format()._errors).toEqual(['Room "/~/a.wam": Room metadata must be a JSON object']);
    });

    it.each([
        ["an array", "[]"],
        ["a string", '"x"'],
        ["a number", "1"],
        ["null", "null"],
    ])("rejects a top-level value that is %s", (_description, value) => {
        const result = schema.safeParse(value);

        expect(result.success).toBe(false);
        expect(result.error?.format()._errors).toEqual([
            "Must be a JSON object that maps each room path to a metadata object",
        ]);
    });

    it.each([
        ["a scheme and a host", "http://play.test/~/a.wam"],
        ["a query", "/~/a.wam?token=abc"],
        ["a fragment", "/~/a.wam#spot"],
        ["no leading slash", "~/a.wam"],
    ])("rejects a room key with %s, which could never match a path", (_description, key) => {
        const result = schema.safeParse(JSON.stringify({ [key]: {} }));

        expect(result.success).toBe(false);
        expect(result.error?.format()._errors).toEqual([
            `Room "${key}": Room keys must be URL paths such as /~/world/room.wam, without scheme, host or query`,
        ]);
    });
});
