import assert from "node:assert/strict";
import { once } from "node:events";
import type { ServerUnaryCall, sendUnaryData } from "@grpc/grpc-js";
import type { PingMessage } from "@workadventure/messages/src/ts-proto-generated/messages";
import { startNodeTelemetry } from "../../src/Observability/NodeTelemetry";
import { runDrains } from "../../src/ShutdownDrains";

startNodeTelemetry("pusher");
const { context, trace } = await import("@opentelemetry/api");
const http = await import("node:http");
const { default: express } = await import("express");
const grpc = await import("@grpc/grpc-js");
const { RoomManagerClient, RoomManagerService } =
    await import("@workadventure/messages/src/ts-proto-generated/services");
const grpcServer = new grpc.Server();
let rpcTrace: string | undefined;
grpcServer.addService(
    { ping: RoomManagerService.ping },
    {
        ping: (_call: ServerUnaryCall<PingMessage, PingMessage>, callback: sendUnaryData<PingMessage>) => {
            rpcTrace = trace.getSpan(context.active())?.spanContext().traceId;
            callback(null, {});
        },
    },
);
const rpcPort = await new Promise<number>((resolve, reject) => {
    grpcServer.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) =>
        error ? reject(error) : resolve(port),
    );
});
const rpcClient = new RoomManagerClient(`127.0.0.1:${rpcPort}`, grpc.credentials.createInsecure());
const app = express();
let receivedTrace: string | undefined;
app.get("/downstream/:id", (_req, res) => {
    receivedTrace = trace.getSpan(context.active())?.spanContext().traceId;
    res.json({ ok: true });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const get = (url: string): Promise<void> =>
    new Promise((resolve, reject) => {
        http.get(url, (res) => {
            res.resume();
            res.on("end", resolve);
        }).on("error", reject);
    });
let incomingTrace: string | undefined;
app.get("/upstream", async (_req, res) => {
    incomingTrace = trace.getSpan(context.active())?.spanContext().traceId;
    await get(`${base}/downstream/private-person?token=private-token`);
    await new Promise<void>((resolve, reject) => {
        rpcClient.ping({}, (error) => (error ? reject(error) : resolve()));
    });
    res.end("ok");
});
app.get("/failure", (_req, res) => res.status(503).end("unavailable"));
try {
    await get(`${base}/upstream`);
    await get(`${base}/failure`);
    assert(incomingTrace && incomingTrace !== "00000000000000000000000000000000");
    assert.equal(receivedTrace, incomingTrace, "HTTP trace propagation must preserve the request");
    assert.equal(rpcTrace, incomingTrace, "gRPC trace propagation must preserve the request");
    console.log(JSON.stringify({ event: "observability_smoke_passed", traceId: incomingTrace }));
} finally {
    rpcClient.close();
    await new Promise<void>((resolve, reject) => {
        grpcServer.tryShutdown((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
    await runDrains(5000);
}
