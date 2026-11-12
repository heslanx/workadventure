"""Checks a built campus against WorkAdventure's rules and our own invariants. Read-only.

The rules and their closed list of codes come from mgkyawzayya/wa-agent-engine (src/core/validator.ts, MIT, read in
_refs/ at dd5df06 on 2026-10-11, rewritten here; nothing of it runs) plus the checks of our generators: link anchors,
seats, doors kept clear, glass and walls with collision. An agent branches on the code, not on the message.

Inputs: <dist dir>/office.tmj and office.wam, and build_report.json when the generator wrote one (wall and door cells,
seats, anchors, arrival). Without the report only the map-level checks run.

Run: python3 map/validate_map.py office/dist [--json]      exit 0 = no errors (warnings allowed), 1 = errors
"""
import json
import re
import sys
from collections import deque
from pathlib import Path

CODES = [
    # map basics and layers
    "NOT_ORTHOGONAL", "TILE_SIZE_NOT_32", "INFINITE_MAP", "MISSING_FLOOR_LAYER", "OVERLAY_ABOVE_FLOOR",
    "LAYER_SIZE_MISMATCH",
    # tilesets and tiles
    "NON_EMBEDDED_TILESET", "TILESET_IMAGE_MISSING", "COLLIDES_NOT_BOOL", "MISSING_COPYRIGHT", "INVALID_GID",
    # walls, doors, arrival, seats (need build_report.json)
    "WALL_WITHOUT_COLLISION", "ISOLATED_WALL", "DOOR_BLOCKED", "DOOR_FRONT_BLOCKED", "DOOR_UNREACHABLE",
    "DOOR_AT_CORNER", "DOOR_TOO_CLOSE", "START_TILE_BLOCKED", "MISSING_START", "SEAT_UNREACHABLE", "SEAT_BLOCKED",
    "ROOM_UNREACHABLE",
    # areas (.wam) and objects (.tmj)
    "AREA_WITHOUT_SIZE", "OUT_OF_BOUNDS_AREA", "DUPLICATE_AREA_NAME", "ANCHOR_SHARED", "BAD_URL",
    "MEGAPHONE_SPEAKER_MISSING", "VARIABLE_NOT_DECLARED", "LABEL_COVERED", "LABEL_TOO_LONG",
    # map script
    "SCRIPT_NOT_FOUND", "SCRIPT_EXTERNAL",
]
FLIPS = 0x1FFFFFFF
MAX_PER_CODE = 25


class Report:
    def __init__(self):
        self.errors, self.warnings, self.omitted = [], [], 0
        self.count = {}

    def add(self, level, code, message, **where):
        assert code in CODES, code
        n = self.count.get(code, 0)
        self.count[code] = n + 1
        if n >= MAX_PER_CODE:
            self.omitted += 1
            return
        (self.errors if level == "error" else self.warnings).append({"code": code, "message": message, **where})


def flat_layers(layers, prefix=""):
    for lay in layers:
        path = prefix + lay["name"]
        yield path, lay
        if lay["type"] == "group":
            yield from flat_layers(lay["layers"], path + "/")


def prop(obj, name):
    for p in obj.get("properties") or []:
        if p.get("name") == name:
            return p
    return None


