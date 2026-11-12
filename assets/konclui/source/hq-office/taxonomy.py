"""The HQ office's object list in WorkAdventure's map editor, as taxonomy.json (the contract) defines it.

How the editor (v1.34) lists objects, read from its code (office/entity_categories.py has the references): one entry
per collection and name; inside an entry, one variant per colour and direction (a second object with the same
collection, name, colour and direction cannot be picked); one category per tag, the collection's tags included,
categories sorted as JavaScript sorts them. So every piece here carries exactly one tag, its category, and the
collections carry none.

  category(source, key) -> category id        tag(source, key) -> its name, the piece's only tag
  suffix('recolour' | 'supported')            what a derived piece adds to its base's name
  renamed(source, name)                       the name the editor shows
  keep(source, items, name, ident)            items minus the left-out duplicates (never one the owner placed)
  colours(images, default)                    one swatch per colour variant of a type, never two alike
  entries(collections)                        the editor's model of a set of collections (for checks and reports)

  python3 hq-office/taxonomy.py [DIST]        the object list of a build (default hq-office/dist)
  python3 hq-office/taxonomy.py --memory      the object list the next build would write, without building

The sources and their keys are described in taxonomy.json; test_taxonomy.py checks the contract and the providers
(catalogue.py, sheets.py, build.py's "Koncluí" pieces) against it.
"""
import json
import sys
from collections import Counter, defaultdict
from fnmatch import fnmatchcase
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / 'taxonomy.json'
SCHEMA = HERE / 'taxonomy.schema.json'
EDITS = HERE / 'editor-edits.json'


@lru_cache(maxsize=None)
def contract():
    return json.loads(CONTRACT.read_text())


@lru_cache(maxsize=None)
def names():
    """{category id: name}, in the editor's order."""
    return {c['id']: c['name'] for c in contract()['categories']}


def rules(source, key):
    """The rules of `source` that decide `key`: for 'path' sources the longest one that is the key or a '/'-bounded
    prefix of it (one or none); for 'glob' sources every pattern that matches (exactly one is valid)."""
    spec = contract()['sources'][source]
    if spec['match'] == 'glob':
        return [r for r in spec['rules'] if fnmatchcase(key, r)]
    hits = [r for r in spec['rules'] if key == r or key.startswith(r + '/')]
    return sorted(hits, key=len)[-1:]


def category(source, key):
    found = rules(source, key)
    if not found:
        raise KeyError(f'taxonomy.json: no category for {source} piece {key!r}; add a rule under sources.{source}.rules')
    if len(found) > 1:
        raise ValueError(f'taxonomy.json: {source} piece {key!r} matches {found}; a piece has exactly one category')
    return contract()['sources'][source]['rules'][found[0]]


def tag(source, key):
    return names()[category(source, key)]


def suffix(kind):
    return contract()['derived'][kind]['suffix']


def renamed(source, name):
    return contract()['renamed'].get(source, {}).get(name, name)


@lru_cache(maxsize=None)
def left_out(source):
    """{name: the name of its identical twin, which stays} for `source`."""
    return {d['name']: d['same_as'] for d in contract()['left_out'] if d['source'] == source}


def placed_by_owner():
    """(collection, prefab id) of every object the owner created in the editor (editor-edits.json "_added")."""
    added = json.loads(EDITS.read_text()).get('_added', {}) if EDITS.exists() else {}
    return {(e['prefabRef']['collectionName'], e['prefabRef']['id']) for e in added.values() if 'prefabRef' in e}


def keep(source, items, name, ident):
    """`items` without the left-out duplicates of `source`. name(item) is the source's name, ident(item) its
    (collection, prefab id); a name keeps all its pieces when the owner placed any of them in the editor."""
    out = left_out(source)
    if not out:
        return list(items)
    items = list(items)
    owner = placed_by_owner()
    held = {name(i) for i in items if name(i) in out and ident(i) in owner}
    return [i for i in items if name(i) not in out or name(i) in held]


def colours(images, default):
    """{variant key: CSS colour} for the colour variants of one type: `default` for a single variant, else each
    variant's mean opaque colour, nudged until no two are alike (the editor merges variants of the same colour)."""
    import numpy as np
    if len(images) == 1:
        return {k: default for k in images}
    out, used = {}, set()
    for k in sorted(images):
        a = np.asarray(images[k].convert('RGBA'))
        r, g, b = (int(v) for v in a[..., :3][a[..., 3] > 0].mean(axis=0))
        code = '#%02x%02x%02x' % (r, g, b)
        while code in used:
            b = (b + 1) % 256
            code = '#%02x%02x%02x' % (r, g, b)
        used.add(code)
        out[k] = code
    return out


