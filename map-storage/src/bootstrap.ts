import { startPostHogErrors } from "@workadventure/shared-utils/src/Observability/PostHogErrors";
import { startNodeTelemetry } from "@workadventure/shared-utils/src/Observability/NodeTelemetry";

// Instrument dependencies before the service module graph is evaluated.
startNodeTelemetry("map-storage");
startPostHogErrors("map-storage");
await import("./index");
