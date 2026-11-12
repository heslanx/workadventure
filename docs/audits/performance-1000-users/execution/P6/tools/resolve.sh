#!/usr/bin/env bash
# Prove which compiler binaries and which `typescript` API a package script
# would get from a given directory. Prints one JSON object per directory.
# usage: resolve.sh <dir-relative-to-/work>...
set -u
for dir in "$@"; do
  cd "/work/$dir" || exit 1
  # npm exec builds the same PATH that `npm run <script>` uses.
  npm exec --no -c 'node -e "
const { execFileSync } = require(\"child_process\");
const fs = require(\"fs\");
const path = require(\"path\");
function pkgOf(file) {
  let d = path.dirname(file);
  while (!fs.existsSync(path.join(d, \"package.json\"))) d = path.dirname(d);
  const p = JSON.parse(fs.readFileSync(path.join(d, \"package.json\"), \"utf8\"));
  return { dir: d, name: p.name, version: p.version };
}
function bin(name) {
  let found;
  try { found = execFileSync(\"which\", [name], { encoding: \"utf8\" }).trim(); } catch { return { on_path: null }; }
  const real = fs.realpathSync(found);
  let reported;
  try { reported = execFileSync(found, [\"--version\"], { encoding: \"utf8\" }).trim(); } catch (e) { reported = \"ERROR \" + e.status; }
  return { on_path: found, realpath: real, package: pkgOf(real), version_output: reported };
}
const apiEntry = require.resolve(\"typescript\");
const api = require(\"typescript\");
console.log(JSON.stringify({
  cwd: process.cwd(),
  tsc: bin(\"tsc\"),
  tsc6: bin(\"tsc6\"),
  require_typescript: { version: api.version, entry: apiEntry, package: pkgOf(apiEntry), has_createProgram: typeof api.createProgram },
  local_bin_dir_has_tsc: fs.existsSync(path.join(process.cwd(), \"node_modules/.bin/tsc\")),
}, null, 1));
"'
done
