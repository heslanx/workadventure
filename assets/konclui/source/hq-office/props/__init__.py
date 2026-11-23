"""The registry of volume pieces. Piece lanes add a module to this package and never edit this file.

A module is a piece module when it exposes RECIPE: a tools/volume.py Recipe, a zero-argument callable returning one, or a
list or tuple of those (colour variants of one drawing). Modules whose name starts with an underscore are skipped.

    names()    sorted recipe names
    get(name)  the Recipe (KeyError for an unknown name)
    all()      {name: Recipe}
    errors()   {module: message} for modules that failed to import or exposed a bad or duplicate RECIPE; they are never
               silently dropped from view, tools/bake.py --list and the baker's "no piece named" message print them
    refresh()  forget the cache and scan again (names(), get() and all() scan on first use)

Discovery walks this package's __path__, so a directory appended to props.__path__ (a test fixture) is scanned too.
"""
import importlib
import pkgutil
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

_cache = None


def _recipes_of(obj):
    items = obj if isinstance(obj, (list, tuple)) else [obj]
    out = []
    for item in items:
        recipe = item() if callable(item) and not hasattr(item, 'solids') else item
        if not (hasattr(recipe, 'solids') and hasattr(recipe, 'footprint') and hasattr(recipe, 'name')):
            raise TypeError(f'RECIPE must be a volume.Recipe, a callable returning one, or a list of those, got {type(recipe).__name__}')
        out.append(recipe)
    return out


def _scan():
    found, errors = {}, {}
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda i: i.name):
        if info.name.startswith('_'):
            continue
        full = f'{__name__}.{info.name}'
        sys.modules.pop(full, None)          # a rescan sees an edited module
        try:
            mod = importlib.import_module(full)
        except Exception as exc:             # a broken piece must not hide the others
            errors[info.name] = f'{type(exc).__name__}: {exc}'
            continue
        if not hasattr(mod, 'RECIPE'):
            continue
        try:
            recipes = _recipes_of(mod.RECIPE)
        except Exception as exc:
            errors[info.name] = f'{type(exc).__name__}: {exc}'
            continue
        for recipe in recipes:
            if recipe.name in found:
                errors[info.name] = f'duplicate recipe name {recipe.name!r} (already defined by another module)'
            else:
                found[recipe.name] = recipe
    return found, errors


def refresh():
    global _cache
    _cache = None


def _load():
    global _cache
    if _cache is None:
        _cache = _scan()
    return _cache


def names():
    return sorted(_load()[0])


def get(name):
    try:
        return _load()[0][name]
    except KeyError:
        raise KeyError(f'no piece named {name!r}; known: {names()}') from None


def all():  # noqa: A001 (the registry's public name)
    return dict(_load()[0])


def errors():
    return dict(_load()[1])
