# Folhas de sprites trazidas pelo dono (18/10/2026)

O dono pediu "copia pra cá" mandando prints destas sete folhas. Os originais estavam nos repositórios de referência
(`_refs/`, só leitura); estas são cópias byte a byte, para a produção usar. `hq-office/sheets.py` recorta e mede as
peças, e o build as põe no editor em quatro coleções; o uso no mapa e a luz estão em `hq-office/README.md`, seção
"Folhas trazidas pelo dono".

| Arquivo | Origem | Tamanho | SHA-256 | Serve para |
|---|---|---|---|---|
| `lpc-terrains.png` | `_refs/nature-office/src/assets/LPC-terrains.png` | 1088×1088 | `73af00cf085e` | terrenos RPG: terra, lava, buracos, grama, água, neve, areia, escadas, pontes e decks |
| `lpc-objects-plants-fish.png` | `_refs/nature-office/src/assets/LPC-objects-plants-fish.png` | 1088×1088 | `df505f193a14` | natureza e feira: árvores das estações, cerejeiras, frutas, hortas, cercas, lenha, sacas, barraca, barcos, peixes |
| `lpc-interior.png` | `_refs/nature-office/src/assets/LPC-Interior.png` | 1088×1088 | `4af1e58ceead` | interior clássico: camas, estantes, lareira, piano, cozinha antiga, cortinas, tapetes, escadarias |
| `bookshelves.png` | `_refs/wa-village/tilesets/bookshelves.png` | 1348×1030 | `416c161c76fc` | estantes com livros e plantas em cima, e fileiras de livros soltas |
| `indoor-plants.png` | `_refs/presets-maps/tilesets/indoor-plants-1.png` | 1216×1346 | `626aef288166` | plantas em vaso: árvores de interior, suculentas, floreiras, cactos |
| `pattern-light.png` | `_refs/wa-village/tilesets/pattern_light.png` | 1024×1024 | `833f89420f56` | luz: faixas diagonais brancas com no máximo 18% de opacidade, para uma camada por cima do mapa (sol entrando pelas janelas) |
| `modern-office-32.png` | `_refs/the-office-map/tilesets/Modern office/Modern_Office_32x32_Revamp_v0.png` | 512×1696 | `32e451214b56` | escritório moderno 32 px: mesas, divisórias, cadeiras, sofás, impressoras, monitores, quadros, máquinas de lanche, malas |

**Licença:** o dono confirmou em 18/10/2026 que as licenças estão abertas no GitHub do WorkAdventure.

**O que o repositório registra (verificado em 18/10/2026):**
- Os quatro repositórios de origem trazem em `LICENSE.assets` só o texto genérico da "WorkAdventure specific resources
  license": uso e modificação apenas em mapas de WorkAdventure, SaaS ou self-hosted. As cópias estão em `licenses/`.
- Nenhum mapa de origem registra autor ou licença específica dessas folhas na propriedade `tilesetCopyright`.
  `modern-office-32.png` e `pattern-light.png` nem são usadas por mapa nas origens.
- O uso na sala local segue a decisão do dono no `AGENTS.md`. Antes de publicar, autoria e licença de cada folha
  precisam ser confirmadas e registradas.

**Estilo:**
- `modern-office-32.png` é pixel art de 32 px como o catálogo da sede, e o escritório principal já usa peças dele.
- `bookshelves.png` e `indoor-plants.png` são desenho com contorno grosso, outro traço.
- As três LPC são RPG de fantasia.

Misturar traços pede a mesma checagem de traço e tamanho óptico de `flora_optics.py`.
