// Lints the shader lab and its tests with the repository rules (libs/eslint-config). CI does not lint benchmark/, so this
// is run by hand, from benchmark/:
//   npx eslint -c shader-lab/eslint.config.mjs shader-lab tests/shaderlab-*.test.ts
import { generateConfig } from "@workadventure/eslint-config";

export default [
    // This file is not part of the TypeScript project below
    { ignores: ["**/*.mjs"] },
    ...generateConfig(import.meta.dirname),
    {
        languageOptions: {
            parserOptions: {
                // The shared config reads types through the project service, which finds a tsconfig by walking up from
                // each file; none exists above benchmark/tests, so name the one that covers the lab and its tests
                projectService: false,
                project: ["./tsconfig.lint.json"],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            // The lab runs one browser page at a time and times GPU draws in sequence on purpose.
            "no-await-in-loop": "off",
        },
    },
];
