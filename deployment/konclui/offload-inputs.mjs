import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const jobRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const manifest = JSON.parse(readFileSync(`${jobRoot}/source-manifest.json`, 'utf8'));
function pathIn(root, name) {
    const path = resolve(root, name);
    if (!path.startsWith(`${root}/`) || name.split('/').some((part) => part.startsWith('.env'))) {
        throw new Error(`Invalid source path: ${name}`);
    }
    return path;
}
function verify(root, files) {
    for (const [name, expected] of Object.entries(files)) {
        const path = pathIn(root, name);
        const bytes = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
        const actual = createHash('sha256').update(bytes).digest('hex');
        if (actual !== expected) throw new Error(`Source hash differs: ${name}`);
    }
}
verify(`${jobRoot}/candidate-overlay`, manifest.overlayFiles);
if (process.argv[2] === 'verify') {
    verify(`${jobRoot}/baseline`, manifest.baselineFiles);
} else if (process.argv[2] === 'apply') {
    for (const name of manifest.deletedFiles) rmSync(pathIn(`${jobRoot}/baseline`, name));
    for (const name of Object.keys(manifest.overlayFiles)) {
        const destination = pathIn(`${jobRoot}/baseline`, name);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(pathIn(`${jobRoot}/candidate-overlay`, name), destination);
    }
    verify(`${jobRoot}/baseline`, manifest.overlayFiles);
} else {
    throw new Error('Expected verify or apply.');
}
console.info(`Verified ${process.argv[2]} source hashes.`);