# ------------------------------------------------------------------------------------------------ the editor's model

def editor_order(categories):
    """Category tags in the editor's order: Object.entries({tag: [entries]}).sort() compares each pair as the string
    'tag,[object Object],...'."""
    return sorted(categories, key=lambda t: (t + ',[object Object]' * len(categories[t])).encode('utf-16-be'))


def entries(collections):
    """The editor's view of {collection name: (collection tags, [prefab dicts])}: dict(entries={(collection, name):
    tags of its first prefab plus the collection's}, categories={tag: [(collection, name)]} in the editor's order,
    lost=[(collection, name, colour, direction, count)] variants that cannot be picked, mixed=[(collection, name)]
    whose prefabs disagree on their tags)."""
    found, slots, tags_seen = {}, Counter(), defaultdict(set)
    for coll, (coll_tags, prefabs) in collections.items():
        for p in prefabs:
            key = (coll, p['name'])
            found.setdefault(key, [*p.get('tags', []), *coll_tags])
            slots[(key, p.get('color'), p.get('direction'))] += 1
            tags_seen[key].add(tuple(p.get('tags', [])))
    cats = defaultdict(list)
    for key, tags in found.items():
        for t in tags:
            cats[t].append(key)
    return dict(entries=found, categories={t: cats[t] for t in editor_order(cats)},
                lost=[(*k, c, d, n) for (k, c, d), n in slots.items() if n > 1],
                mixed=sorted(k for k, v in tags_seen.items() if len(v) > 1))


def report(collections, placed):
    """Inventory lines for {collection: (tags, [prefab])} and placed [(collection, prefab id)]."""
    model = entries(collections)
    by_coll = Counter(c for c, _ in model['entries'])
    prefabs = sum(len(p) for _, p in collections.values())
    clash = sum(n - 1 for keys in model['categories'].values() for n in Counter(n for _, n in keys).values() if n > 1)
    lines = [f'collections {len(collections)}, prefabs {prefabs}, editor entries {len(model["entries"])}, '
             f'categories {len(model["categories"])}, variants nobody can pick {sum(n - 1 for *_, n in model["lost"])}, '
             f'entries sharing a name inside a category {clash}, placed objects {len(placed)} '
             f'({len(set(placed))} distinct pieces)']
    lines += [f'  collection {c}: {n} entries, {len(collections[c][1])} prefabs' for c, n in by_coll.items()]
    known = set(names().values())
    lines += [f'  {"" if t in known else "NOT IN taxonomy.json: "}{t}: {len(k)}' for t, k in model['categories'].items()]
    return lines


def from_dist(dist):
    dist = Path(dist)
    wam = json.loads((dist / 'office.wam').read_text())
    collections = {}
    for ref in wam['entityCollections']:
        doc = json.loads((dist / ref['url']).read_text())
        collections[doc['collectionName']] = (doc.get('tags', []), doc['collection'])
    placed = [(e['prefabRef']['collectionName'], e['prefabRef']['id']) for e in wam['entities'].values()]
    return collections, placed


def from_memory():
    """What the next build would write, from build.py's own tables (no file is written)."""
    sys.path.insert(0, str(HERE))
    import build as B                                    # first: catalogue.py imports a module named build too
    placed = B.place_pieces()
    tables = {B.CAT.COLLECTION: B.MOB, B.KCOLL: B.KONCLUI, **B.SHEET_COLLECTIONS}
    collections = {c: ([], [p for p, _, _ in t.values()]) for c, t in tables.items()}
    refs = [(d['collection'], d['id']) for d, _, _ in placed.values()]
    refs += [(e['prefabRef']['collectionName'], e['prefabRef']['id']) for e in B.EDITOR_ADDED.values()]
    return collections, refs


if __name__ == '__main__':
    args = sys.argv[1:]
    data = from_memory() if args[:1] == ['--memory'] else from_dist(args[0] if args else HERE / 'dist')
    print('\n'.join(report(*data)))
    unknown = [t for t in entries(data[0])['categories'] if t not in set(names().values())]
    sys.exit(1 if unknown else 0)
