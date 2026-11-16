import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig((/*{ mode }*/) => {
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    //const env = loadEnv(mode, process.cwd(), "");
    const config = {
        publicDir: "./src-ui/public/",
        base: `${process.env.PATH_PREFIX || ""}/ui/`,
        server: {
            host: "0.0.0.0",
            port: 8080,
            hmr: {
                // workaround for development in docker
                clientPort: 80,
            },
            /*watch: {
                ignored: ["./src/pusher"],
            },*/
        },
        build: {
            sourcemap: true,
            outDir: "./dist-ui",
        },
        plugins: [
            svelte({
                preprocess: vitePreprocess(),
            }),
        ],
    };

    return config;
});
