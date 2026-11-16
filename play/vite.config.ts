import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import posthog from "@posthog/rollup-plugin";
import { noiseSuppressionAudioWorkletVitePlugin } from "@workadventure/noise-suppression/vite";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { apiVersionHash } from "../libs/messages/src/JsonMessages/ApiVersion";

// Matrix is only for logged-in users (GameManager loads it with import()): keep the SDK out of the chunks every
// visitor downloads. A single value import of it anywhere on the startup path would silently bring it all back.
const matrixStaysLazy: Plugin = {
    name: "workadventure-matrix-stays-lazy",
    apply: "build",
    generateBundle(_options, bundle) {
        const visited = new Set<string>();
        const visit = (fileName: string) => {
            const chunk = bundle[fileName];
            if (visited.has(fileName) || chunk?.type !== "chunk") {
                return;
            }
            visited.add(fileName);
            // EventType (lib/@types/event.js, with its NamespacedValue import) is tiny and allowed.
            const leak = chunk.moduleIds.find((id) =>
                /\/matrix-js-sdk\/lib\/(?!@types\/|NamespacedValue\.js)/.test(id),
            );
            if (leak) {
                this.error(`${leak} is in the startup chunk ${fileName}: load Matrix code with import().`);
            }
            chunk.imports.forEach(visit);
        };
        for (const chunk of Object.values(bundle)) {
            if (chunk.type === "chunk" && chunk.isEntry) {
                visit(chunk.fileName);
            }
        }
    },
};

