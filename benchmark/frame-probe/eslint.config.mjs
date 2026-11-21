// Lints the frame probe and its tests with the repository rules (libs/eslint-config). benchmark/ has no lint script and
// no tsconfig of its own, and CI does not lint it, so this is run by hand, from benchmark/:
//   npx eslint -c frame-probe/eslint.config.mjs frame-probe tests/frameprobe-*.test.ts tests/support/frameProbeFixtures.ts
import { generateConfig } from "@workadventure/eslint-config";

export default [
    // This file is not part of the TypeScript project below
    { ignores: ["**/*.mjs"] },
    ...generateConfig(import.meta.dirname),
    {
        languageOptions: {
            parserOptions: {
                // The shared config reads types through the project service, which finds a tsconfig by walking up from
                // each file; none exists above benchmark/tests, so name the one that covers the probe and its tests
                projectService: false,
                project: ["./tsconfig.lint.json"],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            // The probe measures one browser session at a time on purpose: concurrent sessions would share the machine
            // and the bots, and perturb each other's frames. The same exception is made for tests/ (Playwright).
            "no-await-in-loop": "off",
        },
    },
];
