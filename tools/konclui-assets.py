#!/usr/bin/env python3
"""Inventory selected Konclui inputs without running legacy code or copying by default."""

import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys


REPO = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO / "assets/konclui/provenance.json"
SOURCE_PREFIX = PurePosixPath("assets/konclui/source")
EXCLUDED = {"node_modules", "__pycache__", ".git", "dist", "renders", "reviews", "preview", "archive"}
GROUPS = {
    "map": {"owner": "hq-office/README.md", "notice": "office/sources/gather/NOTICE.md"},
    "sheets": {"owner": "hq-office/sources/sheets/README.md", "notice": "hq-office/sources/sheets/licenses"},
    "modern-office": {"owner": "office/modern_office.py", "notice": "office/sources/modern-office/README.md"},
    "frames": {"owner": "hq-office/frames.py", "notice": "Konclui-authored artwork"},
    "games": {"owner": "map/campus_web/games/README.md", "notice": "per-game VENDOR.md"},
    "avatars": {"owner": "avatars/README.md", "notice": "avatars/sources/manifest.json"},
    "pets": {"owner": "pets/README.md", "notice": "Konclui-authored curated species inputs"},
    "theme": {"owner": "theme/README.md", "notice": "Konclui theme; selected theme/fonts/OFL.txt for Urbanist"},
    "brand": {"owner": "konclui-platform/apps/web/src/assets", "notice": "Konclui logos; Urbanist SIL Open Font License"},
    "emotes": {"owner": "office/sources/emotes/kenney/README.md", "notice": "office/sources/emotes/kenney/License.txt"},
}


def relative_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"..", "."} for part in path.parts):
        raise ValueError(f"Unsafe relative path: {value}")
    if any(part in EXCLUDED or part.startswith(".env") for part in path.parts):
        raise ValueError(f"Excluded input: {value}")
    return path


def contained_file(root, relative):
    path = root.joinpath(*relative_path(relative).parts)
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
        raise ValueError(f"Input escapes its root or is a symlink: {relative}")
    if not path.is_file():
        raise ValueError(f"Missing required input: {relative}")
    return path


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def literal_assignment(path, name):
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError(f"Required literal assignment {name} missing from {path.name}")


