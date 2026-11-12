import { createHash } from 'node:crypto';
import { chown, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function relativePath(value) {
    if (typeof value !== 'string' || !value || value.split('/').some(part => !part || part === '.' || part === '..') || value.includes('\\')) {
        throw new Error(`Invalid artifact path: ${value}`);
    }
    return value;
}

async function filesUnder(root, relative = '') {
    const result = [];
    if (!(await lstat(join(root, relative))).isDirectory()) throw new Error(`Invalid artifact directory: ${root}/${relative}`);
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Artifact symlink is forbidden: ${name}`);
        if (entry.isDirectory()) result.push(...await filesUnder(root, name));
        else if (entry.isFile()) result.push(name);
        else throw new Error(`Unsupported artifact file: ${name}`);
    }
    return result.sort();
}

async function verify(root, files, folders) {
    const actual = [];
    for (const folder of folders) {
        const prefix = folder ? `${folder}/` : '';
        actual.push(...(await filesUnder(join(root, folder))).map(name => prefix + name));
    }
    if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(files).sort())) {
        throw new Error(`Artifact inventory changed: ${root}`);
    }
    for (const [name, expected] of Object.entries(files)) {
        const bytes = await readFile(join(root, relativePath(name)));
        if (createHash('sha256').update(bytes).digest('hex') !== expected) {
            throw new Error(`Artifact hash mismatch: ${name}`);
        }
    }
}

async function exists(path) {
    try { return await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

const prepared = JSON.parse(await readFile('/input/prepared.json', 'utf8'));
if (prepared.version !== 1 || prepared.project !== 'konclui-native-candidate') throw new Error('Unexpected preparation contract');
await verify('/input/front', prepared.frontFiles, ['']);
await verify('/input/assets', prepared.assetFiles, ['maps', 'resources', 'catalogues']);

const root = '/maps/konclui-office';
const lock = '/maps/.konclui-seed-lock';
await mkdir(lock); let staging;
try {
    const existing = await exists(root);
    if (existing) {
        if (!existing.isDirectory() || !(await exists(`${root}/office.wam`))?.isFile()) {
            throw new Error('Existing candidate map has no regular office.wam; preserve it and inspect manually');
        }
        console.log('Candidate map already exists; preserved all editor-authored files.');
    } else {
        staging = `/maps/.konclui-seed-${process.pid}`;
        await mkdir(staging);
        const prefix = 'maps/konclui-office/';
        for (const name of Object.keys(prepared.assetFiles).filter(name => name.startsWith(prefix))) {
            const target = join(staging, name.slice(prefix.length));
            await mkdir(dirname(target), { recursive: true });
            await copyFile(join('/input/assets', name), target);
            const copied = createHash('sha256').update(await readFile(target)).digest('hex');
            if (copied !== prepared.assetFiles[name]) throw new Error(`Map changed during seed: ${name}`);
            await chown(target, 1000, 1000);
        }
        await writeFile(`${staging}/.candidate-seed.json`, JSON.stringify({
            version: 1, assetReceiptSha256: prepared.assetReceiptSha256, seededAt: new Date().toISOString(),
        }) + '\n');
        async function ownDirectories(path) {
            await chown(path, 1000, 1000);
            for (const entry of await readdir(path, { withFileTypes: true })) {
                if (entry.isDirectory()) await ownDirectories(join(path, entry.name));
            }
        }
        await ownDirectories(staging);
        await chown(`${staging}/.candidate-seed.json`, 1000, 1000);
        await chown('/maps', 1000, 1000);
        await rename(staging, root);
        staging = undefined;
        console.log('Seeded candidate map into its project-owned volume.');
    }
} finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true });
}