function watchedDirGlob(relativeDir: string): string {
    return fileURLToPath(new URL(relativeDir, import.meta.url)) + "/**";
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const env = loadEnv(mode, process.cwd(), "");
    const watchPolling = env.VITE_WATCH_POLLING === "true";
    const config = {
        // Relative base: every URL Vite emits resolves against the file that references it, so the build can be
        // served from any origin (the pusher itself, or an assets domain set at runtime with ASSETS_URL).
        base: "./",
        server: {
            host: "0.0.0.0",
            port: 8080,
            // When the page loads its modules from another origin (ASSETS_URL), asset URLs must be absolute.
            origin: env.ASSETS_URL || undefined,
            ws: {
                // workaround for development in docker
                clientPort: 80,
                // The dev module graph is served same-origin under the play host (see the
                // `play-vite` Traefik router in docker-compose.yaml), so pin the HMR websocket to
                // the Vite host explicitly. Otherwise the client opens the HMR socket against the
                // play host, which routes to the pusher instead of Vite and HMR fails to connect.
                host: "front.workadventure.localhost",
            },
            watch: {
                // Absolute globs: chokidar matches ignored paths against absolute ones, so "./src/pusher" ignored nothing.
                // Vitest's watch mode reuses this watcher and must still see the pusher, hence the dev-only list.
                ignored:
                    mode === "test"
                        ? []
                        : [
                              watchedDirGlob("./src/pusher"),
                              // Polling stats every watched file, so it also skips the asset folders of public/ (a
                              // third of the files): a new file in them is served after a restart of Vite, an edited
                              // one at once. public/ itself stays watched for iframe_api.js, built while Vite runs.
                              ...(watchPolling
                                  ? ["./public/resources", "./public/static", "./public/collections"].map(
                                        watchedDirGlob,
                                    )
                                  : []),
                          ],
                // Colima's mountInotify only forwards in-place writes; an editor that saves by renaming a temp file
                // over the original never reaches the container. Polling catches those saves too, at a CPU cost.
                ...(watchPolling
                    ? { usePolling: true, interval: Number(env.VITE_WATCH_POLLING_INTERVAL) || 1000 }
                    : {}),
            },
        },
        build: {
            sourcemap: env.GENERATE_SOURCEMAP !== "false",
            outDir: "./dist/public",
            rollupOptions: {
                input: {
                    main: path.resolve(process.cwd(), "index.html"),
                },
                // external: ["@mediapipe/tasks-vision"],
                //plugins: [inject({ Buffer: ["buffer/", "Buffer"] })],
            },
            assetsInclude: ["**/*.tflite", "**/*.wasm"],
        },
        plugins: [
            {
                // The pusher only uses an index.html built for the same protocol as its own (see FrontAssets.ts).
                name: "workadventure-api-version",
                transformIndexHtml: () => [
                    { tag: "meta", attrs: { name: "wa-api-version", content: apiVersionHash }, injectTo: "head" },
                ],
            },
            matrixStaysLazy,
            tailwindcss(),
            noiseSuppressionAudioWorkletVitePlugin(),
            nodePolyfills({
                include: ["events", "buffer"],
                globals: {
                    Buffer: true,
                },
            }),
            svelte({
                preprocess: vitePreprocess(),
                onwarn(warning, defaultHandler) {
                    // don't warn on:
                    if (warning.code === "Unknown at rule @container (css)") return;
                    if (warning.message.includes("Unknown at rule @container")) return;

                    // handle all other warnings normally
                    if (defaultHandler) {
                        defaultHandler(warning);
                    }
                },
            }),
            Icons({
                compiler: "svelte",
            }),
        ],
        resolve: {
            // Without this, vitest resolves Svelte to its server build and mount() is unavailable.
            conditions: mode === "test" ? ["browser"] : undefined,
            alias: {
                events: "events",
                "@wa-icons": fileURLToPath(new URL("./src/front/Components/Icons.ts", import.meta.url)),
                "@wa-modals": fileURLToPath(new URL("./src/front/Components/Modal/modalManager.ts", import.meta.url)),
            },
        },
        test: {
            // Most tests need no DOM: a test that does declares it with `// @vitest-environment jsdom` on its
            // first line. Starting jsdom for every file cost more than half of the suite's run time.
            environment: "node",
            globals: true,
            setupFiles: ["./tests/setup/vitest.setup.ts"],
            experimental: {
                // Keeps transformed modules on disk between runs (node_modules/.experimental-vitest-cache):
                // transform time drops from about 100 s to 30 s once the cache is warm.
                fsModuleCache: true,
            },
            coverage: {
                all: true,
                include: ["src/*.ts", "src/**/*.ts"],
                exclude: ["src/i18n", "src/enum"],
            },
        },
        optimizeDeps: {
            exclude: ["svelte-modals"],
            rolldownOptions: {
                transform: {
                    define: {
                        global: "globalThis",
                    },
                },
            },
        },
    };

    if (env.SENTRY_ORG && env.SENTRY_PROJECT && env.SENTRY_AUTH_TOKEN && env.SENTRY_RELEASE && env.SENTRY_ENVIRONMENT) {
        console.info("Sentry plugin enabled");
        config.plugins.push(
            sentryVitePlugin({
                url: env.SENTRY_URL || "https://sentry.io/",
                org: env.SENTRY_ORG,
                project: env.SENTRY_PROJECT,
                // Specify the directory containing build artifacts
                sourcemaps: {
                    assets: "./dist/public/**",
                },
                // Auth tokens can be obtained from https://sentry.io/settings/account/api/auth-tokens/
                // and needs the `project:releases` and `org:read` scopes
                authToken: env.SENTRY_AUTH_TOKEN,
                // Optionally uncomment the line below to override automatic release name detection
                release: {
                    name: env.SENTRY_RELEASE,
                    deploy: {
                        env: env.SENTRY_ENVIRONMENT,
                    },
                    finalize: true,
                },
            }),
        );
    } else {
        console.info("Sentry plugin disabled");
    }
    if (env.POSTHOG_PERSONAL_API_KEY && env.POSTHOG_PROJECT_ID && env.POSTHOG_HOST) {
        // PostHog supports Rolldown at runtime; its published types still use Rollup's PluginContext.
        config.plugins.push(
            posthog({
                personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
                projectId: env.POSTHOG_PROJECT_ID,
                host: env.POSTHOG_HOST,
                sourcemaps: {
                    enabled: true,
                    releaseName: "workadventure-play",
                    releaseVersion: env.OBSERVABILITY_RELEASE || env.SENTRY_RELEASE,
                    // Sentry may upload the same maps; artifact removal belongs to deployment.
                    deleteAfterUpload: false,
                },
            }) as Plugin,
        );
    }
    return config;
});