def select(reference, brand=None):
    selected = {}
    roots_by_name = {"reference": reference, "brand": brand}

    def add(relative, group, kind="source", source_root="reference", destination=None):
        path = contained_file(roots_by_name[source_root], relative)
        entry = {"source": relative, "sourceRoot": source_root,
                 "destination": str(SOURCE_PREFIX / (destination or relative)), "group": group,
                 "kind": kind, "bytes": path.stat().st_size, "sha256": digest(path)}
        key = relative if source_root == "reference" else f"{source_root}:{relative}"
        if key in selected and selected[key] != entry:
            raise ValueError(f"Conflicting classification: {relative}")
        selected[key] = entry

    def files(folder, group, suffixes, kind="source"):
        root = reference / folder
        if not root.is_dir():
            raise ValueError(f"Missing required directory: {folder}")
        for path in sorted(root.rglob("*")):
            relative = path.relative_to(reference)
            if any(part in EXCLUDED for part in relative.parts):
                continue
            if path.is_file() and (path.suffix.lower() in suffixes or path.name.startswith(("LICENSE", "NOTICE"))):
                add(relative.as_posix(), group, kind)

    queue = ["hq-office/build.py", "office/modern_office.py"]
    searched = set()
    roots = [reference / p for p in ("hq-office", "office", "map")]
    while queue:
        relative = queue.pop()
        if relative in searched:
            continue
        searched.add(relative)
        add(relative, "map")
        module = ast.parse((reference / relative).read_text())
        nodes = list(module.body)
        if relative == "hq-office/sheets.py":
            nodes += [node for function in module.body if isinstance(function, ast.FunctionDef)
                      and function.name == "pieces" for node in ast.walk(function)]
        for node in nodes:
            modules = [a.name for a in node.names] if isinstance(node, ast.Import) else []
            if isinstance(node, ast.ImportFrom) and node.module:
                modules.append(node.module)
            for module in modules:
                found = False
                for root in roots:
                    candidate = root.joinpath(*module.split(".")).with_suffix(".py")
                    if candidate.is_file():
                        queue.append(candidate.relative_to(reference).as_posix())
                        found = True
                        break
                if not found and module.split(".")[0] not in sys.stdlib_module_names | {"numpy", "PIL"}:
                    raise ValueError(f"Unresolved Python input {module} imported by {relative}")

    for name in ("editor-edits.json", "taxonomy.json", "taxonomy.schema.json", "map-script.js", "README.md"):
        add(f"hq-office/{name}", "map")
    add("hq-office/sources/seat-front-folds.json", "map")
    for name in literal_assignment(reference / "hq-office/build.py", "RUNTIME_HERE"):
        add(f"hq-office/runtime/{name}", "map")
    for name in literal_assignment(reference / "hq-office/build.py", "RUNTIME_OFFICE"):
        add(f"office/runtime/{name}", "map")
    for name in ("index.html", "draw.mjs", "field.mjs", "koi.mjs", "simulation.mjs", "README.md"):
        add(f"hq-office/pool/koi/{name}", "map")
    add("hq-office/reactions/index.html", "map")
    for name in ("lake.mp3", "coffee.mp3", "sale.mp3"):
        add(f"media/sounds/{name}", "map", "authored-asset")
    files("hq-office/sources/sheets", "sheets", {".png", ".md", ".assets"}, "authored-asset")
    files("office/sources/modern-office", "modern-office", {".png", ".md"}, "authored-asset")

    for name in ("catalog.json", "names-pt.json", "NOTICE.md"):
        add(f"office/sources/gather/{name}", "map", "catalog-input")
    catalogue = json.loads((reference / "office/sources/gather/catalog.json").read_text())
    hashes = set()
    for category in ("furniture", "floors", "walls", "doors"):
        for item in catalogue[category]:
            for key in ("main", "foreground", "sha"):
                if item.get(key):
                    hashes.add(item[key])
    for sha in sorted(hashes):
        if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise ValueError("Invalid image identity in furniture catalogue")
        relative = f"office/sources/gather/files/{sha}.png"
        add(relative, "map", "authored-asset")
        if selected[relative]["sha256"] != sha:
            raise ValueError(f"Catalogue image content does not match its identity: {relative}")

    for art_id, (_, source, _) in literal_assignment(reference / "hq-office/frames.py", "ART").items():
        if source == "gen":
            add(f"design/interiors/2026-10-18/brand-frames/originals/{art_id}.png", "frames", "authored-asset")
        elif source.startswith("svg:"):
            add(f"design/interiors/2026-10-18/brand-frames/refs/{source[4:]}", "frames", "authored-asset")
    add(".dream-loop/proof/assets/koru/celebration.svg", "frames", "authored-asset",
        destination="brand/koru-celebration.svg")
    files("map/campus_web/games", "games", {".html", ".js", ".mjs", ".css", ".json", ".png", ".svg", ".mp3", ".wav", ".ogg", ".md"})
    add("map/campus_web/sale.html", "map")

    for name in ("catalog.json", "sections.json", "sections.schema.json", "sections.py", "native_export.py", "README.md", "LEARNINGS.md"):
        add(f"avatars/{name}", "avatars", "catalog-input" if name == "catalog.json" else "source")
    add("avatars/sources/manifest.json", "avatars")
    for piece in json.loads((reference / "avatars/sections.json").read_text())["legacyPieces"]:
        add(piece["file"], "avatars", "authored-asset")
    for name in ("petkit.py", "catalog.py"):
        add(f"pets/tools/{name}", "pets")
    add("pets/README.md", "pets")
    species = sorted((reference / "pets/species").glob("*/species.json"))
    if not species:
        raise ValueError("Missing required pet species inputs")
    for spec in species:
        for name in ("base.png", "species.json", "palette.json"):
            add((spec.parent / name).relative_to(reference).as_posix(), "pets", "curated-build-input")

    for name in ("fonts/urbanist-latin.woff2", "avatars/logo.svg"):
        add(f"theme/{name}", "theme", "authored-asset")
    if brand:
        for name in ("logo-konclui-white.svg", "logo-konclui-icon.svg"):
            add(name, "brand", "authored-asset", "brand", f"brand/{name}")
        add("fonts/pdf/urbanist-OFL.txt", "brand", "notice", "brand", "theme/fonts/OFL.txt")
    for name in ("theme.css", "moment-hud.css", "README.md"):
        add(f"theme/{name}", "theme", "migration-reference")
    files("office/sources/emotes/kenney", "emotes", {".png", ".md", ".txt"}, "authored-asset")

    return {
        "version": 1,
        "selection": "Native migration inputs, not a complete standalone build certification",
        "groups": GROUPS,
        "openDependencies": [
            {"owner": "hq-office/signature.py", "issue": "Build path requires relocation",
             "required": ["logo-konclui-white.svg", "logo-konclui-icon.svg"],
             "inputsSelected": bool(brand),
             "resolution": "Use Path(__file__).resolve().parent.parent / 'brand' instead of the absolute external path"},
            {"owner": "hq-office/pool.py", "issue": "Absolute external logo and historical Koru input path",
             "resolution": "Read brand/logo-konclui-icon.svg and brand/koru-celebration.svg under the selected source root"},
            {"owner": "avatars/native_export.py", "issue": "Exporter writes injected HTML and shares legacy catalogue paths with avatars/sections.py and pets/tools/catalog.py",
             "resolution": "Separate pure catalogue export from HTML injection; provide target upstream woka/companion catalogues explicitly"},
        ],
        "inputBoundaries": [
            "avatars/catalog.json is the curated palette/RLE input; original authoring and legacy-v1/v2 rebuild chains are excluded",
            "pets/species base.png, species.json and palette.json regenerate runtime atlases; historical AI generation runs are excluded",
            "Brand SVGs and Urbanist OFL notice come from the explicitly supplied brand-assets directory" if brand else "Brand SVGs and Urbanist OFL notice are not selected without --brand-assets",
        ],
        "files": sorted(selected.values(), key=lambda entry: (entry["sourceRoot"], entry["source"])),
    }


