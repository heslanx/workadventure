#!/usr/bin/env node
// Verifies that the imported historical audit files still match evidence/import-manifest.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const auditRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { files } = JSON.parse(readFileSync(resolve(auditRoot, "evidence/import-manifest.json"), "utf8"));

let failures = 0;
for (const { saved_as: savedAs, bytes, sha256 } of files) {
    let matches = false;
    try {
        const content = readFileSync(resolve(auditRoot, savedAs));
        matches = content.length === bytes && createHash("sha256").update(content).digest("hex") === sha256;
    } catch {
        matches = false;
    }
    if (!matches) failures++;
    console.log(`${matches ? "OK  " : "FAIL"} ${savedAs}`);
}
console.log(`${files.length - failures}/${files.length} files match the import manifest`);
process.exit(failures === 0 ? 0 : 1);
