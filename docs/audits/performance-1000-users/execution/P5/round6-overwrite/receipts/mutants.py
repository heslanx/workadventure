import os, subprocess, sys
# usage: python3 mutants.py <scratch repo> <output dir>. Each mutant is the final state (12-fix) with one change.
repo, out = sys.argv[1], sys.argv[2]
rev = subprocess.check_output(['git', '-C', repo, 'log', '-1', '--format=%h', '--grep=^12-fix$']).decode().strip()
def show(f): return subprocess.check_output(['git', '-C', repo, 'show', f'{rev}:map-storage/src/{f}']).decode()
files = {'MapsManager.ts': 'MapsManager.ts', 'UploadController.ts': 'Upload/UploadController.ts',
         'tests/MapsManagerAutosave.test.ts': 'tests/MapsManagerAutosave.test.ts', 'tests/UploadController.test.ts': 'tests/UploadController.test.ts',
         'tests/MapStorageServer.test.ts': 'tests/MapStorageServer.test.ts'}
base = {k: show(v) for k, v in files.items()}
def sub(text, old, new, count=1):
    assert text.count(old) == count, old[:70]
    return text.replace(old, new)
M = {}
mm = base['MapsManager.ts']; uc = base['UploadController.ts']
no_recheck = sub(mm, "            while (\n                ready &&", "            if (\n                ready &&")
gate_off = ("        if (replacements !== undefined) {\n", "        if (replacements !== undefined && false) {\n")
# Round 5 mutants, rewritten for the final code.
M['proceed-on-timeout'] = {'MapsManager.ts': sub(mm, '                return "writesInFlight";\n            }\n            this.replacementsStarted++;', '            }\n            this.replacementsStarted++;')}
M['clear-before-wait'] = {'MapsManager.ts': sub(mm, "        try {\n            let ready = await settledBefore(earlierReplacements, deadline);",
    "        for (const key of keys) {\n            this.clearAfterUpload(key);\n        }\n        try {\n            let ready = await settledBefore(earlierReplacements, deadline);")}
M['no-recheck'] = {'MapsManager.ts': no_recheck}
M['no-load-gate'] = {'MapsManager.ts': sub(mm, *gate_off)}
M['no-recheck+no-load-gate'] = {'MapsManager.ts': sub(no_recheck, *gate_off)}
M['no-reread'] = {'MapsManager.ts': sub(mm, "        if (this.replacementsStarted !== replacementsStartedBeforeRead) {", "        if (false) {")}
M['no-dedupe'] = {'MapsManager.ts': sub(mm, "        if (loaded !== undefined) {\n            return loaded;", "        if (false) {\n            return loaded;")}
zip_old = uc[uc.index('                    const replacedWamKeys = ['):uc.index('''                    // No need to close the directory with unzipper''')]
zip_partial = '''                    let outcome = "replaced";
                    await this.fileSystem.deleteFilesExceptWAM(mapPath(directory, req), filesPathsFromZip);
                    const promises: Promise<void>[] = [];
                    for (const zipEntry of zipEntries) {
                        const key = mapPath(path.join(directory, zipEntry.path), req);
                        if (path.extname(key) === ".wam") {
                            promises.push(
                                mapsManager.replaceStoredMaps([key], () => this.fileSystem.writeFile(zipEntry, key)).then((o) => {
                                    if (o === "writesInFlight") outcome = o;
                                }),
                            );
                            wamToPurge.push(key);
                        } else {
                            promises.push(this.fileSystem.writeFile(zipEntry, key));
                        }
                    }
                    await Promise.all(promises);
                    if (outcome === "writesInFlight") {
                        rejectWhileMapIsSaving(res);
                        return;
                    }

'''
M['zip-partial'] = {'UploadController.ts': uc.replace(zip_old, zip_partial)}
M['zip-deleted-not-gated'] = {'UploadController.ts': sub(uc, "                        ...(await this.wamKeysDeletedByUpload(mapPath(directory, req), filesPathsFromZip)),\n", "")}
M['move-no-clear'] = {'UploadController.ts': sub(uc, '                if (path.extname(virtualPath) === ".wam") {\n                    // Both keys', '                if (false) {\n                    // Both keys')}
# Round 6 mutants.
M['no-replacement-serialization'] = {'MapsManager.ts': sub(mm, "let ready = await settledBefore(earlierReplacements, deadline);", "let ready = await settledBefore([], deadline);")}
M['deadline-per-wait'] = {'MapsManager.ts': sub(mm, "ready = await this.saveAndSettle(keys, saveFirst, deadline);", "ready = await this.saveAndSettle(keys, saveFirst, Date.now() + this.REPLACEMENT_WAIT_MS);")}
M['move-without-flush'] = {'UploadController.ts': sub(uc, "                        { saveFirst: [virtualPath] },\n", "")}
M['temp-file-kept-on-503'] = {'UploadController.ts': sub(uc, ".finally(() => removeUploadedFile(req.file))", ".finally(() => {\n if (res.statusCode !== 503) removeUploadedFile(req.file);\n })", 2)}
for name, over in M.items():
    d = f'{out}/m-{name}'
    os.makedirs(f'{d}/tests', exist_ok=True)
    for k in files:
        open(f'{d}/{k}', 'w').write(over.get(k, base[k]))
print(' '.join('m-' + n for n in M))
