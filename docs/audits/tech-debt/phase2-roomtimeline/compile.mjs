// usage (cwd /work/play): node /tools/compile.mjs <file.svelte>   prints the Svelte compiler client JS for the component
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/`);
const { compile, VERSION } = require("svelte/compiler");
const file = process.argv[2];
const { js } = compile(readFileSync(file, "utf8"), { filename: file, generate: "client", dev: false });
process.stderr.write(`svelte ${VERSION}\n`);
process.stdout.write(js.code);
