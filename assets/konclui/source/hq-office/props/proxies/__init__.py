"""The registry of PROXY recipes: volumes that overlay a hand-drawn sprite (tools/proxy.py). Not the volume-piece registry
(hq-office/props/__init__.py): these never replace a picture, they supply the height and normal images of one.

A module here is a proxy module when it exposes PROXIES: a tools/proxy.py ProxyRecipe, a zero-argument callable returning
one, or a list or tuple of those. Modules whose name starts with an underscore are skipped. This package exposes no RECIPE,
so the piece registry one level up passes over it.

    names()    sorted proxy recipe names
    get(name)  the ProxyRecipe (KeyError for an unknown name)
    all()      {name: ProxyRecipe}
    by_key(key)  the proxy recipe declared for a placed sprite key, or None
    errors()   {module: message} for modules that failed to import or exposed a bad or duplicate recipe
    refresh()  forget the cache and scan again
"""
import importlib
import pkgutil
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[3] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

_cache = None


def _recipes_of(obj):
    items = obj if isinstance(obj, (list, tuple)) else [obj]
    out = []
    for item in items:
        proxy = item() if callable(item) and not hasattr(item, 'recipe') else item
        if not (hasattr(proxy, 'recipe') and hasattr(proxy, 'origin') and hasattr(proxy, 'name')):
            raise TypeError(f'PROXIES must hold tools/proxy.py ProxyRecipe values, got {type(proxy).__name__}')
        out.append(proxy)
    return out


def _scan():
    found, errors = {}, {}
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda i: i.name):
        if info.name.startswith('_'):
            continue
        full = f'{__name__}.{info.name}'
        sys.modules.pop(full, None)
        try:
            mod = importlib.import_module(full)
        except Exception as exc:
            errors[info.name] = f'{type(exc).__name__}: {exc}'
            continue
        if not hasattr(mod, 'PROXIES'):
            continue
        try:
            proxies = _recipes_of(mod.PROXIES)
        except Exception as exc:
            errors[info.name] = f'{type(exc).__name__}: {exc}'
            continue
        for proxy in proxies:
            if proxy.name in found:
                errors[info.name] = f'duplicate proxy name {proxy.name!r}'
            else:
                found[proxy.name] = proxy
    return found, errors


def _load():
    global _cache
    if _cache is None:
        _cache = _scan()
    return _cache


def refresh():
    global _cache
    _cache = None
    return _load()


def names():
    return sorted(_load()[0])


def get(name):
    found = _load()[0]
    if name not in found:
        raise KeyError(f'no proxy recipe named {name!r}; known: {sorted(found)}')
    return found[name]


def all():
    return dict(_load()[0])


def by_key(key):
    for proxy in _load()[0].values():
        if key in proxy.keys:
            return proxy
    return None


def errors():
    return dict(_load()[1])
