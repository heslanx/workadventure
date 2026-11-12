import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const jobRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const label = process.argv[2];
if (!['baseline', 'candidate'].includes(label)) throw new Error('Unknown artifact label.');
const root = `${jobRoot}/baseline/play/dist/public`;
const source = JSON.parse(readFileSync(`${jobRoot}/source-manifest.json`, 'utf8'));
const files = {};
function scan(relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
        const path = join(relative, name);
        if (statSync(join(root, path)).isDirectory()) scan(path);
        else files[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
    }
}
scan();
const protocolSource = readFileSync(`${jobRoot}/baseline/libs/messages/src/JsonMessages/ApiVersion.ts`, 'utf8');
const protocolHash = /apiVersionHash = "([0-9a-f]+)"/.exec(protocolSource)?.[1];
if (!protocolHash) throw new Error('No generated protocol hash.');
if (!readFileSync(join(root, 'index.html'), 'utf8').includes(`content="${protocolHash}"`)) throw new Error('Frontend protocol metadata mismatch.');
const record = {commit:source.baselineCommit,tree:label==='baseline'?source.baselineTree:null,sourceMode:label==='baseline'?'commit':'working-tree',sourceFingerprint:label==='baseline'?source.baselineFingerprint:source.candidateFingerprint,protocolHash,nodeVersion:process.version,platform:process.platform,arch:process.arch,files};
writeFileSync(`${jobRoot}/out/${label}-frontend-manifest.json`, JSON.stringify(record,null,2)+'\n');
execFileSync('tar',['-czf',`${jobRoot}/out/${label}-public.tgz`,'-C',root,'.']);
console.info(`Archived ${label}: ${Object.keys(files).length} files, protocol ${protocolHash}.`);
