"""Categories of the office objects in WorkAdventure's map editor (v1.34.1, "Adicionar objeto ao seu mapa").

The editor lists one category per tag, sorted alphabetically, and shows an object under every tag it has,
collection tags included: EntitiesCollectionsManager.ts appends them to each object. Objects that share a name and
a colour are one entry, so a second object with the same name, colour and direction cannot be picked
(EntityVariant.ts). Therefore each object carries exactly one tag, its category, and the collections carry none.
The lake categories share the "Lago: " prefix, which keeps them together in the alphabetical list. Search
matches the category and the name.

office(kind, tags) gives the category of a Modern Office object from its kind and catalogue tags (modern_office.py).
nature(catalog, entities) renames the lake pieces in Portuguese, one name per piece, and sets their category,
in the collection and in the placed copies (wa_build.py).
"""
from collections import Counter

# Modern Office: (kind, any of these catalogue tags) -> category; the first match wins.
OFFICE = (
    ('flat', {'café'}, 'Copa e café'),
    ('flat', {'reunião', 'mesa baixa'}, 'Mesas de reunião e de centro'),
    ('flat', set(), 'Mesas de trabalho'),
    ('floor', set(), 'Pisos e tapetes'),
    ('seat', set(), 'Cadeiras e sofás'),
    ('wall', set(), 'Na parede'),
    ('tall', {'divisória'}, 'Divisórias'),
    ('tall', {'som', 'púlpito'}, 'Palco e som'),             # auditorium.py (Codex), 2026-10-13
    ('tall', {'copa'}, 'Copa e café'),
    ('tall', {'armário', 'estante', 'arquivo'}, 'Armários e estantes'),
    ('tall', {'impressora', 'equipamento'}, 'Impressoras e equipamentos'),
    ('tall', {'planta'}, 'Plantas em vaso'),                  # floor plants (sources/modern-interiors), 2026-10-13
    ('item', {'café', 'copa'}, 'Copa e café'),
    ('item', {'microfone'}, 'Palco e som'),
    ('item', {'computador'}, 'Computadores e telas'),
    ('item', {'impressora'}, 'Impressoras e equipamentos'),
    ('item', {'planta'}, 'Plantas em vaso'),
    ('item', {'luminária'}, 'Luminárias e lareiras'),
    ('item', {'telefone', 'porta-retrato'}, 'Objetos de mesa'),
    ('item', {'papel', 'papelaria'}, 'Papéis e papelaria'),
    ('item', {'mochila', 'dinheiro'}, 'Mochilas e dinheiro'),
)

# Lake pieces: layers.json kind -> (category, name). Pieces of one kind are numbered.
NATURE = {
    'boulder': ('Lago: pedras da margem', 'Pedra grande'),
    'stone': ('Lago: pedras da margem', 'Pedra'),
    'submerged stone': ('Lago: pedras na água', 'Pedra na água'),
    'victoria pad': ('Lago: vitórias-régias', 'Folha de vitória-régia'),
    'victoria flower': ('Lago: vitórias-régias', 'Flor de vitória-régia'),
    'fern 02': ('Lago: plantas da margem', 'Samambaia'),
    'clump': ('Lago: plantas da margem', 'Touceira'),
    'grass medium 01': ('Lago: plantas da margem', 'Capim'),
    'flower gazania': ('Lago: flores', 'Gazânia'),
    'flower heliophila': ('Lago: flores', 'Heliófila'),
    'periwinkle plant': ('Lago: flores', 'Vinca'),
}


def office(kind, tags):
    """Category of one Modern Office object."""
    for rule_kind, any_of, category in OFFICE:
        if kind == rule_kind and (not any_of or any_of & set(tags)):
            return category
    raise KeyError(f'no category for a {kind} object tagged {tags}')


def nature(catalog, entities):
    """Portuguese name and category for each lake piece of the collection and of its placed copies.

    The collection must still name each piece by its kind (wa_build.py); entities are the WAM records.
    """
    pieces = catalog['collection']
    total = Counter(piece['name'] for piece in pieces)
    seen, names = Counter(), {}
    for piece in pieces:
        kind = piece['name']
        category, name = NATURE[kind]
        seen[kind] += 1
        names[piece['id']] = f'{name} {seen[kind]}' if total[kind] > 1 else name
        piece.update(name=names[piece['id']], tags=[category])
    catalog['tags'] = []
    for entity in entities.values():
        if entity['prefabRef']['id'] in names:
            entity['name'] = names[entity['prefabRef']['id']]