def check_map(dist, R):
    m = json.loads((dist / "office.tmj").read_text())
    W, H = m["width"], m["height"]
    if m.get("orientation") != "orthogonal":
        R.add("error", "NOT_ORTHOGONAL", f"WorkAdventure needs an orthogonal map, not {m.get('orientation')}")
    if m.get("tilewidth") != 32 or m.get("tileheight") != 32:
        R.add("error", "TILE_SIZE_NOT_32", "tiles must be 32x32")
    if m.get("infinite"):
        R.add("error", "INFINITE_MAP", "WorkAdventure rejects infinite maps")
    layers = list(flat_layers(m["layers"]))
    top = [lay["name"] for lay in m["layers"]]
    if "floorLayer" not in top or next(lay for lay in m["layers"] if lay["name"] == "floorLayer")["type"] != "objectgroup":
        R.add("error", "MISSING_FLOOR_LAYER", "there is no top-level object layer named floorLayer")
    else:
        floor_i = top.index("floorLayer")
        if "collisions" in top and top.index("collisions") > floor_i:
            R.add("error", "OVERLAY_ABOVE_FLOOR", "the collisions layer draws above the avatars", layer="collisions")
    # tilesets
    ranges = []
    for ts in m["tilesets"]:
        if "source" in ts:
            R.add("error", "NON_EMBEDDED_TILESET", f"tileset {ts['source']} is external")
            continue
        if "image" not in ts:
            R.add("error", "NON_EMBEDDED_TILESET", f"tileset {ts['name']} is an image collection")
            continue
        if not (dist / ts["image"]).is_file():
            R.add("error", "TILESET_IMAGE_MISSING", f"tileset {ts['name']}: {ts['image']} is not in the build")
        for tile in ts.get("tiles", []):
            c = prop(tile, "collides")
            if c is not None and c.get("type") != "bool":
                R.add("error", "COLLIDES_NOT_BOOL", f"tileset {ts['name']} tile {tile['id']}: collides must be bool")
        if prop(ts, "tilesetCopyright") is None:
            R.add("warning", "MISSING_COPYRIGHT", f"tileset {ts['name']} has no tilesetCopyright")
        ranges.append((ts["firstgid"], ts["firstgid"] + ts["tilecount"] - 1, ts))
    if prop(m, "mapCopyright") is None:
        R.add("warning", "MISSING_COPYRIGHT", "the map has no mapCopyright")
    # tiles
    collide_gids = set()
    for first, last, ts in ranges:
        for tile in ts.get("tiles", []):
            c = prop(tile, "collides")
            if c is not None and c.get("value") is True:
                collide_gids.add(first + tile["id"])
    solid = set()
    for path, lay in layers:
        if lay["type"] != "tilelayer" or lay.get("visible") is False:
            continue
        data = lay.get("data")
        if not isinstance(data, list):
            continue
        if lay.get("width") != W or lay.get("height") != H:
            R.add("error", "LAYER_SIZE_MISMATCH", f"layer is {lay.get('width')}x{lay.get('height')}, map is {W}x{H}", layer=path)
        for i, raw in enumerate(data):
            if not raw:
                continue
            gid = raw & FLIPS
            if not any(a <= gid <= b for a, b, _ in ranges):
                R.add("error", "INVALID_GID", f"tile id {gid} belongs to no tileset", layer=path, x=i % W, y=i // W)
            elif gid in collide_gids:
                solid.add((i % W, i // W))
    # text objects (room labels)
    for path, lay in layers:
        if lay["type"] != "objectgroup":
            continue
        for o in lay.get("objects", []):
            if "text" in o:
                size = o["text"].get("pixelsize", 16)
                lines = o["text"]["text"].count("\n") + 1
                if lines * size * 1.25 > o.get("height", 0) + 0.5 or len(max(o["text"]["text"].split("\n"), key=len)) * size * 0.6 > o.get("width", 0) + 1:
                    R.add("warning", "LABEL_TOO_LONG", "the text does not fit its box", objectName=o.get("name"))
    # script
    script = (prop(m, "script") or {}).get("value")
    if isinstance(script, str):
        if re.match(r"^https?://", script):
            R.add("warning", "SCRIPT_EXTERNAL", f"the map script is outside the build: {script}")
        elif not (dist / script.split("?")[0]).is_file():
            R.add("warning", "SCRIPT_NOT_FOUND", f"the map script {script} is not in the build")
    variables = {o["name"] for _, lay in layers if lay["type"] == "objectgroup" for o in lay.get("objects", [])
                 if (o.get("class") or o.get("type")) == "variable"}
    return m, solid, variables


def check_wam(dist, m, solid, report_data, R):
    p = dist / "office.wam"
    if not p.is_file():
        return {}
    wam = json.loads(p.read_text())
    Wpx, Hpx = m["width"] * 32, m["height"] * 32
    names = {}
    starts = []
    for a in wam.get("areas", []):
        name = a.get("name", "")
        if not (a.get("width", 0) > 0 and a.get("height", 0) > 0):
            R.add("error", "AREA_WITHOUT_SIZE", "WorkAdventure skips areas without size", objectName=name)
        if a["x"] < 0 or a["y"] < 0 or a["x"] + a["width"] > Wpx or a["y"] + a["height"] > Hpx:
            R.add("error", "OUT_OF_BOUNDS_AREA", "area extends past the map edge", objectName=name)
        if name:
            names[name] = names.get(name, 0) + 1
        for q in a.get("properties", []):
            t = q.get("type")
            if t == "start":
                starts.append(a)
            if t == "openWebsite":
                link = q.get("link", "")
                if not re.match(r"^https://", link):
                    R.add("error", "BAD_URL", f"openWebsite must be an https URL: {link[:80]}", objectName=name)
            if t == "playAudio":
                url = q.get("audioLink", "")
                if url and not re.match(r"^https://", url):
                    R.add("error", "BAD_URL", f"playAudio must be an https URL: {url[:80]}", objectName=name)
            if t == "listenerMegaphone":
                ids = {x["id"] for x in wam["areas"]}
                if q.get("speakerZoneName") not in ids:
                    R.add("error", "MEGAPHONE_SPEAKER_MISSING", "listenerMegaphone points to no speaker area id", objectName=name)
    anchors = set((report_data or {}).get("anchors", {}))
    for name, n in names.items():
        if n > 1:
            code = "ANCHOR_SHARED" if name in anchors else "DUPLICATE_AREA_NAME"
            level = "error" if name in anchors else "warning"
            R.add(level, code, f"{n} areas are named {name!r}; WorkAdventure uses the first one", objectName=name)
    # WorkAdventure 1.34.1 also spawns new visitors on a TMJ tile layer named 'start' (or with the bool property
    # 'startLayer' = true) that has at least one tile, on a random tile of it (docs tiled-editor/entry-exit.md;
    # .agents/skills/workadventure/references/map-building.md "Default start"). Measured in the local stack on
    # 2026-10-13: with no area in the WAM, the office's invisible 'start' layer put a new visitor on its tile, at the
    # entrance, not at the map centre. So such a layer is a default start too, and its tiles get the same blocked
    # check as a start area's cells.
    start_layers = [l for l in m.get("layers", []) if l.get("type") == "tilelayer" and l.get("data") and
                    (l.get("name") == "start" or any(q.get("name") == "startLayer" and q.get("value") is True
                                                     for q in l.get("properties", [])))]
    layer_cells = {l["name"]: [(i % m["width"], i // m["width"]) for i, v in enumerate(l["data"]) if v]
                   for l in start_layers}
    layer_cells = {name: cells for name, cells in layer_cells.items() if cells}
    if not any(q.get("isDefault") for a in starts for q in a["properties"] if q.get("type") == "start") \
            and not layer_cells:
        R.add("error", "MISSING_START", "no default start area and no start layer: people arrive at the map centre")
    for name, cells in layer_cells.items():
        if all(c in solid for c in cells):
            R.add("error", "START_TILE_BLOCKED", "every tile of this start layer is blocked", layer=name)
        elif any(c in solid for c in cells):
            R.add("warning", "START_TILE_BLOCKED", "part of this start layer is blocked", layer=name)
    for a in starts:
        x0, y0 = int(a["x"] // 32), int(a["y"] // 32)
        x1, y1 = int((a["x"] + a["width"] - 1) // 32), int((a["y"] + a["height"] - 1) // 32)
        cells = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
        if cells and all(c in solid for c in cells):
            R.add("error", "START_TILE_BLOCKED", "every cell of this start area is blocked", objectName=a["name"])
        elif any(c in solid for c in cells):
            R.add("warning", "START_TILE_BLOCKED", "part of this start area is blocked", objectName=a["name"])
    return wam


def bfs(starts, solid, W, H):
    dist = {s: 0 for s in starts if s not in solid}
    q = deque(dist)
    while q:
        x, y = q.popleft()
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= n[0] < W and 0 <= n[1] < H and n not in solid and n not in dist:
                dist[n] = dist[(x, y)] + 1
                q.append(n)
    return dist


def check_build(m, solid, rep, variables, R):
    """Checks that need the generator's report: walls, doors, seats, rooms, declared variables."""
    W, H = m["width"], m["height"]
    walls = {tuple(c) for c in rep.get("walls", [])}
    for c in sorted(walls):
        if c not in solid:
            R.add("error", "WALL_WITHOUT_COLLISION", "a wall cell has no collision: people walk through it", x=c[0], y=c[1])
        if not any((c[0] + dx, c[1] + dy) in walls for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            R.add("warning", "ISOLATED_WALL", "a wall cell with no wall next to it", x=c[0], y=c[1])
    arrival = [tuple(c) for c in rep.get("arrival", [])]
    reach = bfs(arrival, solid, W, H)
    for d in rep.get("doors", []):
        cells = [tuple(c) for c in d["cells"]]
        if any(c in solid for c in cells):
            R.add("error", "DOOR_BLOCKED", "something blocks the door opening", x=cells[0][0], y=cells[0][1])
        axis = d["axis"]
        fronts = [(x, y + s) for x, y in cells for s in (-1, 1)] if axis == "h" else [(x + s, y) for x, y in cells for s in (-1, 1)]
        if axis == "h":
            fronts = [(x, y + 3) for x, y in cells] + [(x, y - 1) for x, y in cells]    # past the 2 face rows below
        blocked_front = [f for f in fronts if f in solid and f not in walls]
        if blocked_front:
            R.add("warning", "DOOR_FRONT_BLOCKED", "furniture stands right in front of a door", x=blocked_front[0][0], y=blocked_front[0][1])
        if not any(c in reach for c in cells):
            R.add("error", "DOOR_UNREACHABLE", "no one can walk to this door from the arrival", x=cells[0][0], y=cells[0][1])
        ends = [cells[0], cells[-1]]
        for (x, y), (dx, dy) in zip(ends, ((-1, 0), (1, 0)) if axis == "h" else ((0, -1), (0, 1))):
            beyond = (x + dx, y + dy)
            corner = beyond in walls and ((beyond[0], beyond[1] + 1) in walls or (beyond[0], beyond[1] - 1) in walls
                                          if axis == "h" else (beyond[0] + 1, beyond[1]) in walls or (beyond[0] - 1, beyond[1]) in walls)
            if corner:
                R.add("warning", "DOOR_AT_CORNER", "the door touches a corner or a junction: keep a plain wall cell between", x=x, y=y)
    for s in rep.get("seats", []):
        cell = (s["x"], s["y"])
        if cell in solid:
            R.add("error", "SEAT_BLOCKED", "the seat cell is blocked, nobody can sit", objectName=s["id"], x=cell[0], y=cell[1])
        elif tuple(s["from"]) not in reach:
            R.add("error", "SEAT_UNREACHABLE", "the cell to walk in from is not reachable", objectName=s["id"], x=cell[0], y=cell[1])
    for room in rep.get("rooms", []):
        cells = [tuple(c) for c in room["cells"] if tuple(c) not in solid]
        lost = [c for c in cells if c not in reach]
        if lost:
            R.add("error", "ROOM_UNREACHABLE", f"{len(lost)} of {len(cells)} free cells of {room['key']} cannot be reached",
                  objectName=room["key"], x=lost[0][0], y=lost[0][1])
    for name in rep.get("variables_used", []):
        if name not in variables:
            R.add("error", "VARIABLE_NOT_DECLARED", f"the script writes {name!r} but the map does not declare it")
    for lab in rep.get("labels", []):
        cells = [(x, y) for x in range(lab["x0"], lab["x1"] + 1) for y in range(lab["y0"], lab["y1"] + 1)]
        if any(c in set(map(tuple, rep.get("furniture_cells", []))) for c in cells):
            R.add("warning", "LABEL_COVERED", "furniture stands in front of the room's name", objectName=lab["name"])


def validate(dist):
    dist = Path(dist)
    R = Report()
    m, solid, variables = check_map(dist, R)
    rep_path = dist / "build_report.json"
    rep = json.loads(rep_path.read_text()) if rep_path.is_file() else None
    check_wam(dist, m, solid, rep, R)
    if rep:
        check_build(m, solid, rep, variables, R)
    return R


def main(argv):
    dist = Path(argv[0]) if argv else Path(__file__).resolve().parent / "archive" / "dist" / "campus_mo"
    R = validate(dist)
    if "--json" in argv:
        print(json.dumps({"ok": not R.errors, "errors": R.errors, "warnings": R.warnings, "omitted": R.omitted},
                         ensure_ascii=False, indent=1))
    else:
        for level, items in (("ERROR", R.errors), ("warn ", R.warnings)):
            for it in items:
                where = " ".join(f"{k}={it[k]}" for k in ("layer", "objectName", "x", "y") if k in it)
                print(f"{level} {it['code']:24s} {it['message']}  {where}")
        counts = {}
        for it in R.errors + R.warnings:
            counts[it["code"]] = counts.get(it["code"], 0) + 1
        print(f"{dist.name}: {len(R.errors)} errors, {len(R.warnings)} warnings" + (f", {R.omitted} omitted" if R.omitted else "")
              + (f"  {counts}" if counts else ""))
    return 1 if R.errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
