import axios, { isAxiosError } from "axios";
import type { MapDetailsData, RoomRedirect, ErrorApiData } from "@workadventure/messages";
import { isMapDetailsData, isRoomRedirect, isErrorApiErrorData } from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { asError } from "catch-unknown";
import { ADMIN_API_TOKEN, ADMIN_API_URL } from "../Enum/EnvironmentVariable";
import { LivekitCredentialsResponse } from "./Repository/LivekitCredentialsResponse";
import { getCapability } from "./Capabilities";

/**
 * What the admin learns when a recording egress ends. It turns a completed
 * one into a customer webhook (recording.completed).
 */
export interface RecordingEventPayload {
    phase: "ended";
    status: string;
    egressId: string;
    recordingSessionId: string;
    playUri: string;
    recorder: { uuid: string; spaceUserId: string };
    startedAt: string | null;
    endedAt: string | null;
    error: string | null;
    files: { filename: string; sizeBytes: number; durationSeconds: number }[];
}

const RECORDING_EVENT_RETRY_DELAYS_MS = [250, 1_000, 4_000];

/**
 * How long the admin has to answer the ask for the LiveKit settings. The first join of a media space waits for the
 * answer, so an admin that hangs must not hold its joiners: after this, the ask fails and the space falls back to the
 * environment's threshold and is not recorded.
 */
const LIVEKIT_CREDENTIALS_TIMEOUT_MS = 5_000;

/**
 * How long the answer for a world is kept once the admin gave it. Every proximity bubble and meeting area is a media
 * space of its own and asks at its first join, so a world of a thousand people would send hundreds of identical
 * requests. The settings are read once per space anyway, so a change in the admin reaches the next spaces within this
 * time. The answer holds the LiveKit API secret: it is dropped from memory when this time is over, not kept for reuse.
 */
const WORLD_LIVEKIT_SETTINGS_TTL_MS = 30_000;

/**
 * How long a failed ask is kept, and no longer: an admin that hangs or errors is asked once for the spaces that join
 * together, not once per space, but one that recovered is asked again within seconds.
 */
const WORLD_LIVEKIT_SETTINGS_FAILURE_TTL_MS = 5_000;

class AdminApi {
    /** The asks for the LiveKit settings of each world, in flight or answered, until they expire. */
    private readonly worldLivekitSettings = new Map<string, Promise<LivekitCredentialsResponse>>();

