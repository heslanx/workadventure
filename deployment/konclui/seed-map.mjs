import { access, chown, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = '/maps/baseline';
try {
    await access(`${root}/office.wam`);
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const files = ['tests/E2E/empty.json', 'tests/E2E/empty.js', 'tests/tileset1.png'];
    for (const file of files) {
        await mkdir(dirname(`${root}/${file}`), { recursive: true });
        await copyFile(`/source/${file}`, `${root}/${file}`);
    }
    await writeFile(`${root}/office.wam`, JSON.stringify({
        version: '2.1.0',
        mapUrl: 'tests/E2E/empty.json',
        entities: {},
        areas: [],
        entityCollections: [],
    }), { flag: 'wx' });
    for (const path of ['/maps', root, `${root}/tests`, `${root}/tests/E2E`, `${root}/office.wam`, ...files.map((file) => `${root}/${file}`)]) {
        await chown(path, 1000, 1000);
    }
}
