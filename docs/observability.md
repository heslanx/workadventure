# WorkAdventure observability

The EU PostHog project is **WorkAdventure** (347225). Start with the
[errors and performance dashboard](https://eu.posthog.com/project/347225/dashboard/1109810).
It contains exceptions, connection outcomes, connection duration p50/p95/p99, and FPS distributions.

## Signals and questions

| Question | Signal | Where to investigate |
| --- | --- | --- |
| What failed? | Browser exceptions; backend fatal exceptions and central error handlers | Error Tracking, filtered by service/environment/release; replay when available |
| Why is room entry slow? | `wa_room_connection`: `duration_ms`, `outcome`, `retry_bucket` | Dashboard connection percentiles, then server traces |
| Why does movement feel slow? | `wa_game_performance`: FPS p10/p50 over 30 valid foreground samples | Dashboard FPS; compare with browser Web Vitals |
| Which service is slow? | HTTP, Express, gRPC, Redis and fetch spans | Tracing, services `workadventure-pusher`, `workadventure-back`, `workadventure-map-storage` |
| Is the process saturated? | HTTP duration histograms, event-loop utilization, heap usage and GC duration | Metrics; compare the same release and environment |

Browser pageviews, autocapture, Web Vitals and sampled session replay use the existing PostHog browser SDK.
Replay cannot show the game canvas, video, audio or embedded applications: these are deliberately blocked.
Room connection duration ends at the room-connected response; it does not measure the entire map download or
time until every game asset is rendered. Background tabs reset the FPS window.

## Configuration and startup

1. Install workspace dependencies with `npm ci`. Populate the deployment's environment using `.env.template`.
   `POSTHOG_API_KEY` is the public **project token**, and `POSTHOG_URL=https://eu.i.posthog.com` for this project.
   Never use a personal API key as the ingestion token. The local ignored `.env` was configured during setup;
   deployment secrets/configuration are separate.
2. Set `OBSERVABILITY_ENABLED=true`, `OBSERVABILITY_ENVIRONMENT` to the actual environment, and
   `OBSERVABILITY_RELEASE` to the deployed Git SHA. Root trace sampling defaults to `0.1`.
   `POSTHOG_REPLAY_ENABLED=true` and `POSTHOG_REPLAY_SAMPLE_RATE=0.1` enable sampled replay.
3. Start services through their package `start`/`dev` scripts or the supplied Compose files. These scripts use
   `src/bootstrap.ts`, which installs instrumentation **before** importing server dependencies. A custom
   launcher that imports `server.ts` or `index.ts` directly bypasses initialization. Plain Node/tsx launchers
   must receive environment variables from their runner; package scripts do not automatically load root `.env`.
4. Open a room and stay in the foreground for at least 30 seconds. Check PostHog for pageviews,
   `wa_room_connection`, `wa_game_performance`, and Web Vitals. Replay is sampled, so not every session appears.
   Check service startup for `observability_started`; then inspect the HTTP `x-trace-id`/`x-request-id` headers.
5. Compare p95/p99 and error counts against normal traffic before creating alerts. Set a service-specific SLO
   and notification destination first; this setup does not create unsolicited notifications.

`OBSERVABILITY_ENABLED=false` disables OpenTelemetry only. Remove the project token to disable PostHog event
and exception capture as well; disable replay independently with `POSTHOG_REPLAY_ENABLED=false`.
Invalid OpenTelemetry configuration skips telemetry with a safe warning rather than preventing startup.
An optional `OTEL_EXPORTER_OTLP_ENDPOINT` routes OTLP signals to another collector without forwarding the
PostHog token. Collector authentication must be supplied outside this implementation.

## Source maps

The Vite upload plugin is configured but needs these **build-only** variables:

```dotenv
POSTHOG_PROJECT_ID=347225
POSTHOG_HOST=https://eu.posthog.com
POSTHOG_PERSONAL_API_KEY=
OBSERVABILITY_RELEASE=<deployed-git-sha>
```

Supply the personal key through the build secret store, keep `GENERATE_SOURCEMAP` enabled, and run the normal
play build. The personal key is never part of the browser configuration. PostHog and Sentry may both upload
maps; remove public `.map` artifacts in deployment only after both uploads finish. Without the key, the build
still works, but production browser stacks may remain minified. Source-map upload has not been validated
against the live project because that build credential was not supplied.

## Correlation, privacy and overhead

- W3C trace context propagates across Node HTTP and gRPC calls. Structured completion logs include service,
  entry point, request ID, trace ID, span ID, status and duration. Request ID equals trace ID.
- Successful HTTP completion logs follow trace sampling. HTTP 5xx completion logs are retained even when the
  trace is not sampled; in that case the log's trace ID may not resolve to a stored trace. Metrics are not sampled.
  Each OTLP queue is bounded; exporters have a 3-second timeout and shutdown drains have a bounded budget.
- Exported span attributes use an allowlist: no raw URL, request payload, Redis command arguments or span
  exception events. Metric labels use bounded protocol/route dimensions with a 1,000-series cardinality limit.
- Browser replay masks input/text and blocks media/canvas/iframes. Headers, bodies and console recording are
  disabled. Event sanitizers remove credential-like values, query strings, URL fragments and email addresses.
  Backend error source snippets are removed after SDK enrichment. Avoid putting personal data in URL paths
  or free-form error messages; automatic redaction cannot recognize every possible sensitive value.
- Browser identities use the existing UUID, without sending name/email, and reset at logout. Backend exceptions
  do not create person profiles. Existing Sentry remains available for errors; when OpenTelemetry is enabled,
  the shared SDK owns tracing. Sentry's separate privacy configuration is unchanged.

The project has IP anonymization enabled, a 10% replay sample rate, and 30-day replay retention.
Existing application console output is not globally forwarded to PostHog; only the structured instrumentation
logs are exported. Central HTTP handlers, fatal errors and existing Sentry error hooks are covered. A handled
error that is only sent to Sentry requires Sentry initialization for that bridge to run; new handled backend
errors can call `captureBackendException` directly.

Native uWebSockets message processing, WebRTC media quality, Matrix and external services do not get automatic
Node HTTP spans. Browser room-connection events cover the user-visible connection outcome. Browser replay
correlation is provided by the PostHog SDK; browser-to-backend distributed trace propagation is not configured.
Feature-flag and experiment APIs remain available through the existing browser SDK, but no flags or experiments
are created without a product hypothesis. Surveys and unrelated PostHog products are not activated.

## Investigation runbook

1. Filter to the affected environment and release. Exclude `observability-validation`, which contains synthetic
   setup checks. Look at failures and p95/p99 before averages; connection counts are attempts, not unique users.
2. Open an exception and inspect its stack. For a backend error with `trace_id`, open the matching trace; for
   browser errors, inspect the associated replay when sampled. Do not expect every error to have a stored trace.
3. Find the slow span. Compare HTTP/gRPC time with Redis spans, event-loop utilization, heap and GC duration.
   High FPS loss with normal backend latency points toward client rendering/assets rather than server capacity.
4. Record the bottleneck, release and baseline. Change one cause, then compare equal traffic windows and device
   cohorts. Never claim an optimization from fewer samples or a different environment.

If data is absent, check the bootstrap entry point, project token/region, deployment environment, sampling and
outbound connectivity. Look for `observability_configuration_invalid`, `observability_start_failed` or
`posthog_export_failed`. Ingestion and insight caching can delay visibility; inspect recent event records before
concluding that an empty cached chart means exporter failure.

## Verification

```bash
npm test --workspace=@workadventure/shared-utils -- tests/Observability.spec.ts tests/PostHogErrors.spec.ts
npm test --workspace=play -- --run tests/front/Administration/PerformanceMonitoring.test.ts tests/front/Administration/PostHogConfiguration.test.ts tests/front/Administration/AnalyticsClient.test.ts
npm run check-env-docs
```

The local collector integration test verifies real HTTP/gRPC context propagation and exports of traces, logs and
metrics, including removal of request secrets. A separate test verifies sanitized PostHog exception delivery,
deduplication and shutdown flush. Browser tests execute the rendered initialization and check masking and events.

Live setup verification on 2026-11-12 confirmed synthetic exceptions, four structured logs, nine metric names
and a six-span HTTP/gRPC trace in project 347225:
[verification trace](https://eu.posthog.com/project/347225/tracing?trace=c697e4d00b4c519eac76854e5688ec27).
This is transport verification, not a production load test or a real-browser replay validation.

References: [PostHog Node tracing](https://posthog.com/docs/distributed-tracing/installation/nodejs),
[Node metrics](https://posthog.com/docs/metrics/installation/nodejs),
[replay privacy](https://posthog.com/docs/session-replay/privacy),
[Vite source maps](https://posthog.com/docs/error-tracking/upload-source-maps/vite).
