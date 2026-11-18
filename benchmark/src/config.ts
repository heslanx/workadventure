import { apiVersionHash } from "../../libs/messages/src/JsonMessages/ApiVersion";
import { VIEWPORT_KINDS, type ViewportKind } from "./protocol";
import { PATTERN_KINDS, type PatternKind } from "./scenario";

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
    probeObservers: number;
    minAccepted: number;
    output: string | undefined;
    /** What the camera reports to the pusher: the 640 x 400 bot box, a browser window, or the whole map. */
    viewport: ViewportKind;
    pattern: PatternKind;
    /** Share of the bots that walk; the others join, report a viewport and then send nothing. */
    movingFraction: number;
    /** Share of the bots that subscribe to the world space's user list. */
    worldSpaceWatchFraction: number;
    /** Share of the bots that join the world space; at least the watchers. */
    worldSpaceMemberFraction: number;
    /** Added to every session index for names, paths and roles, so several processes never overlap. */
    indexOffset: number;
    /** Length of the closing stretch of the run that the traffic and move statistics cover; 0 is the whole run. */
    steadyWindowSeconds: number;
    metricsUrls: string[];
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
  --probe-observers WA_PROBE_OBSERVERS    20        sessions after the early leavers that record move delivery
  --min-accepted WA_MIN_ACCEPTED          1         exit code 2 when fewer sessions were accepted
  --output       WA_OUTPUT                optional  also write the JSON summary to this file
  --viewport     WA_VIEWPORT              bot       bot (640x400, the baselines) | browser (960x540 + 300 px margin, clipped to the map) | zoomout (whole map)
  --pattern      WA_PATTERN               ellipse   ellipse (the baselines) | plaza (laps of the Plateia) | ring (300 px circle) | walk-stop (stop and go over the floor)
  --moving-fraction WA_MOVING_FRACTION    1         share of the sessions that walk; the others stand still and send no move
  --world-space  WA_WORLD_SPACE           0         share of the sessions (0..1, or on/off) that join the allWorldUser space and watch its roster
  --world-members WA_WORLD_MEMBERS        1 when --world-space > 0, else 0   share that joins the space; the watchers are part of it
  --index-offset WA_INDEX_OFFSET          0         added to every session index (names, paths, roles): give each process its own range
  --steady-window WA_STEADY_WINDOW        0         seconds at the end of the run that traffic, delivery and latency cover (0 = whole run)
  --metrics-urls WA_METRICS_URLS          optional  comma-separated Prometheus /metrics URLs, scraped at the window edges and every 5 s
`;

const SHARE_NAMES = new Set(["on", "off"]);

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
    const rampSeconds = number("WA_RAMP_SECONDS", 10, 0);
    const probeObservers = number("WA_PROBE_OBSERVERS", 20, 0);
    if (!Number.isInteger(probeObservers)) {
        throw new ConfigError("WA_PROBE_OBSERVERS must be an integer");
    }

    const choice = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
        const value = text(name, fallback);
        const match = allowed.find((candidate) => candidate === value);
        if (match === undefined) {
            throw new ConfigError(`${name} must be one of ${allowed.join(", ")}`);
        }
        return match;
    };
    // A share may also be written on (1) or off (0), the way the world space switch reads in the plans.
    const share = (name: string, fallback: string): number => {
        const raw = text(name, fallback);
        if (SHARE_NAMES.has(raw)) {
            return raw === "on" ? 1 : 0;
        }
        return number(name, Number(raw), 0, 1);
    };

    const worldSpaceWatchFraction = share("WA_WORLD_SPACE", "0");
    const worldSpaceMemberFraction = share("WA_WORLD_MEMBERS", worldSpaceWatchFraction > 0 ? "1" : "0");
    if (worldSpaceMemberFraction < worldSpaceWatchFraction) {
        throw new ConfigError("WA_WORLD_MEMBERS must be at least WA_WORLD_SPACE: a watcher is a member");
    }
    const indexOffset = number("WA_INDEX_OFFSET", 0, 0);
    if (!Number.isInteger(indexOffset)) {
        throw new ConfigError("WA_INDEX_OFFSET must be an integer");
    }
    const steadyWindowSeconds = number("WA_STEADY_WINDOW", 0, 0);
    if (steadyWindowSeconds > 0 && steadyWindowSeconds > durationSeconds - rampSeconds) {
        throw new ConfigError(
            `WA_STEADY_WINDOW (${steadyWindowSeconds} s) must fit after the ramp: the duration is ${durationSeconds} s and the ramp ${rampSeconds} s`,
        );
    }
    const metricsUrls = parseMetricsUrls(values.WA_METRICS_URLS);

    return {
        pusherUrl,
        wsUrl: text("WA_WS_URL", pusherUrl),
        roomUrls,
        sessions,
        rampSeconds,
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
        probeObservers,
        minAccepted: number("WA_MIN_ACCEPTED", 1, 0),
        output: values.WA_OUTPUT === "" ? undefined : values.WA_OUTPUT,
        viewport: choice("WA_VIEWPORT", VIEWPORT_KINDS, "bot"),
        pattern: choice("WA_PATTERN", PATTERN_KINDS, "ellipse"),
        movingFraction: number("WA_MOVING_FRACTION", 1, 0, 1),
        worldSpaceWatchFraction,
        worldSpaceMemberFraction,
        indexOffset,
        steadyWindowSeconds,
        metricsUrls,
    };
}

function parseMetricsUrls(raw: string | undefined): string[] {
    const urls = (raw ?? "")
        .split(",")
        .map((url) => url.trim())
        .filter((url) => url !== "");
    for (const url of urls) {
        if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
            throw new ConfigError(`WA_METRICS_URLS holds "${url}", which is not an http(s) URL`);
        }
    }
    return urls;
}
