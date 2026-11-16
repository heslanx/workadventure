import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Keeps transformed modules on disk between runs (node_modules/.experimental-vitest-cache).
        experimental: {
            fsModuleCache: true,
        },
        coverage: {
            include: ["src/*.ts", "src/**/*.ts"],
        },
    },
});