    /**
     * Tells the admin that a recording egress ended. Retried a few times on
     * transport or server errors; a 4xx means the admin rejected the payload
     * and is not retried. Resolves silently when no admin is configured or
     * when the admin does not advertise the endpoint in its capabilities.
     */
    async notifyRecordingEvent(payload: RecordingEventPayload): Promise<void> {
        if (!ADMIN_API_URL || getCapability("api/recordings/events") !== "v1") {
            return;
        }

        const url = new URL("api/recordings/events", ADMIN_API_URL).toString();
        const send = async (attempt: number): Promise<void> => {
            try {
                await axios.post(url, payload, {
                    headers: {
                        Authorization: `${ADMIN_API_TOKEN ?? ""}`,
                        Accept: "application/json",
                    },
                    timeout: 5_000,
                });
            } catch (error) {
                const status = isAxiosError(error) ? error.response?.status : undefined;
                const rejected =
                    status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
                if (rejected || attempt >= RECORDING_EVENT_RETRY_DELAYS_MS.length) {
                    throw error;
                }
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, RECORDING_EVENT_RETRY_DELAYS_MS[attempt]);
                });
                return send(attempt + 1);
            }
        };

        return send(0);
    }

    /**
     * One request to the admin for the LiveKit credentials and settings, on every call. A LiveKit state uses it to get
     * the credentials in force when it starts (StateFactory); the first join of a space uses
     * `fetchWorldLivekitSettings` instead.
     */
    async fetchLivekitCredentials(spaceId: string, playUri: string): Promise<LivekitCredentialsResponse> {
        if (!ADMIN_API_URL) {
            return Promise.reject(new Error("No admin backoffice set!"));
        }

        const params: { playUri: string } = {
            playUri,
        };

        const res = await axios.get(new URL("api/livekit/credentials", ADMIN_API_URL).toString(), {
            headers: {
                Authorization: `${ADMIN_API_TOKEN ?? ""}`,
                Accept: "application/json",
            },
            params,
            timeout: LIVEKIT_CREDENTIALS_TIMEOUT_MS,
            // axios's timeout bounds the connection and then only the silence between two chunks: an admin that sends
            // its headers and drips the body would never trip it. The signal ends the request at the same deadline
            // whatever the admin does, so a world's shared ask always settles.
            signal: AbortSignal.timeout(LIVEKIT_CREDENTIALS_TIMEOUT_MS),
        });

        return LivekitCredentialsResponse.parse(res.data);
    }

    /**
     * The LiveKit settings of a world, for the first join of one of its spaces: the same answer for the spaces that
     * ask within WORLD_LIVEKIT_SETTINGS_TTL_MS of it, one request for those that ask together, and one report to
     * Sentry for a failure however many spaces wait on it.
     *
     * `world` is the key because the answer is the world's (its settings, its LiveKit server) and the request carries
     * only the asker's room URL, which differs from room to room of a world. It is the same string that prefixes the
     * name of each of the world's spaces, so no more is shared here than the spaces already share. `spaceId` and
     * `playUri` are those of whichever space asks first.
     */
    fetchWorldLivekitSettings(world: string, spaceId: string, playUri: string): Promise<LivekitCredentialsResponse> {
        const known = this.worldLivekitSettings.get(world);
        if (known) {
            return known;
        }

        const ask = this.fetchLivekitCredentials(spaceId, playUri);
        this.worldLivekitSettings.set(world, ask);
        ask.then(
            () => this.forgetWorldLivekitSettings(world, ask, WORLD_LIVEKIT_SETTINGS_TTL_MS),
            (error: unknown) => {
                // The message, not the error: an AxiosError carries its request config, which has the admin token.
                console.error(
                    `Could not get the LiveKit settings of world ${world} from the admin:`,
                    asError(error).message,
                );
                Sentry.captureException(error, { extra: { world } });
                this.forgetWorldLivekitSettings(world, ask, WORLD_LIVEKIT_SETTINGS_FAILURE_TTL_MS);
            },
        );
        return ask;
    }

    /** Drops an ask once its time is over, even if the world is never asked about again: it may hold the secret. */
    private forgetWorldLivekitSettings(world: string, ask: Promise<LivekitCredentialsResponse>, afterMs: number): void {
        setTimeout(() => {
            if (this.worldLivekitSettings.get(world) === ask) {
                this.worldLivekitSettings.delete(world);
            }
        }, afterMs).unref();
    }

    async fetchMapDetails(playUri: string): Promise<MapDetailsData | RoomRedirect | ErrorApiData> {
        if (!ADMIN_API_URL) {
            return Promise.reject(new Error("No admin backoffice set!"));
        }

        const params: { playUri: string } = {
            playUri,
        };

        try {
            const res = await axios.get(new URL("api/map", ADMIN_API_URL).toString(), {
                headers: {
                    Authorization: `${ADMIN_API_TOKEN ?? ""}`,
                    Accept: "application/json",
                },
                params,
            });

            const mapDetailData = isMapDetailsData.safeParse(res.data);

            if (mapDetailData.success) {
                return mapDetailData.data;
            }

            const roomRedirect = isRoomRedirect.safeParse(res.data);
            if (roomRedirect.success) {
                return roomRedirect.data;
            }

            const errorData = isErrorApiErrorData.safeParse(res.data);
            if (errorData.success) {
                return errorData.data;
            }

            console.error(
                "Invalid answer received from the admin for the /api/map endpoint. Errors:",
                mapDetailData.error.issues,
            );
            Sentry.captureException(mapDetailData.error.issues);
            console.error(roomRedirect.error.issues);
            return {
                status: "error",
                type: "error",
                title: "Invalid server response",
                subtitle: "Something wrong happened while fetching map details!",
                image: "",
                code: "MAP_VALIDATION",
                details: "The server answered with an invalid response. The administrator has been notified.",
            };
        } catch (err) {
            let message = "Unknown error";
            if (isAxiosError(err)) {
                Sentry.captureException(
                    `An error occurred during call to /api/map endpoint. HTTP Status: ${err.status ?? "none"}. ${
                        err.message
                    }`,
                );
                console.error(
                    `An error occurred during call to /api/map endpoint. HTTP Status: ${err.status ?? "none"}.`,
                    err,
                );
            } else {
                Sentry.captureException(`An error occurred during call to /api/map endpoint.`);
                console.error(`An error occurred during call to /api/map endpoint.`, err);
            }
            if (err instanceof Error) {
                message = err.message;
            }
            return {
                status: "error",
                type: "error",
                title: "Connection error",
                subtitle: "Something wrong happened while fetching map details!",
                image: "",
                code: "ROOM_ACCESS_ERROR",
                details: message,
            };
        }
    }
}

export const adminApi = new AdminApi();
