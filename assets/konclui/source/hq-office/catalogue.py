"""The furniture catalogue of the HQ office, under this office's own names.

The pictures, geometry, seats and Portuguese names come from the catalogue importer shared with the main office
(office/, read-only here: renaming or changing it would break the main office's build). This module is the only
place that touches it; everything else in this folder sees:
  collection  "Mobília"
  ids         "mob-<variant uuid>", "mob-door-...", "mob-floor-...", "mob-wall-..."
  categories  one tag per piece, its category in taxonomy.json ("Cadeiras e bancos", "Mesas", ...), from the
              source's category, family and type (key())
  names       without any source suffix, as taxonomy.json renames them; the exact duplicates it lists are left out
The licence of the imported art is recorded with the shared sources (NOTICE.md next to the catalogue).
"""
import json
import shutil
import sys
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / 'office'))
import gather as _source  # noqa: E402  (the shared importer of the main office)
import taxonomy as TAX  # noqa: E402

COLLECTION = 'Mobília'
SEAT_LIFT = _source.SEAT_LIFT
SOURCE_PREFIX = _source.COLLECTION.lower() + '-'
_SUFFIX = ' (' + _source.COLLECTION + ')'

catalog = _source.catalog
image = _source.image
trim = _source.trim
furniture_piece = _source.furniture_piece
seat_cell = _source.seat_cell


def own_id(source_id):
    """'<source>-<uuid>' -> 'mob-<uuid>'."""
    return 'mob-' + source_id[len(SOURCE_PREFIX):] if source_id.startswith(SOURCE_PREFIX) else source_id


def variant_id(record):
    return 'mob-' + record['id']


@lru_cache(maxsize=None)
def _records():
    return {variant_id(f): f for f in catalog()['furniture']}


def key(pid):
    """The taxonomy key of a piece ('mob-...'): '<category>/<family>/<type>' in the source catalogue, or 'doors',
    'floors', 'walls'."""
    for kind in ('door', 'floor', 'wall'):
        if pid.startswith(f'mob-{kind}-'):
            return kind + 's'
    f = _records()[pid]
    return f"{f['category']}/{f['family']}/{f['type']}"


def _rename(prefab):
    pid = own_id(prefab['id'])
    folder = prefab['imagePath'].split('/')[1]
    return dict(prefab, id=pid, name=TAX.renamed('mobilia', prefab['name'].replace(_SUFFIX, '')),
                tags=[TAX.tag('mobilia', key(pid))], imagePath=f'sprites/{folder}/{pid}.png')


@lru_cache(maxsize=None)
def pieces():
    """[(prefab, image, seat or None)] of the whole catalogue, with this office's names and categories; objects that
    carry the source's own brand (its logo sign) and the exact duplicates taxonomy.json lists are left out."""
    brand = _source.COLLECTION.lower()
    source = [(p, img, seat) for p, img, seat in _source.pieces()[0] if brand not in p['name'].replace(_SUFFIX, '').lower()]
    kept = TAX.keep('mobilia', source, lambda item: item[0]['name'].replace(_SUFFIX, ''),
                    lambda item: (COLLECTION, own_id(item[0]['id'])))
    return [(_rename(p), img, seat) for p, img, seat in kept]


def build(dist, transform=lambda prefab: prefab, picture=lambda prefab, img: img):
    """Write <dist>/entities/mobilia/ (pictures and collection.json); return its path relative to dist."""
    out = Path(dist) / 'entities/mobilia'
    if out.exists():
        shutil.rmtree(out)
    prefabs = []
    for prefab, img, _ in pieces():
        img = picture(prefab, img)
        prefab = transform(prefab)
        path = out / prefab['imagePath']
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        prefabs.append(prefab)
    doc = dict(collectionName=COLLECTION, tags=[], version='1.0', collection=prefabs)
    (out / 'collection.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    return 'entities/mobilia/collection.json'
