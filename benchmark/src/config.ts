import { apiVersionHash } from "../../libs/messages/src/JsonMessages/ApiVersion";

export interface LoadConfig {
    pusherUrl: string;
    wsUrl: string;
    roomUrls: string[];
    sessions: number;
    rampSeconds: number;
    durationSeconds: number;
    moveHz: number;
    joinTimeoutSeconds: number;
    closeTimeoutSeconds: number;
    auth: "anonymous" | "none";
    apiVersion: string;
    characterTextureId: string;
    namePrefix: string;
    disconnectFraction: number;
    disconnectAtSeconds: number;
    minAccepted: number;
    output: string | undefined;
}

export class ConfigError extends Error {}

export const USAGE = `Usage: npm start -- [--key=value ...]   (every flag is also an environment variable)

  --pusher-url   WA_PUSHER_URL            required  http(s) base URL of the play/pusher service
  --ws-url       WA_WS_URL                optional  websocket base URL (default: derived from --pusher-url)
  --room-urls    WA_ROOM_URLS             required  comma-separated room URLs, filled round-robin by session index
  --sessions     WA_SESSIONS              required  number of room sessions to start
  --ramp-seconds WA_RAMP_SECONDS          10        session i starts at i * ramp / sessions
  --duration-seconds WA_DURATION_SECONDS  60        total run time from the first start to the stop (ramp included)
  --move-hz      WA_MOVE_HZ               1         movement messages per second per accepted session (0 = idle)
  --join-timeout-seconds WA_JOIN_TIMEOUT_SECONDS 30 a session not joined in time is counted as rejected
  --close-timeout-seconds WA_CLOSE_TIMEOUT_SECONDS 5 a socket not closed in time is terminated
  --auth         WA_AUTH                  anonymous anonymous (POST /anonymLogin per session) | none
  --api-version  WA_API_VERSION           ${apiVersionHash}       must equal the apiVersionHash of the pusher under test
  --character-texture WA_CHARACTER_TEXTURE male1
  --name-prefix  WA_NAME_PREFIX           bot
  --disconnect-fraction WA_DISCONNECT_FRACTION 0    share of sessions (lowest indexes) that leave early
  --disconnect-at-seconds WA_DISCONNECT_AT_SECONDS  half of the duration
  --min-accepted WA_MIN_ACCEPTED          1         exit code 2 when fewer sessions were accepted
  --output       WA_OUTPUT                optional  also write the JSON summary to this file
`;

function flagToEnvName(flag: string): string {
    return `WA_${flag.replace(/-/g, "_").toUpperCase()}`;
}

/** Command-line flags win over the environment; both use the same names. */
export function parseConfig(argv: readonly string[], env: Record<string, string | undefined>): LoadConfig {
    const values: Record<string, string | undefined> = { ...env };
    for (const argument of argv) {
        const match = /^--([a-z-]+)=(.*)$/.exec(argument);
        if (match === null) {
            throw new ConfigError(`Unknown argument "${argument}"`);
        }
        values[flagToEnvName(match[1])] = match[2];
    }

    const text = (name: string, fallback?: string): string => {
        const value = values[name] === undefined || values[name] === "" ? fallback : values[name];
        if (value === undefined) {
            throw new ConfigError(`${name} is required`);
        }
        return value;
    };
    const number = (name: string, fallback: number | undefined, min: number, max = Number.MAX_SAFE_INTEGER) => {
        const value = Number(text(name, fallback === undefined ? undefined : String(fallback)));
        if (!Number.isFinite(value) || value < min || value > max) {
            throw new ConfigError(`${name} must be a number between ${min} and ${max}`);
        }
        return value;
    };

    const pusherUrl = text("WA_PUSHER_URL");
    const auth = text("WA_AUTH", "anonymous");
    if (auth !== "anonymous" && auth !== "none") {
        throw new ConfigError(`WA_AUTH must be "anonymous" or "none"`);
    }
    const roomUrls = text("WA_ROOM_URLS")
        .split(",")
        .map((roomUrl) => roomUrl.trim())
        .filter((roomUrl) => roomUrl !== "");
    if (roomUrls.length === 0) {
        throw new ConfigError("WA_ROOM_URLS must contain at least one room URL");
    }
    const sessions = number("WA_SESSIONS", undefined, 1);
    if (!Number.isInteger(sessions)) {
        throw new ConfigError("WA_SESSIONS must be an integer");
    }
    const durationSeconds = number("WA_DURATION_SECONDS", 60, 0);

    return {
        pusherUrl,
        wsUrl: text("WA_WS_URL", pusherUrl),
        roomUrls,
        sessions,
        rampSeconds: number("WA_RAMP_SECONDS", 10, 0),
        durationSeconds,
        moveHz: number("WA_MOVE_HZ", 1, 0, 60),
        joinTimeoutSeconds: number("WA_JOIN_TIMEOUT_SECONDS", 30, 0.001),
        closeTimeoutSeconds: number("WA_CLOSE_TIMEOUT_SECONDS", 5, 0.001),
        auth,
        apiVersion: text("WA_API_VERSION", apiVersionHash),
        characterTextureId: text("WA_CHARACTER_TEXTURE", "male1"),
        namePrefix: text("WA_NAME_PREFIX", "bot"),
        disconnectFraction: number("WA_DISCONNECT_FRACTION", 0, 0, 1),
        disconnectAtSeconds: number("WA_DISCONNECT_AT_SECONDS", durationSeconds / 2, 0),
        minAccepted: number("WA_MIN_ACCEPTED", 1, 0),
        output: values.WA_OUTPUT === "" ? undefined : values.WA_OUTPUT,
    };
}
