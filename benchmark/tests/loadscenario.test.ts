import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type LoadConfig, parseConfig } from "../src/config";
import { runLoad } from "../src/runner";
import { motionFor } from "../src/scenario";
import { startFakePusher } from "./support/fakePusher";

const ROOM = "http://play.test/_/global/maps.test/a.json";

function configFor(pusherUrl: string, overrides: Partial<LoadConfig> = {}): LoadConfig {
    return {
        ...parseConfig([], {
            WA_PUSHER_URL: pusherUrl,
            WA_ROOM_URLS: ROOM,
            WA_SESSIONS: "3",
            WA_RAMP_SECONDS: "0.05",
            WA_DURATION_SECONDS: "0.6",
            WA_MOVE_HZ: "20",
        }),
        ...overrides,
    };
}

describe("load scenarios against a fake pusher", () => {
    let pusher: Awaited<ReturnType<typeof startFakePusher>> | undefined;
    let metricsServer: Server | undefined;

    afterEach(async () => {
        await pusher?.close();
        pusher = undefined;
        await new Promise<void>((resolve) =>
            metricsServer === undefined ? resolve() : metricsServer.close(() => resolve()),
        );
        metricsServer = undefined;
    });

    describe("world space", () => {
        it("joins and watches the world space, and counts what the roster costs by message type", async () => {
            // Drop the joinWorldSpace call in session.ts and nothing is joined; drop the addSpaceFilter send and no
            // snapshot arrives. Sessions start 0.2 s apart so later ones join while earlier ones already watch.
            pusher = await startFakePusher("accept");
            const config = configFor(pusher.url, {
                sessions: 3,
                rampSeconds: 0.6,
                durationSeconds: 1.2,
                worldSpaceWatchFraction: 1,
                worldSpaceMemberFraction: 1,
            });

            const summary = await runLoad(config);

            expect(summary.worldSpace).toMatchObject({
                spaceName: "allWorldUser",
                membersPlanned: 3,
                membersJoined: 3,
                watchersPlanned: 3,
                watchersSubscribed: 3,
                joinErrors: {},
            });
            expect(summary.worldSpace.joinLatencyMs.count).toBe(3);
            expect(summary.sent).toMatchObject({ queryMessage: 3, addSpaceFilterMessage: 3 });
            expect(pusher.observed).toMatchObject({ spaceJoins: 3, spaceFilters: 3 });
            // One snapshot per watcher, one state patch per member, and live additions for the earlier watchers.
            expect(summary.worldSpace.byType.initSpaceUsersMessage).toMatchObject({ messages: 3, frames: 3 });
            expect(summary.worldSpace.byType.initSpaceUsersMessage.bytes).toBeGreaterThan(0);
            expect(summary.worldSpace.byType.spaceStatePatchMessage).toMatchObject({ messages: 3 });
            expect(summary.worldSpace.byType.addSpaceUserMessage.messages).toBeGreaterThan(0);
            expect(summary.worldSpace.bytes).toBeGreaterThan(0);
            expect(summary.worldSpace.records).toBeGreaterThanOrEqual(3 + 1);
            expect(summary.reconciled).toBe(true);
        });

        it("keeps members that never watch free of snapshots and of live roster changes", async () => {
            // The state after the roster is made lazy: in the space for its state, never subscribed to its users.
            pusher = await startFakePusher("accept");
            const config = configFor(pusher.url, {
                worldSpaceWatchFraction: 0,
                worldSpaceMemberFraction: 1,
            });

            const summary = await runLoad(config);

            expect(summary.worldSpace).toMatchObject({ membersJoined: 3, watchersPlanned: 0, watchersSubscribed: 0 });
            expect(summary.sent.addSpaceFilterMessage).toBeUndefined();
            expect(pusher.observed.spaceFilters).toBe(0);
            expect(Object.keys(summary.worldSpace.byType)).toEqual(["spaceStatePatchMessage"]);
        });

        it("does not touch the world space unless asked, so old baselines stay comparable", async () => {
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url));

            expect(summary.sent.queryMessage).toBeUndefined();
            expect(summary.sent.addSpaceFilterMessage).toBeUndefined();
            expect(summary.worldSpace).toMatchObject({ membersPlanned: 0, membersJoined: 0, bytes: 0, byType: {} });
        });
    });

    describe("who walks and where", () => {
        it("lets only the walking share send moves; the others join and stand still", async () => {
            // Golden-ratio selection at 0.5 picks bots 0 and 2 of 0..3 (fractions .00, .62, .24, .85 against .5).
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url, { sessions: 4, movingFraction: 0.5 }));

            expect(summary.scenario.walkers).toBe(2);
            expect([...pusher.observed.movesByName.keys()].sort()).toEqual(["bot-0", "bot-2"]);
            expect(summary.sessions.accepted).toBe(4);
            expect(summary.sent.viewportMessage).toBe(4);
        });

        it("sends no move at all when nobody walks", async () => {
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url, { movingFraction: 0 }));

            expect(summary.sent.userMovesMessage).toBeUndefined();
            expect(pusher.observed.movesByName.size).toBe(0);
            expect(summary.sessions.accepted).toBe(3);
        });

        it("names bots and draws their paths from the global index when --index-offset is set", async () => {
            // Two generator processes with offsets 0 and 100 must not both create bot-0 on the same path.
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url, { sessions: 2, indexOffset: 100 }));

            expect([...pusher.observed.names].sort()).toEqual(["bot-100", "bot-101"]);
            expect(summary.scenario).toMatchObject({ indexOffset: 100, firstPathIndex: 100, lastPathIndex: 101 });
            const firstMove = pusher.observed.movesByName.get("bot-100")?.[0];
            expect(firstMove).toMatchObject(motionFor("ellipse").positionAt(100, 1));
        });

        it.each([
            ["bot", 640, 400],
            ["browser", 1560, 1140],
            ["zoomout", 2752, 1792],
        ] as const)("reports a %s viewport of %i x %i with every move", async (viewport, width, height) => {
            pusher = await startFakePusher("accept");

            await runLoad(configFor(pusher.url, { sessions: 1, viewport }));

            const moves = pusher.observed.movesByName.get("bot-0") ?? [];
            expect(moves.length).toBeGreaterThan(0);
            // The browser viewport is clipped to the map near its edges, so only a bot in the middle shows the size.
            const widest = Math.max(...moves.map((move) => move.viewportWidth));
            const tallest = Math.max(...moves.map((move) => move.viewportHeight));
            expect(widest).toBeLessThanOrEqual(width);
            expect(tallest).toBeLessThanOrEqual(height);
            if (viewport !== "browser") {
                expect(widest).toBe(width);
                expect(tallest).toBe(height);
            }
        });

        it("keeps plaza bots inside the Plateia", async () => {
            pusher = await startFakePusher("accept");

            await runLoad(configFor(pusher.url, { sessions: 3, pattern: "plaza", moveHz: 40 }));

            const points = [...pusher.observed.movesByName.values()].flat();
            expect(points.length).toBeGreaterThan(10);
            for (const point of points) {
                expect(point.x).toBeGreaterThanOrEqual(192);
                expect(point.x).toBeLessThanOrEqual(608);
                expect(point.y).toBeGreaterThanOrEqual(416);
                expect(point.y).toBeLessThanOrEqual(960);
            }
        });

        it("stops a walk-stop bot on its twelfth move and keeps it silent before it walks on", async () => {
            // Reverting the pause in the move timer leaves the gap after the stop at one tick (about 17 ms at 60 Hz).
            pusher = await startFakePusher("accept");

            await runLoad(
                configFor(pusher.url, { sessions: 1, pattern: "walk-stop", moveHz: 60, durationSeconds: 1.2 }),
            );

            const moves = pusher.observed.movesByName.get("bot-0") ?? [];
            const stopAt = moves.findIndex((move) => !move.moving);
            expect(stopAt).toBe(11);
            expect(moves.slice(0, 11).every((move) => move.moving)).toBe(true);
            // At least 5 silent ticks of 16.7 ms follow the stop; allow some slack for timer jitter.
            expect(moves[stopAt + 1].at - moves[stopAt].at).toBeGreaterThan(70);
        });
    });

    describe("known peers", () => {
        it("reports how many other users each bot knew of when the run stopped", async () => {
            pusher = await startFakePusher("accept", { announceJoins: true });
            const config = configFor(pusher.url, { sessions: 4, rampSeconds: 0.4, durationSeconds: 1.2 });

            const summary = await runLoad(config);

            expect(summary.knownPeers).toEqual({ sessions: 4, p50: 3, p95: 3, max: 3 });
        });
    });

    describe("steady window", () => {
        it("counts traffic only from the closing window and leaves the join phase out", async () => {
            // Without the window check in handleFrame the join answers (all before 0.4 s) would be counted too.
            pusher = await startFakePusher("accept");
            const config = configFor(pusher.url, {
                sessions: 3,
                rampSeconds: 0.1,
                durationSeconds: 1.5,
                steadyWindowSeconds: 0.8,
            });

            const summary = await runLoad(config);

            expect(summary.window).toMatchObject({ enabled: true, seconds: 0.8, startsAtSeconds: 0.7 });
            expect(summary.window.measuredSeconds).toBeGreaterThan(0.7);
            expect(summary.window.measuredSeconds).toBeLessThanOrEqual(0.8);
            expect(summary.received.eventsByType.roomJoinedMessage).toBeUndefined();
            expect(summary.received.frames).toBeLessThan(summary.received.wholeRun.frames);
            expect(summary.received.bytes).toBeLessThan(summary.received.wholeRun.bytes);
            expect(summary.traffic.frames).toBe(summary.received.frames);
            expect(summary.traffic.bytes).toBe(summary.received.bytes);
            expect(summary.traffic.byType.userMovedMessage.messages).toBeGreaterThan(0);
        });

        it("covers the whole run, join included, when no window is set", async () => {
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url));

            expect(summary.window).toMatchObject({ enabled: false, startsAtSeconds: 0 });
            expect(summary.received.eventsByType.roomJoinedMessage).toBe(3);
            expect(summary.received.frames).toBe(summary.received.wholeRun.frames);
            expect(summary.traffic.byType.roomJoinedMessage.messages).toBe(3);
        });

        it("reports every byte as belonging to a type or to the frame headers", async () => {
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url));

            const typed = Object.values(summary.traffic.byType).reduce((total, entry) => total + entry.bytes, 0);
            expect(typed + summary.traffic.overheadBytes).toBe(summary.received.bytes);
        });
    });

    describe("server metrics", () => {
        async function startMetricsServer(): Promise<string> {
            let cpuSeconds = 0;
            metricsServer = createServer((_request, response) => {
                cpuSeconds += 0.5;
                response.setHeader("content-type", "text/plain");
                response.end(`process_cpu_seconds_total ${cpuSeconds}\nprocess_resident_memory_bytes 1000\n`);
            });
            await new Promise<void>((resolve) => metricsServer?.listen(0, "127.0.0.1", resolve));
            return `http://127.0.0.1:${(metricsServer.address() as AddressInfo).port}/metrics`;
        }

        it("scrapes the server at the start of the steady window and again at its end", async () => {
            pusher = await startFakePusher("accept");
            const metricsUrl = await startMetricsServer();
            const config = configFor(pusher.url, {
                rampSeconds: 0.1,
                durationSeconds: 1.5,
                steadyWindowSeconds: 1,
                metricsUrls: [metricsUrl],
            });

            const summary = await runLoad(config);

            // Two scrapes, 0.5 s of CPU apart: the window's start (0.5 s) and the stop (1.5 s).
            const [report] = summary.metrics;
            expect(report).toMatchObject({ url: metricsUrl, samples: 2, cpuSeconds: 0.5, rssPeakBytes: 1000 });
            expect(report.firstSampleAtSeconds).toBeGreaterThanOrEqual(0.45);
            expect(report.lastSampleAtSeconds).toBeGreaterThanOrEqual(1.45);
            expect(summary.cleanup).toEqual({ openSockets: 0, activeTimers: 0 });
            expect(summary.reconciled).toBe(true);
        });

        it("counts an endpoint that does not answer without failing the run", async () => {
            pusher = await startFakePusher("accept");
            const config = configFor(pusher.url, { metricsUrls: ["http://127.0.0.1:1/metrics"] });

            const summary = await runLoad(config);

            expect(summary.metrics[0].samples).toBe(0);
            expect(Object.values(summary.metrics[0].errors).reduce((total, count) => total + count, 0)).toBeGreaterThan(
                0,
            );
            expect(summary.sessions.accepted).toBe(3);
            expect(summary.reconciled).toBe(true);
        });

        it("reports nothing when no URL is given", async () => {
            pusher = await startFakePusher("accept");

            const summary = await runLoad(configFor(pusher.url));

            expect(summary.metrics).toEqual([]);
        });
    });
});
