import os, subprocess, sys
# usage: python3 mutants.py <repo with the final stack> <rev> <output dir>
repo, rev, out = sys.argv[1], sys.argv[2], sys.argv[3]
def show(rev, f): return subprocess.check_output(['git', '-C', repo, 'show', f'{rev}:map-storage/src/{f}']).decode()
files = {'MapsManager.ts': 'MapsManager.ts', 'UploadController.ts': 'Upload/UploadController.ts',
         'MapsManagerAutosave.test.ts': 'tests/MapsManagerAutosave.test.ts', 'UploadController.test.ts': 'tests/UploadController.test.ts'}
base = {k: show(rev, v) for k, v in files.items()}
def sub(text, old, new):
    assert text.count(old) == 1, old[:70]
    return text.replace(old, new)
M = {}
mm = base['MapsManager.ts']; uc = base['UploadController.ts']
no_recheck = sub(mm, "        return this.writesSettle(keys, deadline);\n", "        return true;\n")
gate_off = ("        if (replacements !== undefined) {\n", "        if (replacements !== undefined && false) {\n")
M['proceed-on-timeout'] = {'MapsManager.ts': sub(mm, '            return "writesInFlight";\n        }\n        // No write', '        }\n        // No write')}
# Round 4 order: drop the maps, then wait. Round 4's MapsManager.ts, which differs from the final one only there and in comments.
M['clear-before-wait'] = {'MapsManager.ts': subprocess.check_output(['git', '-C', repo, 'show', f'{rev}~1:map-storage/src/MapsManager.ts']).decode()}
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
for name, over in M.items():
    d = f'{out}/m-{name}'
    os.makedirs(d, exist_ok=True)
    for k in files:
        open(f'{d}/{k}', 'w').write(over.get(k, base[k]))
print(' '.join(M))