def copy_selected(reference, target, entries, brand=None):
    pending = []
    for entry in entries:
        root = {"reference": reference, "brand": brand}.get(entry.get("sourceRoot", "reference"))
        if root is None:
            raise ValueError(f"Missing source root: {entry.get('sourceRoot')}")
        source = contained_file(root, entry["source"])
        if digest(source) != entry["sha256"]:
            raise ValueError(f"Source changed during import: {entry['source']}")
        relative = relative_path(entry["destination"])
        if not relative.is_relative_to(SOURCE_PREFIX):
            raise ValueError(f"Destination outside the selected-source directory: {relative}")
        destination = target.joinpath(*relative.parts)
        if not destination.resolve().is_relative_to(target.resolve()) or any(
            (target / parent).is_symlink() for parent in [relative, *relative.parents]
        ):
            raise ValueError(f"Unsafe destination: {relative}")
        if destination.exists():
            if not destination.is_file() or digest(destination) != entry["sha256"]:
                raise ValueError(f"Refusing to replace existing work: {relative}")
        else:
            pending.append((source, destination, entry["sha256"]))
    for source, destination, expected in pending:
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Source changed during import: {source.name}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            stream.write(data)
    return len(pending)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--brand-assets", type=Path)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write-manifest", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--import", dest="copy", action="store_true")
    args = parser.parse_args()
    try:
        brand = args.brand_assets.resolve() if args.brand_assets else None
        document = select(args.reference.resolve(), brand)
        encoded = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        if args.check or args.copy:
            if json.loads(args.manifest.read_text()) != document:
                raise ValueError("Manifest differs from current selected inputs; review the drift before importing")
        if args.write_manifest:
            if args.manifest.exists() and args.manifest.read_text() != encoded:
                raise ValueError("Refusing to overwrite a different manifest; write a separate candidate for review")
            args.manifest.parent.mkdir(parents=True, exist_ok=True)
            args.manifest.write_text(encoded)
        copied = copy_selected(args.reference.resolve(), REPO, document["files"], brand) if args.copy else 0
        print(json.dumps({"files": len(document["files"]), "bytes": sum(e["bytes"] for e in document["files"]),
                          "copied": copied, "openDependencies": len(document["openDependencies"]),
                          "mode": "import" if args.copy else "check" if args.check else "manifest" if args.write_manifest else "dry-run"}))
    except (ValueError, OSError, KeyError, SyntaxError) as error:
        print(f"Asset inventory failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
