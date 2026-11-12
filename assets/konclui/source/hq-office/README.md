# Escritório Sede: o programa do escritório principal com o design system da Koncluí

Segundo escritório da Koncluí, numa sala separada. Desde 21/10/2026 ele está no ar em
`https://work.konclui.com/~/escritorio-sede-hud/office.wam` (diretório novo; a entrada do site
segue no campus). Desde 21/10/2026 a produção roda o mesmo gateway (`local-wa/README.md`, "O mesmo gateway em
produção"), então paredes finas, pose sentada, shaders e a interface nova também estão no ar. Conferido em 22/10/2026:
a página carrega `fx.mjs`, e o `GameManager` traz o `x-konclui-scene-fx`. Upload: `python3 hq-office/upload_sede.py`.

- **Sala de trabalho:** `http://localhost:8090/~/konclui-office/office.wam`, com a interface no estilo do escritório
  de referência. Todo build novo é carregado aqui. Até 21/10/2026 ela se chamava `escritorio-sede-hud`; essa sala local
  segue como cópia da mesma versão, e a sala de produção mantém esse nome.
- **Versão anterior, congelada:** `http://localhost:8090/~/escritorio-sede/office.wam`, o build de 18/10/2026 21:03 com a
  interface por momento. Não recebe mais cargas; o histórico está em "Versões".

| Data | Pedido do dono | Resultado |
|---|---|---|
| 17/10/2026 | Montar outro escritório com o catálogo de móveis importado, com o programa do escritório atual | v1 |
| 18/10/2026 | Itens no lugar, piscina nativa com carpas novas, paredes finas, sentar automático, cores do DS, vidros, peças próprias, recepção, contraste de luxo | Feito |
| 18/10/2026 | Plantas de chão sem colisão; margem do lago no estilo do lago de carpas do catálogo; canal de largura única e ponte no meio do trecho | Feito |
| 18/10/2026 | Tirar a marca do catálogo de todos os nomes; identidade de cada mesa; mais vida no escritório inteiro; pose sentada | Feito; pose sentada com o patch do gateway local |
| 18/10/2026 | No sofá virado para cima o avatar "sentou no chão em frente ao sofá" | Feito: cabeça e ombros acima do encosto |
| 18/10/2026 | "Não está sentando aqui": almofada lateral do sofá e cadeira de reunião movida no editor | Feito: uma vaga por almofada; sentar pelo corpo e por cadeira movida |
| 18/10/2026 | "Esse é o assento do sofá": a faixa capitonê, não acima dela | Feito: o avatar senta sobre o assento, atrás do encosto |
| 18/10/2026 | "Parece amputada sentada": mais no meio, com as perninhas (sofá de frente, poltrona de lado) | Refeito na linha seguinte |
| 18/10/2026 | "Sentar mais pra cima", "calcule o meio do assento", cadeira de escritório "péssima em todas posições", "copiar do gather como ele faz pra sentar" | Feito: como na origem, peça atrás, camada da frente por cima e quadril no meio do assento de cada peça |
| 18/10/2026 | "Não era só reestruturar a ordem das coisas? Pra não cortar assim"; cadeira da recepção movida no editor e avatar sentado 14 px acima | Refeito na linha seguinte; quem está sentado acompanha a cadeira movida |
| 18/10/2026 | "Eu duvido que o Gather comete esse erro... Não tem como simplesmente copiar?" (cadeira de mesa vista de costas, com print do original) | Feito: a regra de sentar da própria origem, lida no cliente e no servidor dela |
| 18/10/2026 | "Esse vidro é transparente ou um espelho? ... por trás é a grama de fora" (fachada norte das estações) | Feito: o piso sob o vidro da fachada norte é o gramado |
| 18/10/2026 | Melhores práticas de otimização do Phaser, perfil e ciclo de otimização com medição | Feito: ver "Desempenho" |
| 18/10/2026 | Interface: a opção 11 de [dez caminhos](../design/ux/2026-10-18-hud-10/index.html#op-11) (interface por momento com o mapa de pessoas), o mapa escondido até alguém clicar | Feito no WA local (seção Interface) |
| 18/10/2026 | "Melhore a textura da grama fora do escritório": boas práticas de grama em pixel art, leve, bonita, com animações leves; avaliar os pacotes Mana Seed baixados | Feito em `escritorio-sede-hud` (seção Gramado) |
| 18/10/2026 | "Copia pra cá" (sete folhas de sprites) e "implemente eles pra gente"; licenças abertas no GitHub do WorkAdventure | Feito em `escritorio-sede-hud` (seção Folhas trazidas pelo dono) |
| 18/10/2026 | "O Gather usa espaços mais populados de forma que faça sentido": outros modelos de cadeira, poltrona e estante, a Eames da Boardroom nas reuniões e no auditório, o lounge da referência ("isso aqui mesmo é lindo") | Primeira rodada feita em `escritorio-sede-hud` (seção Vida pelas referências do Gather) |
| 18/10/2026 | "Cadê os quadros da marca? Da Koru? Da área / ICP?"; cenas do ICP geradas com IA, qualquer pose da Koru, maiores onde couber | Feito em `escritorio-sede-hud` (seção Quadros da marca) |
| 18/10/2026 | "Desperte o artista que tem em você e melhore a textura das coisas", com cinco referências (lago esmeralda, lago de vitórias-régias, folhas de grama, musgo e flores); "primeiro a piscina e o canal" | Piscina e canal refeitos em `escritorio-sede-hud` (seção Piscina) |
| 18/10/2026 | "Vão colocar algum móvel por baixo?" (impressora no chão); nas cabines, "um espaço na frente, e na de baixo ficou atrás"; "essas plantinhas sem vaso estão esquisitas... por cima da borda" | Feito em `escritorio-sede-hud`: impressora sobre o aparador (depois o dono trocou aparadores e impressoras por estantes no editor), cabines de dois tiles com a mesa na parede do fundo, plantas do lago na borda, e as 12 cadeiras das cabines sentando |
| 19/10/2026 | "Me ajude a consolidar o nosso trabalho... Organizar as versões anteriores, otimizações, a versão de trabalho atual"; a área Recepção, deslocada no editor, "pode voltar" | Feito: `escritorio-sede-hud` vira a sala de trabalho, `escritorio-sede` fica congelada, salas antigas arquivadas (seção Versões); Recepção de volta ao plano |
| 20/10/2026 | "Vamos olhar o ambiente e todas as oportunidades de shaders", depois "vamos implementar todos pra gente" | Feito em `escritorio-sede-hud` (seção Shaders) |
| 20/10/2026 | "Pode ter em configurações a opção de adicionar ou remover recursos pra deixar mais leve / mais completo" | Feito: nível Leve, Equilibrado ou Completo e uma chave por efeito em Configurações › Desempenho (seção Shaders) |
| 20/10/2026 | "Parece que só os vidros de cima ficaram transparentes... ainda tem vários que não estão" (fachada sul) | Feito: o piso sob o vidro da fachada sul também é o gramado |
| 20/10/2026 | "Vale ter shader de reflexo nesse vidro?" (vidro das salas de equipe, visto do corredor) | Feito: reflexo de quem passa na frente (seção Shaders) e, por baixo do vidro, o piso da sala em vez do corredor |
| 20/10/2026 | "O reflexo do vidro tá errado... tem que ficar de frente... É sempre invertido", "tá ficando cortado dos lados", "pode ter reflexo do que mais tiver perto e fizer sentido"; "no 4 a parede tá terminando errado... pelo menos juntar assim (ver todas assim)" | Feito na sala de teste `escritorio-sede-koru`: o espelho (seção Shaders) e as paredes finas descendo até a moldura da face em todas as junções por cima (`build.py`, `draw_walls`) |
| 20/10/2026 | "Como podemos melhorar essa Koru aqui?"; depois "falta um pouco mais de textura e profundidade aqui na koru" (com os traços desenhados) | Feito na sala de teste `escritorio-sede-koru` (seção Piscina, fonte e carpas) |
| 20/10/2026 | "Categorizar / organizar todas as opções de móveis e decoração, itens, etc... E mapear todas oportunidades de shaders (ex fumacinha no café)" | Categorias feitas no código, build e carga pendentes (seção Categorias do editor); planos dos efeitos em `plans/decor/` |
| 20/10/2026 | "Os sons de ambiente de repente aparecem com volume total... Ir do volume 0 até o volume 100 do efeito, pra ir ouvindo baixinho e quanto mais perto chegar, mais alto" | Feito e verificado na sala `escritorio-sede-sino` (seção Som ambiente e sino da venda); carregado na sala de trabalho em 21/10/2026 |
| 20/10/2026 | "Em configuração a gente pode modular até que volume queremos os sons de efeitos, do ambiente, das vozes das outras pessoas" | Contrato de volume feito e obedecido (`theme/README.md`, Som pela distância); o diálogo de Configurações é da interface |
| 20/10/2026 | "Esquecemos de colocar o sino das vendas aqui no ambiente... As notificações de toast e tudo mais" | Feito e verificado em `escritorio-sede-sino`: sino na recepção, cartão como aviso do HUD, fila protegida; venda real depende do serviço `bell` (Limites) |
| 20/10/2026 | O lounge e a sala de jogos do café estão "muito triste", dream-loop "pra deixar incrível"; depois, "ter todos terminais lá pros usuários conseguirem interagir" com os jogos | Feito e verificado na sala `escritorio-sede-jogos` (seção Lounge e sala de jogos do café); carregado na sala de trabalho em 21/10/2026 |
| 21/10/2026 | "Aqui o pet está atrás na prática. E no espelho aparece na frente"; "se ele está de costas pro espelho, deveria aparecer as costas dele lá"; "sempre coloque um agente do Gemini pra capturar erros de continuidade de todas as coisas" | Feito na sala de teste `escritorio-sede-koru`: o espelho desenha tudo pela distância ao vidro e o pet de costas reflete as costas (seção Espelho no vidro); a revisão de continuidade pelo Gemini virou regra (`continuity_review.py`, `AGENTS.md`) |
| 19/10/2026 | "Rajadas juntas e espaçadas" para a brisa (meta de redesenho parado); a cadeira da recepção "devolver à posição anterior" | Feito no build: tufos sincronizados num ciclo de 14 s; cadeira de volta ao plano (fora do balcão). Carga na sala oficial pendente: a VM do Colima foi apagada fora da sessão |

![Prévia](renders/preview.png)

## O que tem nesta pasta

| Caminho | O que é |
|---|---|
| `editor-edits.json` | Posições que o dono definiu no editor, aplicadas por cima do plano em todo build |
| `plan.py` | Planta em dados: paredes (com material), portas, salas, cabines, piscina, zonas de piso, cada peça, objetos de cada mesa e decoração |
| `build.py` | Gera o mapa a partir do plano (pisos e piscina animados, paredes e vidros, `thin-walls`, portas, objetos, áreas, `seats.json`, `interactions.json`, `social.json`, prévia) e roda `map/validate_map.py` |
| `catalogue.py` | Único ponto que lê o catálogo de móveis importado (compartilhado com o escritório principal, só leitura). Expõe a coleção "Mobília", com IDs `mob-…` e a categoria de `taxonomy.json` em cada peça, e deixa de fora objetos com a marca da origem e as gêmeas |
| `taxonomy.json`, `taxonomy.schema.json` | O contrato da lista de objetos do editor: as 21 categorias, a regra que leva cada peça de cada origem a uma só categoria, os sufixos das peças derivadas, os nomes trocados e as gêmeas deixadas de fora (seção Categorias do editor) |
| `taxonomy.py`, `test_taxonomy.py` | Leitura do contrato pelos módulos que montam as coleções, relatório da lista do editor (`python3 hq-office/taxonomy.py [--memory]`) e o teste do contrato, sem build |
| `GLOSSARY.md` | Os termos das peças e do editor (peça, coleção, entrada, variante de cor, categoria, peça da marca, peça apoiada…) |
| `palette.py` | Cores do design system e recoloração de pisos, paredes e tecido dos móveis (`ds-petrol`, `ds-ink`, `ds-mint`, `ds-turquoise`) |
| `glass.py` | Vidros sem caixilho na geometria das paredes, montantes e portas de correr animadas |
| `lawn.py` | Gramado em resolução nativa: textura do piso, camada `decor` de tufos (com brisa), trevos, flores e pedrinhas, grama sobre a borda do caminho e o montinho de grama ao pé das árvores do catálogo nas cores do gramado |
| `flora.py` | Plantas e pedras em pixel art desenhadas por código (pedra com capa de musgo, samambaia, touceira de folhas, grama com ranúnculos ou trevo, juncos e taboas, vitória-régia, ninfeia), usadas na margem da piscina, num sistema óptico só (traço, tamanho, âncora) |
| `frames.py` | Quadros da marca, da Koru e do ICP: conversão das imagens geradas para pixel art no tamanho nativo, moldura única da série e um tipo por quadro na coleção "Koncluí" |
| `sheets.py` | Peças das folhas trazidas pelo dono (`sources/sheets/`): o Modern Office recortado pelo escritório principal, e o recorte automático e a curadoria das outras folhas |
| `flora_optics.py` | Mede traço, tamanho óptico e âncora de cada sprite de `flora.py` e reprova o que fugir das regras; o build roda |
| `fx.py` | Dados dos shaders (`dist/fx/`): água parada e profundidade, máscaras do vidro e do mapa, slide da TV, luzes por sprite (seção Shaders) |
| `pool.py` | Piscina em resolução nativa: água, margem de pedras e musgo, canal, ponte, deck do K oficial e máscaras das carpas; chama `fountain.py` para a fonte |
| `continuity_review.py` | Revisão de continuidade pelo Gemini (`klaude --model gemini-3.8-flash`, Gemini 3.8 Flash pelo proxy): recebe capturas do motor, os fatos medidos com elas e as regras da área, e devolve os erros em JSON (seção Espelho no vidro, Aprendizados) |
| `fountain.py`, `test_fountain.py` | Fonte da Koru: nicho de pedra na fachada, a Koru oficial com luz do alto à esquerda, consolo, jato, respingo, anéis e a água que a fonte agita; o teste guarda o contrato com o shader da água e com a moldura da parede (seção Piscina, fonte e carpas) |
| `signature.py` | Peças da marca: telão de LED, balcão, parede de destaque, totem, tapetes, floreira, porta-retratos, porcelanato, granilite e passarela de carvalho |
| `lounge.py` | Peças do lounge e da sala de jogos do café: painel com neon e quadros, aparador, bar, banquetas, sofás, pufes, carpete de jogos, pendente, terminais (air hockey, xadrez, Lig 4, fliperama de Breakout) e plantas grandes |
| `runtime/` | `seating.mjs` (sentar automático), `interactions.mjs` (portas, jogos, acenar), `social.mjs` (mesas, salas trancadas, reações, som ambiente), `bell.mjs` (sino da venda), `hud.mjs` e `hud-core.mjs` (presença, lugar e momento da interface), `page.mjs` (o que os scripts da página assumem), com testes das partes puras |
| `pool/koi/` | Carpas: simulação, campo de distância, pintura, prévia, testes e README próprio |
| `reactions/`, `map-script.js`, `qa.py`, `qa_hud.py`, `qa_sound.py` | Animação das reações, script do mapa, verificação no motor, da interface e do som e do sino |
| `seat_sheet.py` | Folha de contato do avatar sentado: um quadro por tipo de assento e direção, ou por assento com `--all` |
| `dist/` | O que o WorkAdventure carrega (regenerado, fora do Git) |
| `renders/`, `reviews/engine/`, `reviews/seats/`, `reviews/hud/`, `reviews/lawn/`, `reviews/fountain/` | Prévia, resumo do build, capturas do motor, folhas de contato dos assentos, capturas da interface, o antes e depois do gramado e o da fonte da Koru |

## Gerar, carregar e conferir

```sh
python3 hq-office/build.py
cd local-wa && ./load_map.sh ../hq-office/dist konclui-office && cd ..   # a sala de trabalho; antes: capture_edits.py
python3 hq-office/qa.py                             # grupos: views walls thin doors seats koi interactions social lawn water
python3 hq-office/seat_sheet.py                     # folha do avatar sentado (--all: as 213 vagas)
python3 hq-office/qa_hud.py                         # interface: wake place presence map goto prompt desk talk game phone others
python3 hq-office/qa_sound.py --url …               # som e sino: handshake curve walk contract bell queue sale fallback
node --test hq-office/runtime/*.test.mjs
node --test theme/hud-audio.test.mjs                # curva do som ambiente e leitura do contrato de volume
python3 -m unittest discover -s hq-office -p 'test_taxonomy.py'   # categorias do editor, sem build (~30 s)
python3 -m unittest discover -s hq-office -p 'test_fountain.py'   # fonte: contrato com o shader da água e com a parede, sem build (~3 s)
(cd hq-office/pool/koi && node --test)
node --test local-wa/hot-reload/*.test.mjs          # patches do gateway local (paredes finas, pose sentada, cena dos shaders)
node --test theme/fx/*.test.mjs                     # shaders: luz da hora, luzes, rastro, nuvens, GLSL sem palavra reservada
python3 hq-office/perf.py --gpu --check [--hour 13]  # custo de desenho com os efeitos (a hora muda os efeitos)
```

O build é determinístico: os IDs são UUID5 das chaves do plano. `load_map.sh` sem `--preserve-wam` troca a pasta
inteira da sala, então compare antes o `.wam` servido com `dist/office.wam` e só carregue se forem iguais.

## Edições no editor

O que o dono move no editor vale mais que o plano. Antes de carregar:
1. Guarde a cópia do servido.
2. `python3 hq-office/capture_edits.py` compara o `.wam` servido com `dist/office.wam` (o build de onde a sala foi
   carregada) e grava em `editor-edits.json`:
   - peça do plano movida, com a chave do plano (`meeting_01/w`) e `x`, `y` em pixels, ou apagada
     (`{"deleted": true}`);
   - objetos criados no editor em `"_added"`, como o `.wam` servido os guarda;
   - áreas mudadas ou criadas no editor em `"_areas"`, como servidas, ou apagadas.
3. Gere de novo e confira que nenhuma peça, posição ou área difere do servido.

O build aplica esse arquivo por último, inclusive em espelhos, cadeiras e peças sobre móveis (a peça continua a mesma
variante "sobre móvel", no lugar onde o dono a deixou). As propriedades que o editor reescreve sozinho nas peças
(descrições vazias, ordem dos campos) não mudam nada e não são levadas.

Para mudar só o script, os tiles ou os catálogos com o dono editando, use `./load_map.sh --preserve-wam`: o `.wam`
servido fica como está.

## Versões

| Quando | Onde | O que é |
|---|---|---|
| 17/10/2026 | `escritorio-sede` | v1: o programa do escritório principal com o catálogo importado |
| 18/10/2026, até 17:07 | `escritorio-sede` | Piscina nativa, paredes finas, sentar automático, vidros, recepção, cores do DS |
| 18/10/2026, 18:33–21:03 | `escritorio-sede-hud` | Sala de teste: interface no estilo do escritório de referência, gramado, água, folhas do dono, quadros da marca, cabines de dois tiles, plantas na borda do lago, edições do dono no editor |
| 18/10/2026, 21:10 | `escritorio-sede` | Recebe o build das 21:03 (o mesmo da sala de teste) e fica **congelada** como versão anterior, com a interface por momento |
| 19/10/2026 | `escritorio-sede-hud` | **Sala de trabalho.** Build com a Recepção de volta ao plano (o dono: "pode voltar"); as duas salas são o mesmo mapa fora essa área |
| 19/10/2026 (2) | `escritorio-sede-hud` | Brisa em rajadas juntas a cada 14 s; cadeira da recepção de volta ao plano. Carregado em 20/10/2026, depois de refeita a VM local |
| 20/10/2026 | `escritorio-sede` | Refeita na VM nova a partir da cópia congelada (abaixo); as camadas de tiles conferem com o backup, 0 tiles diferentes |
| 21/10/2026 | `escritorio-sede-hud` | Consolidação do que estava pronto: lounge e sala de jogos, fonte da Koru, reflexo no vidro, paredes finas, sino da venda, uma imagem por peça sobre móvel. Três objetos criados pelo dono no editor entraram em `editor-edits.json`; o pufe antigo do café saiu com o plano novo. `qa.py`, `qa_hud.py` (22 grupos), `qa_sound.py` e `theme_preview.py --check` passaram; `perf.py --gpu --check` às 13h (26/26/29/29 chamadas) e às 21h (28/28/28/28), nada acima. Os pets ainda não fazem parte: a arte segue na outra frente |
| 21/10/2026 | `konclui-office` | **Sala de trabalho renomeada** a pedido do dono: cópia exata da `escritorio-sede-hud` servida (664 objetos, 27 áreas, coleções reapontadas e conferidas); antes, `capture_edits.py` registrou a luminária da recepção apagada no editor. Cópia de segurança em `.scratch/map-archive/20261021-konclui-office/` |
| 21/10/2026 | produção | Primeira publicação: `upload_sede.py` (12 MB, 9/9 arquivos conferidos), sala abre no ar com os botões do script; campus intacto (`smoke_live.py` passa) |

- **Cópias de cada carga:** `.scratch/hq-office/backup/` guarda o `.wam` (e às vezes o `.tmj`) servido antes de cada
  carga, com a hora e o motivo no nome (`escritorio-sede-hud-20261019T055205-before-recepcao.wam`). Local, fora do Git.
- **Salas antigas:** as 32 salas de validação que nenhum script usa (provas de patch, `escritorio-pixel-mobiliario-*`,
  `office-validation-*`, `seat-lab`…) saíram do map-storage local em 19/10/2026, arquivadas em zip com índice em
  `.scratch/map-archive/20261019/` (`local-wa/archive_rooms.py`; README do `local-wa`, "Arquivo de salas").
- **Refazer a sala congelada:** o `dist` não vai para o Git e os tilesets mudaram depois (o `Konclui_Decor` tinha
  256 tiles, hoje tem 160), então o `.tmj` congelado não roda com o build atual. Refaz-se com o build do commit
  `72ee1b37`, fora do repositório, e o `.tmj`/`.wam` congelados por cima:
  `git archive 72ee1b37 hq-office office map media/sounds design/interiors/2026-10-18 tests | tar -x -C /tmp/frozen-src`,
  um link de `.dream-loop` para dentro (os SVGs da Koru não estão no Git), `python3 hq-office/build.py --out /tmp/frozen-dist`,
  copiar `.scratch/hq-office/backup/escritorio-sede-20261019-congelada.{tmj,wam}` como `office.{tmj,wam}` e
  `local-wa/load_map.sh /tmp/frozen-dist escritorio-sede`.
- **Otimizações:** ver "Desempenho"; o medidor é `perf.py`, e o `--check` reprova acima das metas.

## Nomes

A marca do catálogo de origem não aparece em pasta, arquivo, coleção, ID, categoria, nome de objeto, texto visível,
sala, chamada ou crédito desta sede:
- a cópia do catálogo se chama "Mobília";
- a placa com o logotipo da origem fica de fora;
- os créditos do mapa dizem "arte de terceiros licenciada para uso interno".

Os únicos pontos técnicos que ainda usam o nome são a linha de `catalogue.py` que importa o importador compartilhado do
escritório principal e a nota de licença que acompanha aquele catálogo. Renomear qualquer um dos dois quebraria o
build do escritório principal.

## Categorias do editor

Pedido do dono em 20/10/2026: "categorizar / organizar todas as opções de móveis e decoração, itens". Antes, cada
coleção tinha as próprias categorias ("Mobília: cadeiras", "Escritório moderno: cadeiras e sofás", "Koncluí: sobre
móveis"…): 49 no editor, e a mesma função em até três lugares. Os termos estão em [`GLOSSARY.md`](GLOSSARY.md).

- **Contrato:** `taxonomy.json`, com a forma em `taxonomy.schema.json`. Quem monta as coleções lê dele: `catalogue.py`
  (Mobília), `sheets.py` (Escritório moderno, Estantes e livros, Plantas em vaso, LPC) e as peças próprias em
  `build.py`. Uma peça nova sem regra para o build com a mensagem de onde pôr a regra.
- **Como o editor lista** (WA 1.34, lido no código; referências em `office/entity_categories.py`): uma entrada por
  coleção e nome, as variantes por cor e direção, uma categoria por etiqueta, em ordem alfabética. Por isso cada peça
  tem uma só etiqueta, a sua categoria, e as coleções nenhuma. A ordem do contrato é a do editor, e o teste confere.
- **21 categorias por função, as mesmas em todas as coleções:** Armazenamento, Cadeiras e bancos, Comidas e bebidas,
  Cozinha e café, Decoração de parede, Divisórias e biombos, Escritório e papelaria, Estilo fantasia (LPC), Exterior e
  jardim, Festas e datas, Jogos e lazer, Luminárias, Mesas, Objetos decorativos, Paredes, portas e janelas, Peças da
  marca, Plantas, Sofás e poltronas, Tapetes e pisos, Tecnologia e telas, Utilidades e segurança.
- **Regras:**
  - Mobília: pela categoria, família e tipo do catálogo de origem; vale a regra mais específica.
  - Escritório moderno: pela categoria que o escritório principal dá à peça e pelo nome.
  - Folhas: por folha.
  - Peças próprias: pelo tipo no plano, com `*`; exatamente uma regra por peça.
  - Peça apoiada ("(sobre móvel)") e recoloração ("(cores da marca)") ficam na categoria da peça de origem.
  - Peça da marca é só o que mostra o logotipo, o K ou a Koru, e a série de quadros da marca (marca, Koru,
    restaurantes). Tapetes de lã, floreira, móveis do lounge e quadros abstratos vão pela função.
  - As peças LPC ficam juntas em "Estilo fantasia (LPC)": são outro traço.
- **Limpeza:**
  - **Gêmeas:** 30 entradas (45 variantes) saíram do editor, 10 da Mobília, 10 do Escritório moderno, 3 das estantes
    e 7 da LPC. Cada uma é idêntica a outra que fica: o teste confere desenho, colisão, profundidade, direção e
    assento. Uma peça que o dono pôs no editor nunca sai, mesmo listada.
  - **Nomes:** "(petrol)" e "(mint)" viraram "(cores da marca)", e as cores do design system de uma peça passam a ser
    variantes de cor da mesma entrada. Três nomes que se repetiriam na mesma categoria ganharam complemento na
    Mobília: "Cadeira de escritório giratória", "Quadro branco de pé" e "Quadro de avisos de cortiça". O quadro das
    reuniões, gêmeo do "Quadro branco de parede", ficou com esse nome.
  - **Variantes que ninguém escolhia:** porta-retratos (4) e almofadas (frente e costas) dividiam nome e cor. Agora
    cada variante tem a cor média do próprio desenho.
- **Números** (antes → depois, pelo `taxonomy.py --memory`): 6 coleções; peças 11.413 → 11.368; entradas
  1.326 → 1.296; categorias 49 → 21; variantes que ninguém escolhe 37 → 29, todas cópias de profundidade de uma peça
  apoiada (o editor oferece uma de cada).
- **Ficou como estava, de propósito:**
  - Gêmeas parciais, como as mesas modulares individuais (4 de 5 variantes iguais), o notebook aberto de frente e
    pisos com acabamentos repetidos. Tirar uma variante mudaria a escolha de cores.
  - Desenhos iguais em outra posição no quadro (luminárias de mesa 2, 7 e 8): colisão e âncora mudam.
  - Nomes numerados das folhas ("Estante 4", "Planta em vaso 12", "Natureza e feira 042"). O nome é a chave do plano,
    e um nome descritivo pede olhar peça por peça.
  - A coleção Koncluí só tem as peças próprias que o plano coloca (o porta-retratos de família, por exemplo, só
    existe sobre a mesa). Oferecer todas é decisão do dono.
- **Conferir:** `python3 -m unittest discover -s hq-office -p 'test_taxonomy.py'`, sem build; depois de um build, o
  mesmo teste compara `dist/`. No motor: `python3 local-wa/check_objects.py <sala> "Cadeiras e bancos" cadeira`.

## Design

- **Regra 60-30-10:** neutros claros, carvalho e petróleo como secundária, menta só no acento.
- **Pisos em três famílias:** pedra clara na circulação e no lobby, carvalho natural nos ambientes de estar e
  trabalho, carpete no auditório e nas ilhas.
- **Paredes:** brancas, com o topo em tinta `#0A0A3D`.
- **Vidros:** grandes, sem caixilho, com película turquesa.
- **Móveis:** mesas brancas com iMac, cadeiras em petróleo, madeira nas reuniões e no café.
- **Recepção:** parede de destaque com o logo, balcão com o K, tapete de entrada, porta automática, totens e salas de
  espera com tapete.
- **Cada mesa tem dono:** até três objetos por mesa, sorteados de forma fixa pela chave da mesa, nas pontas livres ao
  lado do iMac. Mesas espelhadas sorteiam à parte.
  - Bebida: caneca, chá, café gelado, bubble tea, garrafinha ou refrigerante.
  - Papel: documento, bloco, caderno ou livro.
  - Pessoal: porta-retratos com praia, montanha, cachorro ou família, plantinha, patinho ou maçã.
  - Eletrônico: tablet e celular, ou fones.
- **Vida no resto do escritório:**
  - Quadros e relógio nas reuniões, com tapete sob a mesa.
  - Painéis acústicos ao lado do telão.
  - Um quadro diferente em cada cabine.
  - Prateleira, relógio e jardim vertical na copa, e tapete na área de lazer.
  - Plantas grandes nos cantos das salas e do hall.
  - Bancos e canteiros floridos no caminho de entrada.
- **Plantas não colidem.** Por decisão do dono, as 470 variantes de planta (vasos, árvores, arbustos, suportes) perdem
  a colisão na coleção desta sede, inclusive quando postas pelo editor. A floreira da marca também.

## Piscina, fonte e carpas

Tudo é desenhado em um pixel de arte por pixel do mapa (32 por tile), sem o serrilhado da arte 2× do escritório
principal.

- **Água, refeita em 18/10/2026 a partir das referências do dono (lago esmeralda, lago de vitórias-régias):**
  - **Cor:** turquesa-esmeralda em 8 tons, sem pontilhado. A profundidade vem da distância à margem, quebrada por
    manchas grandes em poços fundos e bancos claros.
  - **Detalhes:**
    - Pedras do fundo escuras, com borda iluminada.
    - Sombra da margem e reflexo das plantas abaixo das margens do norte.
    - Sombra do deck, da ponte, das vitórias-régias e das folhas sobre a água.
    - Linha d'água quebrada e pontos de sol.
  - **A água fica parada nos tiles do piso.** O movimento está na camada `decor`: brilhos de sol que piscam e ondinhas
    que se abrem de vez em quando, em tiles que não dependem do lugar. Só o chafariz continua com 8 quadros.
  - **Peso:**
    - Piso de 1.408 para 544 tiles (PNG de 379 para 193 KB).
    - Tiles animados no piso de 120 para 7.
    - 83 tiles de brilho e ondinha na camada `decor`.
- **Margem, refeita com `flora.py`:**
  - Grupos de pedras na linha d'água, com capa de musgo e a parte de baixo tingida pela água.
  - Samambaias debruçadas sobre a água.
  - Touceiras de folhas, e grama com ranúnculos amarelos ou cabeças de trevo branco.
  - Juncos e taboas no raso.
  - Tudo isso no lago, no canal e na cabeceira da fonte.
  - As plantas de canteiro em volta do lago (`plan.POOL_PLANTS`: samambaia, hosta, equinácea) ficam sobre a borda,
    não no porcelanato (dono, 18/10/2026: "essas plantinhas sem vaso estão esquisitas... por cima da borda"). O build
    (`on_bank`) leva o pé de cada uma ao ponto mais próximo da borda externa (`pool.bank_edge`), 6 px para dentro do
    verde. Uma planta que o dono arrastou parte de onde ele a deixou.
- **Vitórias-régias:** em grupos, com entalhe, borda iluminada e nervuras; ninfeias brancas ou rosa em algumas.
- **Um sistema óptico para todos os sprites** (dono, 18/10/2026: "igualar tamanho óptico e peso do traço, não só o
  tamanho em pixel, e alinhar"):
  - **Traço:** o contorno sai sempre nos mesmos pixels, a borda de baixo e da direita da silhueta. Lâmina de 1 px não
    ganha contorno, para não dobrar de largura.
    - A cor é calculada, não escolhida no olho: o matiz de cada material, na luminância que dá contraste 1,5 contra
      onde a peça está (o chão da margem ou a água).
    - Medido pelo verificador, contra o mesmo chão, o contraste da borda foi de 1,48–2,33 para 1,44–1,59. Só a
      ninfeia branca fica acima (de 2,26 para 1,98): é o destaque mais claro da cena.
  - **Tamanho óptico:** samambaia, touceira e grama, que se revezam na margem, têm a mesma área percebida (a
    silhueta com os vãos entre lâminas fechados).
    - Ficaram a −5%, +5% e 0% da média. Antes eram +6%, +22% e −28%: a touceira parecia 1,7× maior que a grama.
    - A samambaia desceu um tom, para não parecer mais leve.
  - **Âncora:** onde a peça toca o chão ou a água: a base da pedra, a coroa da samambaia, o pé da touceira e da
    grama, o meio da vitória-régia, a base da ninfeia sobre ela.
    - As plantas de terra têm a mesma sombra de contato de 1 px.
    - Saíram as compensações à mão no `pool.py` (`+0,45·r` da pedra, `−1` da ninfeia).
  - **Verificador:** `python3 hq-office/flora_optics.py` mede tudo isso, e o build recusa um sprite que fuja das
    regras. Com a flora anterior, ele aponta 11 problemas.
- **Canal:** mesma largura do trecho entre as salas 02 e 03, da fonte ao lago.
- **Ponte:** no meio do trecho entre o corredor e o lago, ligada por uma passarela de carvalho.
- **Deck do K oficial** com espessura e sombra.
- **Fonte da Koru, refeita em 20/10/2026** (dono: "Como podemos melhorar essa Koru aqui? Na sua aparência, elementos
  do fundo, shaders, água caindo"). Toda em `fountain.py`; o `pool.py` só a chama.
  - **Nicho na fachada:** calcário quente, cornija fina, pilastras com capitel e base, fundo azul-ardósia que destaca o
    teal da Koru, e rodapé. A metade direita é um tom mais escura, porque a luz vem da esquerda. A camada da estátua
    cobre a face da parede (o `build.py` abre o buraco no `walls`), sem tocar a moldura azul-marinho.
  - **Koru oficial com luz:** silhueta e cores do vetor; as únicas linhas desenhadas por cima são as penas que o dono
    traçou.
    - **Penas** (dono, 20/10/2026: "falta um pouco mais de textura e profundidade aqui na koru", com os traços sobre a
      captura): três por asa, uma longa da ponta ao ombro e duas mais curtas embaixo, e dois arcos de cada lado da
      barriga (`FEATHERS` em `fountain.py`, curvas no espaço da imagem de 98 px).
      - Cada uma é 1 px escuro com 1 px de luz do lado de cima e da esquerda, onde a pena de cima pega luz, e 2 px de
        sombra embaixo e à direita, a sombra que ela joga na de baixo.
      - Pequenas escamas de 3 px, espaçadas, na barriga e entre as penas das asas, dão a textura.
      - A primeira tentativa, com linhas partindo de cada entalhe da silhueta, virou hachurado e foi descartada.
    - O vetor tem pouco contraste: discos do rosto, barriga e asas em gradiente. Quantizado para as 5 cores, isso
      sumia. Agora a luminosidade do próprio vetor vira 4 degraus duros da rampa.
    - 1 px de luz na borda de cima e da esquerda, um degrau de sombra embaixo e à direita, e contorno só nessas duas
      bordas.
    - Olhos escurecidos, com 2 px e uma linha clara embaixo. Bico, boca e língua nas cores do vetor.
  - **Consolo de ardósia:** bacia com lábio claro, dois blocos, musgo pendurado e pingos. Fica na frente do pé da Koru,
    que termina sobre ele.
  - **Água:**
    - Jato que alarga de 3 a 8 px, um pixel por vez, com traços de luz descendo 4 px por quadro. O período é de 16 px,
      então o ciclo de 8 quadros fecha.
    - Coroa de espuma que sobe e desce com o ciclo, gotas de três tamanhos e seis anéis de 1 px que se afastam e
      esmaecem.
    - Tigela de água agitada com halo, e cauda de bolhas canal abaixo.
  - **Contrato com o shader da água:** o `fx.py` repinta toda água aberta que o piso mostra igual em todos os quadros.
    - Tudo que a fonte anima fica dentro de `fountain.stirred`, e ela só desenha ali.
    - O `test_fountain.py` reprova se um pixel animado sair da máscara ou se o nicho tocar a moldura da parede. Os dois
      casos foram provocados de propósito, e o teste falhou nos dois.
  - **Sombra na água:** a sombra do rodapé e do consolo entra em `shadow`, como a do deck, e escurece a água parada
    debaixo das plantas.
  - **Peso:** 8 tiles animados no piso (eram 7) e 576 tiles de piso (eram 544).
    - Draw calls e vértices iguais aos do `pool.py` anterior no mesmo build: `reviews/perf/koru-fountain-12h.json`
      contra `koru-fountain-base-12h.json`.
    - O `room-idle` com 32 e o `walk` com 31 draw calls por quadro (limite 30) aparecem nos dois builds ao meio-dia,
      com e sem a fonte nova. Às 22 h, `koru-fountain-22h.json` fica dentro do limite.
  - **Como foi feito:** dream-loop Pro, com um alvo gerado a partir da captura do motor do dono
    (`design/interiors/2026-10-20/koru-fountain/`) e cinco rodadas de um juiz independente: 5,5, 6,5, 6,8 e 7,1 de 10
    sobre o composto, e 7,3 sobre a captura do motor, com os shaders.
    - O que o juiz ainda pede é, em boa parte, o que o vetor oficial não tem: penas em camadas, bico em cunha e dedos.
    - Evidências no motor em `reviews/fountain/`: antes e depois, dia e noite, GIF e o resumo do `qa.py`. O QA rodou
      numa sala privada (`escritorio-sede-koru`), com todos os grupos passando.
  - **Aprendizados:**
    - Linhas de "penas" partindo dos entalhes da silhueta viraram hachurado. Foram descartadas.
    - Um anel em elipse achatada 2:1, com o limiar na distância, sai com 1 px em cima e 2,6 px nas laterais. A
      espessura tem de ser dividida pelo gradiente da distância.
    - Um xadrez `(y + c + k) % 2` no pé do jato é pontilhado e ainda pisca. Foi tirado.
    - A sombra desenhada por cima da água, na camada da estátua, escurecia só a parte de cada pedra que está na água.
      Isso só apareceu no motor; no composto não se via.
    - Para comparar com um alvo, meça o enquadramento antes. A moldura da fachada está em y = 197, e não em 192.
    - Ao mudar a assinatura de `statue()`, grave o `fountain.py` antes do `pool.py`. Por cerca de 2 min, o `pool.py`
      esperou 3 valores que o módulo ainda não devolvia.
    - O `build.py` põe `hq-office/` no começo do `sys.path` ao ser importado. Para testar uma cópia de `pool.py`,
      importe a cópia antes; o cache de módulos a mantém.
- **Carpas** ([`pool/koi/README.md`](pool/koi/README.md)): navegam pelo campo de distância, formam grupos soltos e
  nadam em impulso e deslize. Disputam a comida, vêm até quem para na margem e somem sob o deck. São duas sobreposições,
  lago e canal.
- **Som ambiente:** água perto da piscina e cafeteria no café, com botão para ligar e desligar.

## Folhas trazidas pelo dono

Sete folhas, cópias dos repositórios de referência, com procedência em `sources/sheets/README.md`. O dono confirmou
que as licenças estão abertas no GitHub do WorkAdventure.

**No editor:** quatro coleções novas, 742 peças (eram 762; as 20 gêmeas saíram em 20/10/2026), cada peça na sua
categoria de `taxonomy.json` (seção Categorias do editor).

| Coleção | Peças | De onde |
|---|---|---|
| Escritório moderno | 317 | O Modern Office 32 px já recortado, nomeado e medido pelo escritório principal (`office/modern_office.py`, só leitura): nomes, tipos, física e os 27 assentos |
| Estantes e livros | 37 | `bookshelves.png`: 17 estantes e 20 fileiras de livros (um aglomerado e três estantes gêmeas ficam de fora) |
| Plantas em vaso | 97 | `indoor-plants.png`; nenhuma colide, regra do dono |
| LPC | 291 | As três folhas LPC: interior clássico, natureza e feira, terrenos e manchas (sete gêmeas ficam de fora) |

**Recorte das outras folhas (`sheets.py`):**
- **Separação:** partes conexas da transparência numa grade de 4 px, cada peça mascarada à própria parte.
- **Formato:** canvas de tiles inteiros, com a peça apoiada no fundo, para a colisão cair embaixo do objeto.
- **Física:**
  - Estante e objeto de pé colidem na fileira de baixo.
  - Planta não colide.
  - Mancha de chão e tapete ficam sob os avatares.
- **Fica de fora:**
  - Fragmentos de parede e piso.
  - Peças grudadas.
  - Folhas soltas menores que 12 px.
  - Toda cadeira e todo sofá LPC: assento sem ponto de sentar não entra, regra de 13/10. Os assentos ficam com o
    catálogo e o Modern Office.
- **O que não saiu:** as cerejeiras e os barcos da folha de natureza encostam em outras peças e passam do tamanho
  máximo do recorte.
- **Os campos de terreno que se repetem** (terra, areia, água) servem para pintar piso no Tiled, não viram peças.

**Assentos do Modern Office:**
- Usam os pontos do escritório principal e a pose sentada da sede.
- Na cadeira vista de costas, a peça inteira é desenhada na frente de quem senta, como o Gather faz.
- **Testado numa sala descartável**, apagada depois: 8 de 8 tipos sentam e levantam, nas quatro direções, inclusive
  a poltrona casulo e o módulo de sofá. Prints em `reviews/engine/seat-mo-*.png`.

**No mapa:**
- Impressora multifuncional sobre o aparador de cada sala de equipe (dono, 18/10/2026: "vão colocar algum móvel por
  baixo?"). Depois o dono tirou aparadores e impressoras no editor e pôs estantes; vale o que está em
  `editor-edits.json`.
- Estante com plantas no canto de cada lounge.
- Máquina de lanches e geladeira de bebidas no café.
- As LPC ficam só no editor: são outro traço (RPG de fantasia).

**Luz (`pattern-light.png`):**
- Camada `luz`, acima dos avatares, nas salas de equipe (fachada norte) e na faixa sul do prédio.
- Os feixes são mais fortes junto ao vidro e somem depois de 6 tiles (norte) ou 4 (sul).
- Na força original (18% no máximo), o feixe some sobre o carvalho claro. Por isso vai 5× mais forte e em branco
  quente; a 8×, parecia neblina.
- É um degradê suave, não pixel art.
- Custa 224 tiles (24 KB).

## Vida pelas referências do Gather

O dono mandou trechos do Gather: lounge-biblioteca, salinhas de reunião, Boardroom, sala-biblioteca, ilha de trabalho,
escritório com estacionamento e doca. A regra que eles ensinam é que cada espaço tem uma função, e os objetos sustentam
essa função.

| Área | O que entrou (18/10/2026) |
|---|---|
| Auditório | Eames Lounger preta nas 64 poltronas (a cadeira da Boardroom do Gather, a do pedido); câmera no tripé no corredor central; no palco, duas Eames de convidado de frente para o púlpito, com mesinha e bebida |
| Reuniões | Eames em volta da mesa; notebook, livro aberto e papéis na mesa; arquivo com globo no canto de baixo (no de cima, o globo cobria os quadros); flipchart ao lado do quadro branco; luminária de pé |
| Lounges do hall | A composição da referência em lajota terracota 7×7 (`Tile_2tone_Orange`, zona `rug-tile`): sofá e poltrona LeCorbusier grafite nos dois sentidos, mesa de centro de madeira com dois vasinhos, mesinha com caderno e uma costela-de-adão em cada canto. O leste espelha o oeste |
| Café | Um modelo de cadeira por par de mesas (branca, Wabi Sabi de carvalho, preta); comida nas mesas (coxinha, açaí, pizza, donuts, salada, sushi); duas estantes de carvalho, com planta e busto, separam o salão do lounge; totó no canto de jogos; violão perto do sofá |
| Jardim | De cada lado da entrada, uma mesa de piquenique e um par de Adirondack virado para uma mesa de tronco |

Peças criadas pelo dono no editor nesse meio-tempo (duas Eames encostadas no vidro da reunião 01) foram para
`editor-edits.json` (`"_added"`) e continuam no mapa.

**Próximas rodadas:**
- O lounge do café, ainda no estilo antigo.
- A parte de baixo das salas de equipe.
- Serviços: copa, banheiros, kit de primeiros socorros, máquinas de lanche e estantes de material.
- O entorno: estacionamento e entrega, como no escritório da última referência.

## Quadros da marca

Em 18/10/2026, 16 quadros, um tipo cada na coleção "Koncluí", com nome em português no editor ("Quadro: Koru acenando").
Antes, as paredes só tinham arte genérica do catálogo.

- **Marca:** o K (menta sobre navy e navy sobre menta) e o logotipo, desenhados dos vetores oficiais.
- **Koru:** acenando, apresentando, comemorando, no notebook, com o checklist e no café. As poses foram geradas com a
  Koru oficial como referência (o dono liberou qualquer pose) e conferidas contra ela: corpo, discos dos olhos, tufos,
  bico e pés.
- **ICP:** cozinha (chef com o prato), salão, gestora com o checklist, equipe, prato, fachada e barista. Geradas com IA
  e sem números de prova social, porque a decisão D2 está pendente no vault.
- **Onde:**

  | Lugar | Quadros |
  |---|---|
  | Reuniões | Dois por sala, à esquerda da TV |
  | Cabines de baixo | Um por cabine |
  | Auditório | Um de cada lado do telão; o painel acústico da esquerda passou da coluna 7 para a 6, para os vãos ficarem iguais |
  | Recepção | Um de cada lado do logo, sob os spots das pontas |
  | Café | Na faixa acima da bancada |

  As posições vêm de medidas, em pixels, do que já estava pendurado em cada parede.
- **Tamanho:** o mapa mostra 1 pixel de arte por pixel do mapa, então o detalhe de um quadro é o tamanho dele.
  - **L (48×34) e P (34×44):** o tamanho óptico dos quadros do catálogo, nas cabines, no auditório e no café.
  - **XL (64×48):** destaque onde a parede comporta (dono: "maiores onde couber"), na recepção e nas reuniões.
- **Uma moldura para a série:** tinta de 2 px (o anel de dentro iluminado no alto e à esquerda), passe-partout de 1 px
  e sombra leve.
- **Conversão:**
  - Recorte no formato do quadro: pelo assunto, nas poses da Koru; em close do garçom, no salão.
  - Redução por média de área.
  - No máximo 12 cores, sem pontilhado; pixels soltos fundidos aos vizinhos.
- **Fontes:** em `design/interiors/2026-10-18/brand-frames/`.
  - Originais.
  - `prompts.json`, com estilo, identidade da Koru e cena de cada quadro.
  - `runs.jsonl`, com prompt exato, referências, rota e hash de cada geração.
  - `tools/generate.py`, que gera só o que falta.
  - Retratos substituídos, em `originals/archive/`.
  - Gerador: assinatura do ChatGPT pela skill `ai-image-gen`, rota `gpt-cli`, sem custo por imagem; o modelo não é
    informado pela rota.

## Lounge e sala de jogos do café

Pedido do dono em 20/10/2026: o lounge e a sala de jogos do café (colunas 68 a 80, linhas 30 a 47) estavam "muito
triste"; dream-loop (fluxo Pro) "pra deixar incrível". Depois: "ter todos terminais lá pros usuários conseguirem
interagir" com os jogos. Alvo, capturas, veredictos e ferramentas em `.dream-loop/jogos/` (fora do Git).

- **Fundo da sala:** um painel navy solto (o lounge não tem parede própria nesta vista), com o letreiro neon de ondas
  e dois quadros abstratos da marca, sobre um aparador baixo de teca com livros, plantinhas, troféu e jiboia. A linha 30
  fica livre como passagem entre o café e os dois lados do painel; as colunas 78 a 80 também.
- **Lounge:** dois sofás de três lugares em ardósia com almofadas (turquesa, menta, lima) e manta, a mesa de centro
  oval com o xadrez, o tapete de losangos, criados-mudos com luminária, a luminária de arco com cúpula, o violão, um
  banquinho com samambaia e plantas grandes desenhadas no tamanho certo (ave-do-paraíso, costela-de-adão, aglaonema).
  O sofá de baixo está de frente para os jogos.
- **Bar:** balcão de teca com cafeteira, fruteira e planta, e três banquetas que sentam (de costas para a sala).
- **Jogos:** carpete navy com borda lima e uma linha turquesa em volta das mesas, luminária pendente sobre a sinuca,
  tacos e alvo de dardos, e um terminal para cada jogo de `map/campus_web/games/`:

  | Jogo | Terminal | Chave do plano |
  |---|---|---|
  | Tetris | O fliperama branco do catálogo com corpo navy (`lounge.py`) | `cafe/arcade` |
  | Breakout | Fliperama branco com tela de tijolos e acabamento turquesa (`lounge.py`) | `cafe/arcade-breakout` |
  | Flappy Koru | Fliperama verde do catálogo | `cafe/arcade-flappy` |
  | 2048 | O fliperama branco com corpo azul-aço, letreiro menta e uma grade de peças na tela (`lounge.py`) | `cafe/arcade-2048` |
  | Pingue-pongue | Mesa do catálogo | `cafe/pingpong` |
  | Sinuca | Mesa do catálogo, sob a pendente | `cafe/pool` |
  | Air hockey | Mesa desenhada (`lounge.py`), à direita do lounge | `cafe/airhockey` |
  | Piano | Piano vertical do catálogo, à esquerda do lounge | `cafe/piano` |
  | Xadrez | Tabuleiro na mesa de centro do lounge | `cafe/coffee-table` |
  | Lig 4 | Mesinha com o jogo, no corredor entre o pebolim e a sinuca | `cafe/lig4-table` |

  Terminais lado a lado: o runtime escolhe o objeto mais próximo quando os retângulos se sobrepõem
  (`runtime/interactions.mjs` `spotAt`), e o build faz o retângulo pelo desenho, não pela tela transparente. Nenhum
  assento fica dentro do retângulo de um terminal, para o ESPAÇO de quem está sentado só levantar.
- **Peças próprias:** `lounge.py`, no padrão das outras (`Koncluí: …` no plano, nome em português, uma regra em
  `taxonomy.json`). Pixel art sem pontilhado, contorno no tom escuro do material, luz do alto à esquerda em faixas, cores
  da marca só nos acentos. Banquetas, sofás e o par de pufes sentam: a peça leva o contrato de assento do catálogo
  (`seat` com `anchorOffset`, `direction` e `more`), e o `build.py` o aceita nas peças próprias. Quem senta fica
  sempre no centro do tile e a imagem é posta em volta da âncora: mudar a âncora move a peça, não a pessoa. Por isso as
  banquetas não seguem o espaçamento do alvo (28 px entre elas, contra os 32 de um tile).
- **Luz:** o letreiro (`sign`), a pendente e a luminária de arco (medidas como pendente: a luz sai de baixo da cúpula) e
  as luminárias de mesa têm luz noturna por nome (`fx.py`). De dia o motor não acende luminárias, então as poças de luz
  em faixas estão desenhadas junto da luminária (a da pendente, no carpete).
- **Piso:** o carvalho do lounge e as faixas de espinha-de-peixe em volta ficaram um passo mais quentes (rampa
  `oak-warm` em `palette.py`).
- **Peças vestidas e chamadas de desenho:** o motor desenha todos os objetos em todo quadro, e cada textura nova custa
  chamadas. Com cada objeto de prateleira, mesa e sofá separado, o lounge somava 48 texturas e 4 chamadas por quadro;
  aparador, bar, sofás e mesas passaram a levar o que está sobre eles na própria imagem, e as poças de luz de dia
  vão com as luminárias e o carpete (cerca de 24 texturas a menos). As luminárias de mesa continuam peças à parte: a
  luz noturna sai da imagem delas. Medido em 20/10/2026 (`perf.py --gpu --check`) contra a mesma base sem o lounge
  novo: Sala 01 parada 28 → 30 chamadas, andando 27 → 29, hall e lago 25 → 27. Passa, mas a Sala 01 parada ficou no
  teto de 30: a próxima textura nova no mapa precisa sair de outra.
- **Limites:** a noite do alvo é azul-ardósia e a do motor é quente (a luz da hora em `theme/fx/` aquece pisos de
  madeira); o brilho rosa dos fliperamas e a poça da pendente não aparecem no carpete navy à noite (a luz dos efeitos não
  acende superfícies escuras); a fachada sul mostra o gramado pelo vidro, e o alvo, vidro fosco. Nada disso é desta sala.

## Gramado

Desenhado em `lawn.py`, um pixel de arte por pixel do mapa, como a piscina. O catálogo só tem grama lisa
(`NewStyle_Grass_Green`, um verde-menta chapado), que era o piso de fora.

- **Duas camadas, poucos tiles:**
  - **Piso:** textura sem emenda de 12 × 12 tiles (384 px). Leva um verde de base, marcas de lâmina (ponta clara
    sobre raiz escura, uma por célula de 6 px, sem aglomerar) e manchas de sol e sombra com borda quebrada em
    traços de lâmina.
  - **Camada `decor`, logo acima do piso (a mesma dos brilhos da piscina):** tufos, trevos, flores e pedrinhas. Cada um é um tile transparente que
    não depende de onde está, então poucos tiles cobrem o gramado inteiro sem repetir o desenho. As flores se
    juntam em alguns prados.
- **Paleta:** 7 verdes com variação de matiz (sombras mais frias, luzes mais quentes). Ficam entre os verdes das
  árvores do catálogo, um pouco mais quentes que as copas, para as árvores se destacarem. As flores usam as cores
  da margem do lago.
- **Brisa:** os tufos se inclinam quando uma frente de vento atravessa o gramado na diagonal.
  - Ciclo de 32 quadros de 220 ms, o mesmo quadro da água, então o mapa não redesenha mais vezes.
  - Ida até 2 px, volta com um pequeno recuo, chegada com ±1 quadro de folga por tufo.
  - O primeiro quadro é a pose parada, que é o que vê quem desliga "Disable map animations".
- **Acabamento:**
  - A grama passa 1 a 3 px por cima das pedras do caminho de entrada.
  - O montinho ao pé das árvores do catálogo (aro e contorno, pintados para a grama clara) usa as cores do gramado
    em todas as 60 variantes de árvore desta coleção.
- **Peso medido na entrega do gramado:** piso de 1.216 para 1.408 tiles (PNG de 338 para 379 KB) e a camada de enfeites
  com 160 tiles (PNG de 8,5 KB). São 277 tiles de enfeite em 1.498 de gramado, 157 deles com brisa. A camada ocupa
  menos de 10% das células, então fica no caminho de CPU do motor, que só desenha o que está na tela.
- **Pacotes Mana Seed (estação, amostras):** ficaram só como referência de técnica (base, tufos, flores, manchas). São
  arte de 16 px, que aqui precisaria de 2× e voltaria o serrilhado que a sede evita. A paleta oliva e terrosa
  também briga com os verdes do catálogo e do design system. A amostra não traz grama lisa em variantes
  combináveis, e o leia-me não traz os termos de uso.

## Shaders (efeitos do motor)

Pedido do dono em 20/10/2026: olhar o ambiente e as oportunidades de shader, depois "vamos implementar todos pra gente"
(dream-loop, fluxo Pro). São efeitos do Phaser 4.2 do próprio WorkAdventure, só no gateway local, como os outros patches.

| Efeito | Onde | Quando muda |
|---|---|---|
| Água: refração de 1 px, cáusticas que acompanham a profundidade, brilhos, estrelas de sol, anéis onde as carpas nadam | Lago e canal | No passo das animações de tile (220 ms), só com a água na tela; à noite, sem sol, ficam só os anéis |
| Luz da hora de Brasília: dia, fim de tarde com raios diagonais no piso, anoitecer e noite com luminárias em cone, telas, K da marca e entrada acesos; jardim azul-marinho | Mapa inteiro | Uma vez por minuto, no máximo |
| Vidro: tinta da hora, contorno claro do painel e um brilho que desliza quando a câmera anda | Vidros das paredes | Só com a câmera em movimento |
| Sala trancada vista de fora: blocos de 5 px e vidro fosco turquesa; o nome de quem está dentro some | Salas 01–04, reuniões | Ao trancar e destrancar |
| Reflexo de quem pisa no porcelanato e no granilite | Hall e recepção | Com as pessoas |
| Espelho no vidro: quem e o que está até 80 px na frente de um vidro aparece nele visto do outro lado (quem anda para o vidro mostra o rosto), de pé, tão acima da base quanto está à frente e sempre inteiro dentro do painel, fraco e esfriado; plantas, jardim, totens, luminárias, assentos, estantes, pessoas e pets (20/10/2026: "Vale ter shader de reflexo nesse vidro?", depois "no reflexo tem que ficar de frente... É sempre invertido") | Vidros das fachadas e das salas de equipe | Peças: quando mudam; pessoas e pets: com eles; chave "Reflexos" |
| Sombra no chão: ao pé das paredes, dos móveis e das árvores (longa e para baixo-esquerda no fim de tarde) e sob as pessoas | Mapa inteiro, só o chão | Quando algo é movido; a das pessoas, com elas |
| Rastro de grama pisada, com pegadas alternadas | Gramado | Ao andar, por 3 s |
| Sombras de nuvem | Lado de fora | Andam só para quem está no gramado |
| TV da reunião com o slide do K e luz própria | Reuniões 01 e 02 | Com duas pessoas na sala |
| Vinheta de foco | Mesa em foco | Ao entrar e sair do foco |
| Íris de chegada | Entrada no mapa | Uma vez por página |

**Como funciona:**
- **Cena:** o patch `local-wa/hot-reload/scene-fx.mjs` publica a `GameScene` (`window.__kScene`, evento
  `konclui:scene`) e põe o relógio dos efeitos no mesmo tique das animações de tile (seção no README do `local-wa`).
- **Efeitos:** `theme/fx/fx.mjs` (carregado por `theme/local-dev.html`), com a parte pura em `core.mjs` e o GLSL em
  `shaders.mjs`. São três quads de shader (água e sombra do chão, acima da camada `decor` e abaixo dos móveis; vidro,
  acima de `doors`), um filtro na câmera e uma imagem por TV.
- **Dados do mapa:** `fx.py` grava `dist/fx/` no build: a água parada e os dados de profundidade, a máscara do vidro, as
  máscaras do mapa (lado de fora, parede, piso polido ou vidro da fachada, gramado, água), as paredes para a sombra, o
  slide da TV e o `manifest.json` (39 KB) com as luzes por sprite e a pegada de cada peça colocada. Uma sala sem
  `fx/manifest.json` não recebe efeito.
- **Sombra do chão:** o navegador desenha num canvas fora da tela as paredes e a pegada de cada peça (a de uma peça nova do
  editor é medida na hora), desfoca uma vez e refaz quando algo se move; o quad do chão lê esse campo em faixas.
- **Luzes seguem o editor:** uma luminária movida no editor leva a luz junto, porque as luzes saem das imagens da cena.
- **Espelho no vidro** (`fx.mjs`, `buildMirror`; regras puras em `core.mjs`, seção do espelho):
  - **Por quê:** a versão anterior copiava os pixels da tela, e por isso só mostrava as costas de quem andava para o vidro,
    numa janela de 20 × 28 px que cortava os lados e a cabeça.
  - **Lado oposto:** todo vidro do mapa é visto do sul, então é um espelho numa parede norte.
    - O Woka (folha 3 × 4) troca baixo por cima e vira a imagem; esquerda e direita ficam.
    - O pet usa os próprios clips, por `window.__kPets.mirrors()` (`theme/pets/README.md`): o quadro vem com nome, na
      textura comum `kpet-atlas`, e o pet de lado vira por `mirroredFrame` como as pessoas.
    - Um clipe do pet desenhado só de frente (sentar, deitar, cheirar, olhar: 24 espécies têm algum) reflete as costas
      paradas, `idle-up` (`theme/pets/core.mjs`, `mirrorFrame`). Antes ele refletia o próprio quadro, e o gato sentado de
      costas para o vidro aparecia de frente no reflexo (dono, 21/10/2026).
    - Uma peça, desenhada só de frente, mantém o lado: um espelho de parede não troca leste e oeste. Virá-la era um erro
      que o juiz pegou.
    - Uma peça da marca aparece de costas (`backOf`): abaixo do topo, o logotipo toma a cor do corpo. Antes, o totem
      refletido mostrava o K colado no totem real.
  - **Altura e posição vertical unificada:**
    - Todas as entidades (pessoas, pets e peças) utilizam `core.mirrorFoot(foot, faceFoot) = 2 * faceFoot - foot`:
      - **Pessoas, pets e peças:** a base do reflexo é calculada de forma pura pela óptica da reflexão ($2 \times \text{faceFoot} - \text{foot}$). Quanto mais perto do vidro, mais embaixo na vidraça (os pés tocam a esquadria inferior). Quanto mais longe, mais em cima na vidraça o reflexo sobe. Ao se afastar, a cabeça e o tronco passam naturalmente além da esquadria superior e são recortados pelo topo da janela (`drawMirror`), até restar apenas as pernas e os pés no alto da vidraça antes de sair do alcance ou desaparecer no fade (dono, 21/10/2026: "Quando mais perto, mais embaixo. Quanto mais longe, mais em cima... Até pode ficar só o pézinho lá em cima quando tiver longe").
      - Todas as camadas do avatar (corpo, cabelo, roupas, chapéu, óculos e acessórios) compartilham rigidamente a mesma base vertical calculada (eliminando 100% de separação de roupas).
  - **Desvanecimento com a distância unificado (`core.mirrorAlpha`):**
    - Pessoas, pets e peças compartilham a mesma curva suave e contínua baseada na distância física $d$ por interpolação de Hermite ($0.56 \times (1 - u^2(3 - 2u))$ onde $u = d / 80$): força máxima (0.56) colado ao vidro, modulando visivelmente a opacidade conforme se afasta ($0.53 \rightarrow 0.47 \rightarrow 0.28 \rightarrow 0.09$) e desvanecendo suavemente até 0.0 no limite de 80 px (dono, 21/10/2026: "aqui no reflexo... Tem a questão de opacidade também...").
  - **Camadas:** a película e os montantes ficam por cima de todo reflexo. O recorte também se divide na linha da
    película. O brilho do vidro cai pela metade sobre o reflexo das peças e passa por trás do reflexo das pessoas.
  - **Peças paradas:** ficam num atlas opaco, uma faixa de 64 px por fileira de vidro, com a cor em cima e a intensidade
    embaixo. O próprio quad do vidro, entre a tinta e o brilho, desenha esse atlas, que só é refeito quando as peças
    mudam. Assim o espelho das peças não custa draw call.
  - **Pessoas e pets:** imagens num container logo acima do quad do vidro, cada uma recortada nos painéis que cruza (os
    painéis vêm da `glass.png`, medidos uma vez). Custa um draw call enquanto alguém está na frente de um vidro.
  - **Ordem** (`drawMirror`): no reflexo, o que está mais perto do vidro cobre o que está mais longe.
    - Tudo entra pela distância ao vidro, o mais longe primeiro: as peças no atlas e as imagens no container.
    - Nos painéis por onde passa uma pessoa ou um pet, o quad do vidro não desenha o atlas (`uMirrorLive`, até 8
      painéis). As peças que cruzam esses painéis entram no container, recortadas só neles, na mesma ordem das pessoas.
    - Antes, as peças ficavam sempre por baixo, e pessoas e pets saíam na ordem da lista: o gato atrás do dono aparecia
      na frente dele no reflexo (dono, 21/10/2026). Antes e depois: `reviews/mirror/continuidade-antes-depois.png`.
  - **Medido em 20/10/2026** com `perf.py --gpu --check`, na sala de teste `escritorio-sede-koru`:
    - Com um filtro de máscara no container, o espelho custava de 4 a 6 draw calls (`room-idle` 34 > 30).
    - Recortado, ainda custava 1 (31).
    - Com o atlas: 13 h com `room-idle` 30, igual ao espelho desligado, e `walk` 28; às 21 h, de 28 a 29.
  - **Aprendizados:**
    - No Phaser 4, `setCrop` numa imagem com `flipX` recorta do lado errado: um reflexo dividido por um montante mostrava
      as duas metades de fora. Um quadro espelhado vira textura própria (`mirroredFrame`), e nada recortado é virado.
    - Uma medição noturna saiu com 15 draw calls e vértices pela metade, com a cena incompleta. Repetida, deu 27 a 28: um
      número baixo demais também precisa ser repetido.
    - Erro de continuidade não aparece em teste: os dois que o dono achou em 21/10/2026 (ordem e lado do pet) passaram
      por todos. Desde então toda mudança visual passa pela revisão do Gemini (`continuity_review.py`; `AGENTS.md`,
      Verificação), com as regras da área e os fatos medidos no motor (posição, direção, distância ao vidro, quadro).
      Desde 25/10/2026 o comando é `klaude --model gemini-3.8-flash`.
      O Gemini leu a película ciano como uma linha-guia: o que é intencional vai escrito nas regras.
    - O revisor foi testado contra um controle: as mesmas 12 cenas, com o código antigo servido só no navegador do teste.
      Ele achou 10 dos 11 erros do controle e nenhum no código atual
      (`design/interiors/2026-10-20/glass-mirror/continuity-2026-10-21/`).
- **Uma chave por efeito** (20/10/2026, "deixar mais leve / mais completo"), em Configurações › Desempenho:
  - **Níveis:**
    - Leve: o mapa como a arte foi desenhada, sem nenhum desenho a mais.
    - Equilibrado: luz da hora, sombras, vidros, salas trancadas, TV, vinheta e íris. Ficam de fora a água animada, o
      reflexo, o rastro e as nuvens, que são o que pede redesenho com a sala parada.
    - Completo: tudo, e é o padrão.
  - **Onde fica:** `konclui.fx.features` guarda as chaves no navegador; `window.__kFx.configure()` muda na hora, e outra
    aba do escritório acompanha pelo evento `storage`.
  - **Exceção:** com a luz desligada, o escritório fica nas cores da arte o dia todo. Já a sala trancada esconde o nome
    de quem está dentro mesmo com o efeito embaçado desligado, porque o nome escondido é privacidade, não efeito.

**Regras:**
- **Pixel art:** tudo é calculado em pixels inteiros do mundo, em passos da paleta ou em faixas; nada de degradê liso nem
  pontilhado. A paleta da água com os efeitos é uma graduação mais saturada da `pool.WATER` (constante `WATER_GRADE` em
  `fx.mjs`); sem os efeitos, o lago continua com a paleta aprovada.
- **Redesenho:** nenhum efeito redesenha uma sala parada no próprio relógio; o resto muda por estado (uma marcação de
  redesenho) ou pela câmera.
- **Desligam o movimento:** "Disable map animations", movimento reduzido, economia de bateria e Simplificado. A água volta
  ao piso parado que ela cobre.
- **Desligar tudo:** `localStorage['konclui.fx.off'] = '1'`. **Fixar a hora (QA):** `localStorage['konclui.fx.hour'] = '18.5'`
  ou `window.__kFx.set({ hour: 18.5 })`. **Estado:** `window.__kFx.state()`.
- **Shader que não compila:** o Phaser não avisa e o mapa fica preto. Por isso `fx.mjs` compila os shaders num contexto à
  parte antes de montar e desiste com erro no console; `theme/fx/shaders.test.mjs` procura palavras reservadas do GLSL.

**Desempenho (`perf.py --gpu --check`, 20/10/2026, M1 Max, versão final):**

| Cenário | Sem efeitos | Com efeitos (noite) | Com efeitos (dia) |
|---|---|---|---|
| Hall parado | 4,1 redesenhos/s, 21 chamadas | 4,5/s, 26 | 4,6/s, 25 |
| Lago parado | 4,1/s, 21 | 4,5/s, 26 | 4,6/s, 25 |
| Sala 01 parada | 0,4/s, 22 | 0,4/s, 26 | 0,4/s, 28 |
| Andando | 60/s, 22, 0,9 ms | 60/s, 26, 1,0 ms | 60/s, 28, 1,1 ms |
| Memória | 78 MB | 93 MB | 82 MB |

Todas as metas do `--check` passam (até 0,5 redesenho/s parado numa sala; até 30 chamadas por quadro). Andar redesenha
60 vezes por segundo com ou sem efeitos: é o motor.

Na v1.34.2 (20/10/2026, `reviews/perf/20261020-v1342-dia.json` e `-noite.json`), as metas continuam passando:
- **Dia:** 0,4 redesenho/s na Sala 01, 28 chamadas, 60/s andando, 87 MB.
- **Noite:** 0,4/s, 25 chamadas, 78 MB.

A noite andando deu 17 redesenhos/s duas vezes no `perf.py`. O mesmo roteiro, em script próprio e com as mesmas esperas
longas, deu 60/s nos oito trechos, inclusive com todos os efeitos. A diferença não se reproduziu fora do `perf.py`; fica
anotada para investigar.

**Dream-loop (fluxo Pro):** alvos gerados a partir das capturas do motor, juízes independentes a cada rodada; tudo em
`.dream-loop/shaders/` (fora do Git): `targets/`, `shots/rN/`, `judge/rN-*.md` e `tools/` (captura e rodada).

| Vista | Rodada 1 | Rodada 6 (final) |
|---|---|---|
| Lago de dia | 4,9 | 7,08 |
| Entrada à noite | 4,25 | 7,2 |
| Reunião trancada ao entardecer | 4,3 | 7,55 |
| Gramado com nuvens e rastro | 4,1 | 7,35 |

O laço parou antes do 8 pela regra de estagnação do fluxo: a mudança estrutural (a sombra do chão) não rendeu um ponto
inteiro. O que falta, segundo os juízes, é sobretudo acabamento fino contra detalhes que o modelo de imagem pintou
(sombras desenhadas de móveis, degradês de parede, posição de nuvens e estrelas).

**QA:** `qa.py` roda com os efeitos desligados (`konclui.fx.off`), porque as verificações do gramado e da água leem a
paleta da arte; os efeitos se verificam pelos testes de `theme/fx/`, pelo `perf.py` e pelas capturas.



## Comportamentos

| Comportamento | Como |
|---|---|
| Parede na borda entre dois tiles, os dois caminháveis | Camada `thin-walls` e patch `local-wa/hot-reload/thin-walls.mjs` |
| Sentar ao parar na cadeira, levantar ao andar | `runtime/seating.mjs`: quem chega no ponto já virado para o lado da cadeira senta ali. Senão, um passo exato de um tile atrás do ponto e de volta, sem teleporte, e uma segunda rodada 700 ms depois se não deu certo. Publica `officeSeat` |
| Onde conta como "na cadeira" | Meio tile em volta do ponto, medido pelo corpo do Woka (8 px abaixo da posição); vale também para cadeira movida fora do grid, que senta no ponto alcançável mais próximo (até 8 px) |
| Sofás e bancos | Uma vaga por almofada, com os pontos de sentar do catálogo de origem (`more` no `seats.json`): 22 vagas a mais |
| Pose sentada | A regra da própria origem, lida no cliente e no servidor da reconstrução em `study/gather-project`. Quem senta fica centralizado no tile de sentar. O quadro sentado de 64 px da origem é desenhado 48 px acima desse ponto, com a cabeça na linha 22 (de frente e de lado) ou 27 (de costas, sem pernas). A imagem principal da peça é ordenada pela dobra dela, e a camada da frente (encosto, braço, frente do assento) pela dobra própria; o que fica abaixo do ponto de quem senta é desenhado na frente. Aqui a peça inteira fica atrás, o patch do gateway desenha a camada da frente logo acima de quem senta, e `pose.dy` põe o cabelo do Woka onde está a cabeça da origem: −3 de frente e de lado, +2 de costas, com as pernas escondidas |
| Camada da frente | `dist/seats/front/<peça>.png`: o que a origem desenha na frente de quem senta. É a imagem inteira, quando a dobra principal fica abaixo do ponto de quem senta (por exemplo, a cadeira de escritório vista de costas, onde só a parte de cima da cabeça aparece), ou só os pixels da camada da frente, quando a dobra dela fica abaixo. 1.326 dos 2.139 modelos de assento têm uma. As dobras da camada da frente vêm da exportação do catálogo de 14/10/2026 e ficam em `sources/seat-front-folds.json` |
| Cadeira movida no editor | Parar perto de um assento relê o mapa da sala antes de sentar; e a cada releitura (15 s) quem está sentado acompanha a cadeira movida, ou levanta se ela foi apagada. Quem está em pé relê a cada 60 s, e assim acha uma cadeira nova longe das conhecidas. Cada releitura é um HEAD; o `.wam` só é baixado quando mudou (`runtime/wam.mjs`, 11/11/2026) |
| Portas que abrem ao chegar | Vidro de correr em 5 quadros com `setTiles` |
| Trancar sala, bater, abrir por dentro | Camada oculta por sala e eventos; destranca sozinha ao esvaziar |
| Mesa própria | "ESPAÇO para reservar esta mesa", "Mesa de Fulano", botão "Minha mesa" |
| Jogos e quadro branco | Fliperama, pingue-pongue e sinuca abrem os jogos do campus; o quadro das reuniões abre um Excalidraw por sala |
| Lotação, salas com chamada própria, palco, holofote, cabines silenciosas | Propriedades do `.wam` (chamadas com o prefixo `konclui-sede-`) |
| Acenar e ir até alguém, aplauso e confete | Ações ao clicar numa pessoa e botões de reação |
| Emotes, seguir, localizar, status, busca | Recursos do WorkAdventure |
| Som ambiente que cresce ao chegar perto | Lago e cafeteria, com o volume ideal de cada um, pela página (`theme/hud-audio.js`); botão "Som ambiente: ligado/desligado" (seção abaixo) |
| Sino da venda | Na recepção, à direita do balcão: ESPAÇO toca para todos; venda real pelo serviço `bell`; um cartão por vez no canto do mapa (seção abaixo) |

**Personagens e roupas:** as 3.145 peças coletadas não foram importadas. São quadros de 32×64 com outra anatomia, e o
Woka usa 32×32 em 3 colunas × 4 linhas. Converter exigiria uma família nova de avatar, estimada em 1 a 3 semanas, e
uma decisão de licença antes de publicar. A pesquisa está em `.scratch/avatar-research/`.

## Som ambiente e sino da venda

Pedidos do dono em 20/10/2026 (tabela do topo). Quem faz o quê:
- **Mapa:** `runtime/social.mjs` (ambiente), `runtime/bell.mjs` (sino), `runtime/page.mjs` (o que a página assume) e o
  `build.py`, que gera os dados (`social.json`, `bell.json`) e copia `sale.mp3` e a página do cartão do campus.
- **Página:** `theme/hud-audio.js` (som) e `theme/hud-sale.js` (cartão), ao lado da visão. Contrato de volume e
  protocolo em `theme/README.md`, "Som pela distância".

**Quem toca o ambiente:**
- **Com os scripts da página:** eles respondem ao `hello` do HUD com `feature: 'audio'` e `'sale'`. Daí em diante a
  página toca o ambiente e desenha o cartão; o mapa só manda dados.
- **Sem eles:** tudo segue como antes. O `WA.sound` toca a fonte no volume ideal dentro da área crescida de meia queda,
  porque não consegue mudar o volume de um som tocando. Na chegada, ele espera 4 s pela página antes de tocar.

**Fontes do ambiente** (`social.json`, por `build.py`):

| Fonte | Volume ideal | Área no volume ideal | Ouvida a partir de |
|---|---|---|---|
| `lake.mp3` | 0,22 | A água do lago (37–49 × 24–36) | 6 tiles |
| `coffee.mp3` | 0,18 | Copa e mesas do café, ao norte do lounge e dos jogos (68–79 × 8–29) | 4 tiles |

**Curva:** o ganho é o volume ideal × (1 − distância/queda)². Medido no motor pelo `qa_sound`, com a pessoa parada e
o ganho tocado já assentado:

| Distância da área (tiles) | 6 | 5,5 | 5 | 4 | 3,5 | 3 | 2 | 1 | 0,5 | 0 (dentro) |
|---|---|---|---|---|---|---|---|---|---|---|
| Lago (ideal 0,22) | 0 | 0,0015 | 0,0061 | 0,0244 | 0,0382 | 0,0550 | 0,0977 | 0,1527 | 0,1848 | 0,2199 |
| Cafeteria (ideal 0,18) | 0 | 0 | 0 | 0 | 0,0028 | 0,0112 | 0,0449 | 0,1012 | 0,1377 | 0,1799 |

**Sino da venda** (porte de `map/campus_web/campus.js`):
- **Peça e área:** `'Koncluí: sino da venda'`, um sino de latão com corda vermelha numa estrutura de carvalho. A base
  é a do balcão (tampo de carvalho, frente tinta, filete menta), em `signature.py`. Fica no tile (47, 40), na frente da
  parede de destaque e à direita do balcão, e bloqueia só a base. A área "Sino da venda" (46–48 × 40–42) fica longe da
  cadeira da recepcionista.
- **ESPAÇO toca:** o aviso "ESPAÇO para tocar o sino da venda" ganha a tecla desenhada pelo HUD. Tocar manda
  `sino-da-venda` para todos, e o aviso volta depois de 3 s se a pessoa continuar ali. De um mesmo remetente, conta um
  toque a cada 2,5 s.
- **Venda real:** chega como `venda-nova` do serviço `bell` e só é aceita sem `senderId`. Um jogador pode mandar o
  evento, mas ele não vale.
- **Cartão:** um por vez, numa fila de 10. Uma venda real toma o lugar do toque manual mais antigo, e um toque manual
  com a fila cheia é descartado. Fica 6 s (manual) ou 11 s (venda); o × passa ao próximo.
- **Som:** a coruja `sale.mp3`, em 0,4 nas salas de equipe, nas salas de reunião, nas cabines de foco, no auditório e
  na mesa em foco (`bell.json`, `quiet`), e em 1 no resto. Toca pela página, que obedece a `konclui.sound.bell` e
  `konclui.volume.bell`. Sem a página, toca pelo `WA.sound`.
- **Sem `hud-sale.js`:** o cartão é a página do campus (`pages/sale.html`) num website, como no campus.

## Interface: momento e mapa de pessoas

A interface muda com o que a pessoa está fazendo, e quem está onde fica numa pílula "N no escritório". O mapa só
aparece quando alguém clica nela. Desenho e escolha: opção 11 de `design/ux/2026-10-18-hud-10/index.html`.

| Momento | O que aparece |
|---|---|
| Andando | Chip do lugar ("Estações de trabalho — oeste · 1 por perto"), pílula e o dock: a barra nativa vira uma superfície só, centralizada embaixo, com Aplaudir, Confete e Som ambiente como ícones (o texto continua no botão e vira a dica; o ícone do som mostra ligado ou desligado) |
| Na mesa (cadeira de estação) | Chip "Em foco · 12 min" com "Encerrar foco"; o status vira Ocupado até levantar; a barra fica só com microfone e câmera |
| Em conversa | "Conversa com 1 pessoa · afaste-se para sair" na bolha; "Sala 01 · conversa com 1 pessoa · saia da sala para encerrar" numa sala com chamada |
| Jogando | Só o jogo; chip, pílula e mapa saem, a barra fica com microfone e câmera |

O mapa "Quem está onde" mostra a planta (`dist/planta.webp`, 8 px por tile) com um ponto por pessoa, a lista ordenada
de quem está mais perto, "Ir até" em cada linha e "Ir para minha mesa", que sai da barra e vem para cá. Passar o mouse
numa linha acende o ponto. Esc ou o × fecham e devolvem o foco à pílula. Os avisos de ação ganham a tecla desenhada:
"Sala 02 está trancada [Espaço] Bater"; num celular, a tecla diz "Toque".

**Como funciona:**
- **Controlador** (`runtime/hud.mjs`, núcleo puro em `hud-core.mjs`). Calcula presença, lugar, momento e foco.
- **Visão** (`theme/moment-hud.js` e `.css`). Fica na própria página do WorkAdventure, injetada pelo gateway local
  (`theme/local-dev.html`). Desenha tudo e devolve as ações como pedidos ao controlador.
- **Mensagens entre os dois:** `postMessage` com `{konclui: 'hud', kind}`, sem o campo `type`.
- **Salas sem o protocolo:** a visão fica adormecida, e o `hud.js` continua recolhendo a barra nas bordas.
- **Sem a visão:** nada muda na sede. Os avisos continuam com "ESPAÇO para…", o botão "Minha mesa" fica na barra e o
  status não é tocado.

**Presença:**
- Cada navegador anuncia nome, posição e momento pelo evento de sala `office-presence`: ao chegar, depois de cada
  caminhada, ao mudar de momento e a cada 15 s.
- Quem não se anuncia por 45 s sai da lista.
- `WA.players` só vê quem está perto da tela, então ele apenas atualiza ao vivo a posição dos vizinhos.
- Nada é guardado: não há variável, histórico nem registro por pessoa.

**Lugar:**
- O nome vem da menor área com nome do `.wam` servido, relido a cada minuto.
- Fora das áreas e dentro do prédio, é "Hall". A área de chegada é "Entrada". Fora do prédio, é "Área externa".

## Interface no estilo do escritório de referência (sala de teste)

Pedido do dono em 18/10/2026: "Olha como funciona a UI do Gather pra gente fazer igual". Só a sala de trabalho
`konclui-office` (e a `escritorio-sede-hud`, seu nome anterior e o da sala de produção) liga esse layout (trava por
caminho em `theme/moment-hud.js`). As outras salas seguem com a
interface por momento acima. Tarefas, donos e evidências: `reviews/hud/source-layout/TAREFAS.md`.

| Parte | O que faz |
|---|---|
| Trilho à esquerda | Pesquisar pessoas (⌘K ou Ctrl+K), Pessoas (abre e recolhe o painel) e Conversa (abre e fecha o chat do WA no lugar do painel, no mesmo cartão e com o mesmo botão de recolher). Se o WA abre o chat sozinho numa conversa, o painel de pessoas volta quando ele fecha |
| Painel de pessoas | "Koncluí", onde você está, busca (digitar nela não anda o boneco), "Online (n)" com você no topo e os outros do mais perto ao mais longe; clicar numa linha leva até a pessoa; "Ver no mapa" |
| Mapa num cartão | O jogo fica num cartão arredondado ao lado do painel; o patch `game-inset` do gateway faz o WA medir o cartão, então o boneco fica no centro dele |
| Dock | Você (avatar numa bolinha com o status no canto), microfone, câmera, reação e conversa, numa linha de vidro de 48 px, cada controle num fundo próprio, 6 px entre todos; desligados levam o traço vermelho do Gather; a seta da mídia fica na ponta do microfone. Todo botão tem 36 px e todo ícone 18 px com o mesmo traço, inclusive os que o WA acrescenta numa conversa (compartilhar tela, imagem sobre imagem, seguir, trancar, levantar a mão); a seta das configurações de mídia vira a ponta do botão do microfone. O botão "Mapa" do WA saiu |
| Menu de reações | As seis reações com nome e tecla, a seção "No escritório" (Aplaudir, Confete, Som ambiente, Trancar sala dentro de uma sala) e Falar ou Pensar |
| Barra da direita | Como no Gather, 30 px, 8 px dentro do canto do cartão: Ir para minha mesa (desabilitado sem mesa ou já nela), Centralizar em mim (só aparece com a câmera fora de você ou fora do zoom padrão, e volta os dois), zoom, explorar e "⋯" |
| Seu cartão | O avatar do dock abre o cartão do Gather: nome, status (Disponível, Ocupado, Ausente), editar nome, câmera e microfone, configurações, editor do mapa e mensagem para todos (o menu do WA fica escondido e cada botão aperta o item dele) |
| Mesas | Passar o mouse sobre uma mesa desenha o contorno e diz "Mesa não reivindicada", "Mesa de Fulano" ou "Sua mesa" (patch `tile-hover`); sentado numa mesa livre, "Mover mesa para cá" (ou "Reivindicar mesa") e o Espaço fazem o mesmo |
| Editor de mapa | Barra de ferramentas e barra lateral no padrão do HUD; o cartão da peça escolhida fica dentro da barra |
| Menu do K | O K do trilho abre o menu completo do WA (status, perfil, configurações, ferramentas) como a sidebar do `konclui-platform` |
| Arrastar o mapa | Arrastar o chão move a câmera sem andar (patches `tile-hover` e `tile-click`, trava `data-k-drag-pan`); andar ou "Centralizar em mim" traz a câmera de volta |
| Emotes | 26 emotes estilo Ragnarok com a arte CC0 do Kenney (`office/sources/emotes/kenney/`), na grade do menu de reações e por comando no chat (`/lv`, `/heh`, `/!`...); o patch `custom-emotes` desenha sobre o boneco para todos (trava `data-k-emotes`) |
| "⋯" | Simplificado (a planta com as pessoas no lugar do mapa ao vivo), Imersivo e Automático; a escolha fica no navegador |
| Economia (Automático) | Bateria fraca fora da tomada: movimento desligado, quadros limitados a 20 por segundo (patch `frame-cap`) e o aviso "Bateria fraca" com "Restaurar todos os recursos" e "Ignorar"; na tomada, "Carregando". O Simplificado limita a 8 |
| Modo leve (Automático, 11/11/2026) | Computador que não dá conta de desenhar o escritório: se mais da metade dos quadros de uma janela de 12 s passar de 45 ms (medido na própria página, em primeiro plano, depois de 20 s de carga), entra a mesma economia, com o aviso "Modo leve". O resultado vale 7 dias: as próximas visitas já começam leves. "Restaurar todos os recursos" desliga a vigilância por 7 dias. Não é o gatilho de pressão de CPU retirado em 18/10/2026, que disparava em qualquer máquina ocupada: este lê os quadros do escritório. Navegadores automatizados ficam de fora. Enquanto a economia dura (bateria ou lentidão), as chamadas também ficam leves: vídeo em "low" e supressão de ruído do navegador no lugar da do WorkAdventure (−31 % de CPU do renderizador numa bolha de 4, medido em 11/11/2026); o ajuste anterior volta ao restaurar |
| Minimapa | Canto inferior esquerdo, com você, as pessoas e "Sua mesa" (vai até a sua mesa); clicar abre o mapa |
| Clique num bloco | Um clique esquerdo marca o bloco com cantoneiras e "Clique duas vezes para mover para cá"; o duplo anda até lá (patch `tile-click`, ativo só com `data-k-tile-pick`). A marca fica no bloco enquanto a câmera anda e some quando ele sai do cartão. O clique direito continua andando na hora |
| Foco | O anel de foco só aparece no uso pelo teclado (depois de Tab ou ⌘K), em todas as salas; um clique não desenha anel nem borda |

Em celular (menos de 768 px), o trilho e o dock somem e a pílula de pessoas abre o painel como uma folha.

**Verificação:** `python3 hq-office/qa_hud.py` (sala `konclui-office`). As
checagens `layout`, `search`, `dock-order`, `reactions`, `minimap`, `modes` e `saver` são do layout novo e dão SKIP
na sede; `dock`, `map` e `goto` só valem na sede. Os visitantes do QA entram ligados na tomada, e só o `saver`
simula bateria fraca: sem isso, o aviso seguia a bateria real da máquina. O `slow` entra como navegador de pessoa numa
máquina que leva 70 ms por quadro e confere o aviso, a lembrança na visita seguinte e o fim da vigilância depois de
"Restaurar". O `others` abre a raiz do WA local e espera outra sala: falha quando `START_MAP` aponta para a própria
`konclui-office` (visto em 11/11/2026).

## Desempenho

`python3 hq-office/perf.py --gpu [--url …] [--label …] [--check]` mede a sala com um visitante sem janela. Rode com a
máquina quieta, sem outro teste de navegador.
- **O que conta:** chamadas de desenho do WebGL por quadro, nos cenários parado no hall, parado no lago, parado dentro
  da Sala 01 e andando.
- **Saídas:** quadros desenhados por segundo, chamadas e vértices por quadro e tempo por quadro, em
  `reviews/perf/<label>.json`.
- **Metas do `--check`:** só contadores determinísticos. Dentro de uma sala, parado, até 0,5 redesenho por segundo; até
  30 chamadas e 8.000 vértices por quadro.

**Medido em 18/10/2026, Chromium com a GPU do Mac (M1 Max):**
- Andando, cerca de 1 ms por quadro e 60 quadros por segundo.
- 17 a 22 chamadas de desenho por quadro e 69 a 73 MB de memória.
- O custo que sobra é o redesenho com a sala parada.

O que a pesquisa (documentação do Phaser 4 e discussões) e as medições mostraram:
- O Phaser desenha todo quadro, e quem economiza é o WorkAdventure, que só redesenha quando algo mudou.
- O motor redesenhava a sala inteira no ritmo do tile animado mais rápido do mapa (220 ms), mesmo sem nada animado na
  tela.
- O Phaser só deixa de desenhar o que está fora da câmera no caso dos tiles; os cerca de 600 objetos entram em todo
  quadro desenhado, mas nessa escala custam pouco.
- O Phaser 4 agrupa as cerca de 200 texturas dos objetos, então chamadas de desenho não são gargalo.

| Variante | Hipótese | Antes → depois | Correção | Decisão |
|---|---|---|---|---|
| Colisão em opacidade 0 | 723 tiles transparentes desenhados a cada quadro | 5.692 → 4.468 vértices (−21%); tempo dentro do ruído | Paredes 4/4, paredes finas 5/5, portas 5/5 | Mantida (`build.py`) |
| Sem animação de tiles (diagnóstico) | A animação explica o redesenho parado | 4,5 → 0 redesenhos/s parado | Muda o visual | Descartada |
| Redesenhar só com animação na tela | Animação fora da tela não deveria redesenhar | 4,5 → 4,5 | — | Substituída: o piso é `TilemapGPULayer` e caía no recuo; e há grama animada à vista de quase todo ponto |
| Redesenhar só quando um tile animado visível troca de imagem, incluindo camadas de GPU | A grama fica parada a maior parte do ciclo de 7 s | Sala 01: 4,5 → 2,0/s (−56%); lago 4,5 → 4,5 | Animação visível igual; teste da brisa do gramado e QA completo passaram | Mantida (patch `anim-in-view` do gateway local) |
| Uma imagem para todas as cópias "sobre móvel" de uma peça (20/10/2026) | O motor guarda as texturas pela `imagePath`, e cada profundidade de uma peça sobre móvel tinha um arquivo idêntico com outro nome: 245 texturas, 28 delas repetidas | 245 → 218 texturas; hall, lago e sala de jogos parados −1 chamada (27 → 26, 30 → 29) | Visão da Sala 01 igual pixel a pixel; QA completo passou; o build recusa duas imagens diferentes no mesmo caminho | Mantida (`build.py`, `on_surface` e `write_collection`) |
| Rajadas da brisa juntas e espaçadas (dono, 19/10/2026) | Tufos trocando de imagem em instantes diferentes somam 2 a 3 redesenhos/s onde a grama aparece | Sala 01 parada: 3,2-3,9 → **0,5 redesenho/s** medido em 28 s (dois ciclos), meta 0,5 cumprida; hall e lago seguem em ~4/s pela água (sem meta) | Visual: uma rajada a cada 14 s em vez da onda diagonal | Mantida (`lawn.py`); `perf.py` passa a observar 28 s por padrão (10 s, menos que um ciclo, pega a rajada ou não: 1,0/s numa janela, 0,5/s em duas voltas) |

Não adotadas, por não haver gargalo medido que as justifique:
- **Camadas de GPU do Phaser 4 (`TilemapGPULayer` para todas as camadas, `SpriteGPULayer`):** exigiriam mexer na
  criação de camadas do WorkAdventure e deixariam a `SpriteGPULayer` numa profundidade só.
- **Atlas de texturas para os objetos:** as chamadas de desenho já são poucas.
- **"Assar" o conteúdo estático numa imagem:** tiraria a edição pelo editor, e a medição de energia do próprio
  WorkAdventure não mostrou ganho de bateria.

Próximo ganho possível, ainda não feito:
- **Sincronizar as rajadas da brisa:** todos os tipos de tufo trocariam de imagem nos mesmos instantes. Hoje cada tipo
  troca em momentos diferentes, e a soma dá 2 a 3 redesenhos por segundo onde a grama está à vista.
- **Por quê:** o WorkAdventure mediu animações dessincronizadas em +30% de energia e sincronizadas em +13%.
- **De quem é:** decisão de quem desenha o gramado.

## Evidência

O QA roda o Chromium sem GPU, a 3–7 quadros por segundo. Por isso a direção ao sentar é medida à parte, e testes de
movimento seguram a tecla até concluir.

**Verificado em 18/10/2026, antes da renomeação (sala com o nome antigo):**
- **Testes:** runtime 8/8, carpas 13/13, gateway 21/21.
- **Build:** 0 erros.
- **Motor:**
  - Faces 4/4, paredes finas 5/5 e portas por pathfinding 5/5.
  - Assentos: 14 tipos sentam no ponto e levantam.
  - Carpas e interações OK.
  - Social: OK na rodada isolada. Na rodada longa, "destrancada passa" falhou por lentidão do navegador; o teste foi
    corrigido para segurar a tecla até atravessar.

**Depois da renomeação, dos objetos das mesas e da decoração**, os resultados estão em `reviews/engine/summary.json`.

**Regra de sentar da origem, verificada em 18/10/2026 na `escritorio-sede`:**
- **Testes:** runtime 33/33 e gateway 36/36.
- **`qa.py`:** saída 0; todos os grupos passaram.
- **Folha por tipo:** 22/22 tipos sentam no ponto e na direção certa.
- **Protótipo e motor contra o print do original:** a cadeira de mesa vista de costas mostra só a parte de cima da cabeça
  acima do encosto, com a cadeira inteira na frente.

**Assentos, verificados em 18/10/2026 na `escritorio-sede`, na versão da dobra cortando a peça** (substituída depois pela
regra da origem; almofadas e cadeiras movidas no editor valem para as duas):
- **Testes:** runtime 33/33 (assento pela caixa do corpo, ponto alcançável, almofadas, `posePayload`, `reseat`) e
  gateway 36/36 (números do assento, camada da frente carregada, desenhada e removida, recusa de PNG de outra origem).
- **`qa.py`:** saída 0. Todos os grupos passaram: paredes, paredes finas, portas, assentos, carpas, interações e social.
- **Folhas de contato** em `reviews/seats/`:
  - por tipo: 22/22 tipos, inclusive as almofadas laterais;
  - todas as vagas: 212/213 sentaram no ponto e na direção certa. A que faltou estava ocupada pelo dono, e o runtime
    recusou como deve.
- **Casos do dono reproduzidos andando:**
  - parar na almofada lateral do sofá: sentou na vaga dela;
  - setas até a cadeira de reunião movida fora do grid: sentou, 6 px abaixo do ponto (o lugar alcançável mais
    próximo).
- **Cadeira movida com alguém sentado** (sala descartável, apagada depois):
  - 14 px para cima: quem estava sentado acompanhou, e o avatar desenhado andou exatamente 14 px;
  - 14 px para dentro do balcão: o lugar novo não é alcançável, e a pessoa levantou.

**Quadros da marca, verificados em 18/10/2026 na `escritorio-sede-hud`:**
- **Build:** 0 erros. 575 peças (8 novas, 8 quadros genéricos substituídos) e 123 peças na coleção "Koncluí".
- **Carga com o `.wam` do build:** antes, o `.wam` servido foi conferido. Nada tinha sido adicionado pelo editor, e as 9
  mudanças no lugar eram desta entrega. Uma cópia do servido ficou em `.scratch/hq-office/backup/`. Depois da carga,
  `.tmj` e `.wam` servidos são iguais aos do build.
- **`qa.py --only views`:** carregou com os 213 assentos e capturou as vistas de cada sala, com os quadros no motor
  (`reviews/engine/view-*.png`).
- **Imagens:** `reviews/frames/paredes.png` (cada parede na prévia) e `motor-recepcao.png`.
- **Primeiras tentativas descartadas:**
  - Uma cozinha detalhada virou borrão a 42×28, e foi trocada por uma composição de pôster.
  - A Koru comemorando oficial, de asas abertas, ficava miúda no retrato estreito do auditório, e foi gerada de novo
    na vertical.

**Sistema óptico da flora, verificado em 18/10/2026 na `escritorio-sede-hud`:**
- **`flora_optics.py`:** passa com a flora atual e reprova a anterior (11 problemas).
- **Build:** 0 erros.
- **Carga:** `.tmj` servido igual ao do build; `.wam` do servidor intacto (567 peças nas mesmas posições).
- **`qa.py --only koi,water`:** carpas nas duas sobreposições (2.273 e 494 px) e 80 tiles animados sobre a água.
- **Imagens:** `reviews/pool/optica-fileira.png` (antes em cima, depois embaixo, todos na mesma linha de âncora) e
  `optica-lago.png`.

**Piscina e canal, verificados em 18/10/2026 na `escritorio-sede-hud`.** Antes de carregar, o `.wam` servido tinha duas
Equináceas apagadas no editor (`lawn/flowers0` e o espelho). Elas foram para `editor-edits.json` como
`{"deleted": true}`, e o build passou a ter as mesmas 567 peças nas mesmas posições. A sala foi carregada com
`--preserve-wam`, e o `.wam` do servidor ficou byte a byte igual.
- **Build:** 0 erros.
  - Piso com 544 tiles, 7 deles animados (o chafariz).
  - 83 tiles de brilho e ondinha sobre a água, todos com o quadro 0 vazio.
- **Carga:** o `.tmj` servido é igual ao do build.
- **`qa.py --only koi,lawn,water`:**
  - **Carpas:** as duas sobreposições pintam peixes (2.094 e 679 px).
  - **Água:** 83 tiles animados da camada `decor` sobre a água.
  - **Gramado:** brisa isolada em 11 de 27 pares, sem nenhuma outra mudança na tela.
- **`qa.py --only walls,views`:** paredes 4/4.
- **Primeira rodada interrompida:** a rodada com todos os grupos juntos parou num `page.screenshot` que passou de 30 s
  (Chromium sem GPU). Rodados em separado, todos os grupos passaram.
- **Imagens:** `reviews/pool/antes-depois.png`, `canal-4x.png`, `motor-fonte.png` e `agua-no-motor.gif`.

**Gramado, verificado em 18/10/2026 na `escritorio-sede-hud`.** A sala foi carregada com `--preserve-wam`, depois
de conferir que o `.wam` servido era igual ao do build; o `.wam` do servidor ficou byte a byte igual. A
`escritorio-sede` não foi recarregada.
- **Build:** 0 erros. 1.498 tiles de gramado, 277 com enfeite e 157 com brisa.
- **Carga:** o `.tmj` servido é igual ao do build.
- **`qa.py --only lawn`:**
  - A camada `lawn` (hoje `decor`) fica entre `floor` e `walls`, e o quadro mais curto do mapa continua em 220 ms.
  - O visitante ficou parado no gramado oeste. Em 18 pares de quadros sem nenhuma outra mudança na tela, 4 tiveram
    grama mudando (50 a 73 px, as pontas dos tufos).
- **`qa.py --only walls`:** 4/4, inclusive a fachada sul vista do gramado.
- **Imagens:** `reviews/lawn/antes-depois.png`, `detalhe-2x.png` e `brisa-no-motor.gif` (captura do motor).
- **Console:** 3 erros, nenhum do gramado.
  - Dois são a coleção padrão do WA local: ela pede `map-storageassets/...`, sem a barra, e recebe 404.
  - O terceiro é o aviso do WA de que a sala carrega um mapa local.

**Interface, verificada em 18/10/2026 na `escritorio-sede`** (`qa_hud.py`, dois visitantes, câmera e microfone
bloqueados):
- **Resultado:** 11/11 verificações, sem erro do código novo no console. Detalhe em `reviews/hud/summary.json`.
- **Presença:** o colega no café, fora do alcance de `WA.players`, foi contado.
- **"Ir até":** levou até o colega e avisou "Você está perto de QA Colega".
- **Teclado:**
  - Enter abre o mapa com o foco dentro, sem abrir o balão de fala do WorkAdventure.
  - Esc fecha e devolve o foco.
  - As setas andam depois do clique na pílula.
- **Foco na mesa:** o status foi "Busy" no perfil e voltou a "Online" ao encerrar e ao levantar. O colega viu
  "em foco" na lista.
- **Conversa:** passou na bolha e na Sala 01.
- **Jogo:** a interface saiu e voltou ao fechar.
- **Celular:** a 390 px, chip e pílula sem sobreposição e o mapa dentro da tela.
- **Outras salas:** a sala padrão ficou com o HUD nativo recolhido.
- **Testes:**
  - `runtime/*.test.mjs` 31/31 e carpas 13/13.
  - `tests/test_hud.py` 12/12.
  - `local-wa/check_hud.py` passou na `escritorio-pixel`.
- **`qa.py` depois da mudança:**
  - Portas, carpas, interações e social passaram.
  - Um assento falhou por rodada, e um diferente em cada uma (parou um tile antes): é a instabilidade de `moveTo` sem
    GPU registrada abaixo, num código que esta mudança não tocou.

**Som ambiente e sino, verificados em 20/10/2026 na `escritorio-sede-sino`** (sala local própria, build em
`/tmp/hq-sino-dist`; `qa_sound.py`, dois visitantes, câmera e microfone bloqueados, autoplay liberado no Chromium):
- **Resultado:** 8/8 grupos. Detalhe e série da caminhada em `reviews/sound/summary.json`.
- **Curva:** 32 pontos em passos de meio tile, todos sobre a fórmula (tabela na seção Som ambiente). Na caminhada da
  recepção até a margem do lago e de volta (92 leituras a cada 150 ms), o ganho foi de 0 a 0,22 e voltou a 0, com
  o maior salto entre duas leituras de 0,047.
- **Contrato de volume:**
  - 0,5 deu 0,0924 para 0,1849, ao vivo, com o evento `konclui:volume`;
  - 0 calou, e a fonte parou em até 5 s;
  - outra aba, com 0,25, chegou pelo evento `storage`;
  - o botão "Som ambiente" desligou e religou.
- **Sino:**
  - o aviso ganha "[Espaço] Tocar o sino da venda";
  - tocado na recepção, mostra o cartão dourado para os dois e toca a coruja em 1;
  - com quem ouve na Sala 01, a coruja toca em 0,4;
  - com `konclui.sound.bell` em `off`, o cartão aparece sem som;
  - o cartão fica abaixo dos avisos de área do WA, sem sobreposição.
- **Fila:** três toques do colega, a 3 s um do outro, enquanto o cartão de quem tocou estava aberto. A fila teve 2
  em espera, havia 1 cartão no DOM e o × passou ao próximo.
- **Venda:** a venda sem remetente mostrou o cartão verde com "R$ 1.890", cliente, "Campinas, SP · Plano Pro",
  "Vendido por Bia Souza, squad Alfa" e 17:42. A renovação mostrou o cartão ciano. As duas forjas, o broadcast de outro
  visitante e o `senderId` na borda do iframe, não mostraram nada.
- **Recuo:** sem `hud-audio.js` e `hud-sale.js`, o cartão abriu a página do campus num website.
- **Capturas:** `reviews/sound/bell-prompt.png`, `bell-card.png`, `bell-queue.png`, `sale-card.png`,
  `renewal-card.png` e `fallback-card.png`.
- **Regressão:**
  - `qa.py` passou inteiro na mesma sala (`reviews/engine/summary.json`).
  - `qa_hud.py`: 11 de 12 checagens da interface por momento. A que falhou, `dock`, espera o rótulo "Share" do WA, e o
    navegador do QA agora fala português ("Compartilhar"); o resto dela passou, inclusive o botão do som.
  - `tests/theme_preview.py --check`: uma falha de contraste no ícone do chat do `theme.css`, que esta mudança não toca.

## Aprendizados

| Problema | Causa | Solução |
|---|---|---|
| A revisão de continuidade chamava `agy` (25/10/2026) | O `agy` era o Antigravity, desinstalado, e a função do `~/.zshrc` saiu com ele. O `klaude` ainda imprime `unrecognized_model` antes do JSON para o alias, e `--add-dir` engole o prompt se ele for o argumento seguinte | `continuity_review.py` chama `klaude -p`, depois cada `--add-dir`, depois `--model gemini-3.8-flash` (alias do proxy; o backend é `gemini-3.8-flash-high`), só com a ferramenta Read. Vale o último objeto `type: result`; saída 2 se ele não vier. Em 25/10/2026 o alias devolveu `structured_output` com `modelUsage` `gemini-3.8-flash`, e a leitura de um PNG de um pixel vermelho devolveu `color: red`, sem `permission_denials`. Oito testes em `test_continuity_review.py` |
| O mapa do cartão continuava dimensionado pela janela (23/10/2026) | `CoWebsiteStore.windowSize` e o fallback de `canvasSize` usavam `innerWidth/innerHeight`, apesar das margens CSS do cartão; a página já dispara `resize` quando o layout muda | A fonte nativa lê `--k-game-inset-x/y` na inicialização e a cada `resize`, e usa o tamanho ajustado no canvas; valores ausentes ou zero mantêm a janela inteira. Os 12 testes de referência do gateway e a checagem direta do helper nativo passaram; a paridade no navegador continua pendente |
| Os efeitos e as Configurações dependiam dos patches do gateway (23/10/2026) | `theme/fx/fx.mjs` recebe `GameScene` por `konclui:scene`, e o HUD lê 6 serviços e 37 stores em `window.__kWa` | A fonte nativa anuncia a cena e divide o redraw em `SceneFx.ts`; `svelte.ts` publica a ponte via `NativeWaBridge.ts` após o mount. Checks diretos dos helpers e testes de referência passaram; build e navegador nativos continuam pendentes |
| Sala sem shaders com o servidor certo (22/10/2026) | O navegador guardou como `immutable` os bundles sem patch, servidos pelo `play` direto numa janela sem gateway; sem o `scene-fx` não há `window.__kScene` | `local-wa/README.md`, "Cache do navegador no gateway": fallback do `play` com `no-cache`, `python3 local-wa/check_gateway.py` no `./dev.sh` e a cura de um navegador já preso. Na produção, as mesmas defesas desde 24/10/2026 (mesma seção, "Produção") |
| Captura de dream-loop fora de `escritorio-sede-hud` com outro enquadramento (20/10/2026) | `theme/moment-hud.js` só põe o mapa no cartão (1078×888, zoom 1,5) na sala de trabalho; nas outras o canvas ocupa a janela, com outro zoom, e a câmera para na borda leste do mapa | `.dream-loop/jogos/tools/capture.py` trava a câmera no ponto com zoom 1,5 e recorta o quadro de 1078×888 pela vista da câmera (`onCameraUpdate`), não pelo centro do canvas |
| Avatar das capturas mudou entre rodadas (20/10/2026) | A lista local de wokas (`admin-api/woka.json`) trocou a primeira opção | A captura fixa `localStorage.characterTextures = ['male1']` e pula a tela do woka |
| ESPAÇO num terminal ao lado de outro abria o jogo errado (20/10/2026) | `spotAt` devolvia o primeiro retângulo da lista, e o retângulo vinha da tela inteira do sprite (os 29 px transparentes de cima de um fliperama) | O objeto mais próximo vence; retângulo pelo desenho (`getbbox`); a ordem de `GAMES` só desempata |
| Letreiro neon escondido atrás do painel (20/10/2026) | A imagem do letreiro termina acima da do painel, então a linha de ordem dele ficava antes | `depthOffset` que põe a linha logo depois da do painel |
| Luz da luminária de arco saindo da base (20/10/2026) | A medida de pendente pegava a última fileira larga, e a base também é larga | A luz sai da primeira sequência de fileiras largas de cima (a cúpula) |
| Lounge somando 4 chamadas de desenho por quadro (20/10/2026) | Cada objeto sobre um móvel vira uma textura (e uma cópia "sobre móvel" por profundidade); o motor desenha todos os objetos em todo quadro | Peças vestidas: o móvel leva o que está sobre ele na própria imagem; medir contra uma base construída do mesmo código sem a mudança, porque a base muda com as outras frentes |
| Mapa preto possível em GPUs com menos de 233 vetores de uniform (20/10/2026, plano `plans/decor/001`) | O filtro da câmera declarava 233 vetores; o teste só compilava cada shader, e um estouro só aparece ao ligar | O teste compila e liga com um vertex shader de prova; rastro com 32 passos de 9 px; tons emissivos numa tabela de 4: 197 vetores, guardados em até 212 por `shaders.test.mjs` |
| Configurações vazias no navegador do dono (20/10/2026) | O HUD achava os itens do menu do WA pelo rótulo em inglês; num navegador em português o WA fala português, e o QA rodava em inglês | Itens pelo rótulo em inglês ou português (`WA_LABELS`) e o `qa_hud` com o navegador em pt-BR |
| Vidro da fachada sul opaco (20/10/2026) | Só a fachada norte tinha gramado sob o vidro; na sul, o piso claro do saguão tingido virava uma faixa azul lisa | As duas fachadas de vidro levam o gramado por baixo; a porta continua com o piso do saguão |
| Câmera crescendo sozinha ao andar (20/10/2026) | A linha de câmeras do WA tem tamanho próprio e ignora o arrasto da grade | O arrasto que encolhe vira limite da linha até a conversa acabar |
| Computador "caindo" da mesa | Alinhava o recorte; o catálogo posiciona pela origem e trata objetos apoiados como filhos | `on()` com base na faixa do tampo, calibrada no layout real |
| Item apoiado por baixo do móvel | O motor só ordena pela linha de base + `depthOffset` | Variante "sobre móvel" com a linha logo acima da do pai |
| Avatar sentado virado errado | Passo de acomodação saindo do centro do tile; teleporte vira o avatar para baixo | Passo exato de um tile atrás, sem teleporte, e segunda rodada se a direção não bater |
| QA oscilando | Headless a poucos quadros transforma `moveTo` em salto | Direção medida à parte e testes que esperam o movimento terminar |
| Prévia com 64×64 px | A variável `frames` foi reutilizada no bloco das portas | Renomeada para `door_frames` |
| Filtro da marca removia peças comuns | Nomes duplicados levam um sufixo com a origem | Checar a marca só depois de tirar o sufixo |
| Avatar "sentado no chão" atrás do sofá, depois "em cima" dele | O importador junta a peça e a camada da frente (o encosto) numa imagem só e a desenhava inteira sobre quem senta de costas: o assento escondia o avatar. Subir o ponto só trocou um erro pelo outro | Desenhar a peça atrás do avatar e pôr o ponto onde o corte da pose termina no topo do encosto, medido na camada da frente; a pose não desce o corpo de costas |
| Avatar "amputado", depois baixo demais, e cadeira "flutuando" | Sem quadro sentado, a pose cortava e descia um valor fixo para todo assento; e com a peça numa imagem só, a cadeira ficava inteira atrás ou inteira na frente do corpo | Copiar a origem: peça atrás, camada da frente por cima (desenhada pelo patch enquanto a pessoa senta) e quadril no meio do tile de sentar, por peça; protótipos fora do jogo com o quadro real do Woka antes de mudar o motor |
| Encosto "cortando" o corpo, depois o corpo inteiro por cima da cadeira | Duas regras inventadas: o encosto inteiro na frente com a pessoa alta demais, e depois a peça cortada na dobra. Na origem a dobra não corta a imagem: é a linha pela qual a imagem inteira entra na ordem de desenho | Ler o código da origem (cliente: ordem das camadas; servidor: pessoa no meio do tile; quadros sentados) e copiar a conta, com protótipo contra o print do original antes de mudar o mapa |
| Avatar 14 px acima depois de mover a cadeira | O runtime relia o mapa a cada 15 s e não reposicionava quem já estava sentado | Releitura ao parar perto de um assento e acompanhamento da cadeira a cada releitura |
| "Não está sentando" na almofada lateral do sofá | O importador guardava só o ponto do meio do sofá | Cada ponto de sentar do catálogo vira uma vaga |
| "Não está sentando" na cadeira de reunião | O tile da pessoa vinha do centro do sprite, 8 px acima do corpo; e a cadeira movida no editor deixou o ponto onde o `moveTo` não para | Caixa de meio tile em volta do ponto, pelo corpo; caminhada até o ponto alcançável mais próximo |
| Um build desfez edições do dono no editor | `load_map.sh` troca a sala inteira e a diferença não foi conferida antes | `editor-edits.json` e a regra de comparar antes de carregar |
| Cadeira das cabines não sentava: a de cima em toda rodada do QA, a de baixo em 5 de 12 depois que as cabines ficaram com dois tiles | A falha só aparecia quando o passo de acomodação saía da cabine (área de uma pessoa por vez) e voltava logo: o `moveTo` de volta parava no tile vizinho. A grade estática estava livre e uma sessão nova achava o caminho. Causa provável, não provada: por um instante a área ainda conta quem saiu e vira parede para essa pessoa | Sem acomodação quando a caminhada já termina no ponto, virada para o lado da cadeira; na segunda rodada, 700 ms fora antes de voltar. Medido: 24 de 24, de frente e de lado |
| Edições do dono chegando durante o trabalho (peças, áreas e peças sobre móveis) | A comparação era manual e só cobria a posição das peças do plano | `capture_edits.py` grava peças, criações, áreas e peças sobre móveis; carregar só o script com `--preserve-wam` |
| QA "sala destrancada passa" só falhava na rodada longa | O grupo anterior fechava o jogo com Escape, que fica dentro do jogo: o modal seguia aberto e as setas iam para o Tetris | O QA fecha pelo X (`closeModal`) e confere que fechou |
| A interface numa janela própria (`WA.ui.website.open`) prendia o teclado | Depois de um clique no iframe, o foco fica nele e as setas não andam (medido 18/10) | A visão fica na página do WorkAdventure; um botão ali deixa as setas funcionando |
| Cada mensagem ao WorkAdventure gerava "Invalid event" no console | O ouvinte do WorkAdventure valida toda mensagem com campo `type` | O protocolo usa `kind`, sem `type` |
| Enter na pílula abria o balão de fala | O WorkAdventure abre o balão no `keyup` do Enter, e o `keyup` caía no mapa recém-aberto | A visão engole Enter e Espaço em todo o seu layer (`keydown`, `keypress`, `keyup`), registrada ao carregar |
| A conversa numa sala com chamada não terminava | O WorkAdventure não avisa a saída de um participante numa área de chamada; na bolha, avisa | Na sala, a conversa conta quem está na mesma área pela presença |
| "Ir até" sem resposta | `moveTo` rejeita com "No path found" quando o alvo está num tile bloqueado, e o erro era engolido | Tenta os tiles vizinhos e o mapa diz "Indo até…", "Você está perto de…" ou "Não há caminho até… daqui" |
| QA lia a barra visível em modo foco | Os grupos da barra têm `transition-all` de 150 ms, e `visibility` só muda no fim | O QA espera a transição antes de ler |
| O dock crescia 22 px por quadro, sem parar | O WA grava a largura livre da linha da barra no `min-width`/`max-width` inline da metade direita; com a linha do tamanho do conteúdo, cada conta realimentava a seguinte | A linha mantém a largura nativa e centraliza; as duas metades viram a superfície, e o CSS anula a largura inline da metade direita |
| O dock pegava a metade errada | O WA troca `flex-1` e `flex-none` nessas metades conforme a largura | As metades são escolhidas por posição (primeiro e último filho) |
| O QA da mesa via "Reservar esta mesa" depois de levantar | O teste levantava andando 4 tiles para baixo, onde fica a cadeira livre da fileira seguinte, e o boneco sentava de novo | O QA levanta pelo corredor da ala e confere que o status volta a Online |
| QA travado por meia hora | `moveTo` e outras promessas do WA não têm limite de tempo | O QA limita cada chamada ao script em 60 s |
| "Espaço · Reservar esta mesa" ficava na tela depois de levantar, até nos bancos de praça | Ao trocar de assento, `social.mjs` zerava a chave do aviso para forçar um novo, e com a chave zerada o aviso de mesa não era mais retirado | A marca `stale` pede para mostrar de novo e mantém a chave do aviso aberto; o QA da mesa confere que nada sobra ao levantar |
| Nomes de outros visitantes entravam por `innerHTML` | As iniciais vinham do nome recebido pela presença | Avatares montados com `textContent` |
| O aviso do economizador cobria o botão de fechar de um jogo | Ele aparece no canto superior direito, onde o WA põe o × dos modais, e o economizador seguia a bateria e a CPU reais da máquina | O aviso espera jogos, modais e a folha de pessoas do celular; o gatilho de CPU saiu (pedido do dono); o QA controla a bateria |
| No Simplificado, o "⋯" e o zoom não respondiam | A planta usava `pointer-events: none`, mas `.kmh > *` (mais adiante no arquivo) a ligava de novo, e ela era montada depois dos controles | `.kmh .kmh-simple` com `pointer-events: none` e a planta montada antes dos controles |
| O cartão do móvel no editor de mapa cobria a janela inteira | O tema tira o `backdrop-filter` (desempenho), e era ele que tornava a barra lateral do editor o bloco de contenção do cartão `fixed` | `contain: layout` na barra lateral do editor (`theme.css`) |
| "Centralizar em mim" não voltava o zoom | `WA.camera.set` só aproxima até a câmera voltar a seguir, e os botões de zoom do WA ignoram um clique de script; a roda do mouse sobre o canvas funciona (√2 a cada 100) | A página gira a roda na medida certa (log do zoom), com até três correções |
| O cartão de perfil não mudava o status | O WA fecha o menu num clique fora dele, e os botões do Svelte não respondem num menu já removido | O clique no cartão é tratado na captura da janela, antes do WA, e aperta o item do menu ainda aberto |
| A grade de emotes ficava escondida | O patch instala `__kSendEmote` quando a cena assina os stores do WA, antes de o mapa dar "olá"; a trava era ligada só depois | A página liga `data-k-emotes` no carregamento |
| "Centralizar em mim" não aparecia depois de arrastar | O WA não emite `onCameraUpdate` quando o scroll da câmera muda direto | A página entende o fim do arrasto pelo `data-k-dragging` que o patch tira |
| A arte dos emotes não carregava do tema | O gateway só serve CSS, fontes e scripts de `/konclui-theme/` | Os PNG de 16×16 vão embutidos em `theme/emotes.js` (gerado por `office/sources/emotes/build_emotes.py`) |
| `:k-id:` só chegava a quem clicou | O servidor retransmite caracteres de emoji, não códigos de texto | O cliente codifica `💬` + id em tags Unicode e envia pelo `emoteStore` já usado para reprodução local e rede; 12 testes do gateway e 13 verificações diretas dos helpers passaram, mas build e navegador nativos seguem pendentes |
| O quadrado do clique aparecia na metade do caminho até o bloco e ficava parado quando a câmera andava | O patch passava do mundo para a página só pelo zoom da câmera, mas o WA desenha o jogo numa fração da janela em telas de alta densidade e o navegador amplia o canvas | `tile-click` multiplica pela escala do canvas (largura na página ÷ largura interna) e manda `project()`, que a página chama a cada quadro enquanto a marca aparece |
| O painel de pessoas sumia depois de uma conversa | O WA abre o chat sozinho quando uma conversa por proximidade começa, e o chat agora ocupa o lugar do painel | A página lembra se o painel estava aberto e o reabre quando o chat fecha |
| O avatar do dock virava um ícone de menu numa conversa | A container query do WA esconde `.profile-menu-full` quando a barra ganha os botões da conversa | O layout novo mostra sempre o avatar |
| A borda de foco aparecia ao clicar na busca, e o Tab não a trazia de volta | O navegador conta um campo de texto clicado como `:focus-visible`; a proteção de teclas da busca engolia o Tab antes do rastreador | `<html data-k-input>` guarda se o foco veio do ponteiro ou do teclado; o rastreador é registrado antes da proteção |
| "Construir" não abria as ferramentas do WA | O WA fecha o próprio submenu no clique que ainda está subindo | Abrir o submenu na tarefa seguinte e listar os itens dele num menu nosso |
| As sondas mostravam o menu de reações ora aberto, ora fechado | O navegador sem GPU desenha 1 a 2 quadros por segundo, e o fade de 150 ms do WA terminava ou não antes do screenshot; o WA também fecha o menu quando o ponteiro sai da área de reações | A sonda deixa o ponteiro sobre o menu e espera; o desempenho real com GPU ainda não foi medido |
| Grama nova deixou um halo branco ao pé das árvores | O catálogo pinta um montinho de grama (aro `#9fdab2`, contorno `#89c79d`) nas cores da grama clara | `lawn.ground_ring` troca as duas cores pelas do gramado, só nas árvores (são as únicas peças com essas cores) |
| Enfeite misturado ao piso multiplicaria os tiles | Cada enfeite sobre cada posição da textura vira um tile novo | Enfeites numa camada própria, transparentes e independentes da posição |
| Água com 8 quadros pesava 70% do piso (cerca de 1.000 tiles) | Cada tile de água era único em cada quadro das cáusticas | Água parada no piso e movimento em tiles transparentes reaproveitáveis (brilhos, ondinhas) na camada `decor`: 544 tiles no piso no lugar de 1.408 |
| Ondinha visível com as animações desligadas | A ondinha que começava no fim do ciclo dava a volta e caía no quadro 0 | O início é sorteado para terminar antes de o ciclo voltar; o build confere que o quadro 0 de toda a água está vazio |
| Clique num móvel no "Explorar a sala" levava a câmera para longe (976 px numa sonda) | O Explorar do WA dá à câmera, ao soltar o botão, a velocidade do ponteiro, e a do Phaser guarda o movimento feito antes do clique | Patch `explore-click` do gateway: com `data-k-calm-explore`, a câmera só desliza depois de um arraste de verdade, nunca num clique sobre objeto ou área |
| Mapa inteiro preto, sem erro no console | Uma função de shader chamada `half` (palavra reservada do GLSL ES); o Phaser não avisa quando um shader não compila | `fx.mjs` compila os shaders num contexto à parte antes de montar e desiste com erro no console; `theme/fx/shaders.test.mjs` procura palavras reservadas (pegou `cast` duas vezes depois) |
| A água ficou por cima das paredes | `scene.children.moveAbove(a, b)` do Phaser só sobe `a` quando ele está abaixo de `b`; um objeto novo já está no topo | `placeAbove` tira o objeto da lista e o põe logo depois da camada |
| A sombra escurecia paredes, tampos de mesa e copas de árvore | Feita no filtro da câmera, que vê a imagem pronta e não distingue chão de sprite | Sombra num quad entre as camadas do chão e os móveis: só o chão escurece, e o sprite cobre a sombra sob ele |
| Tapetes faziam sombra | O manifesto omitia as peças planas, e o navegador media a pegada de toda peça ausente | O manifesto lista as peças planas como `null` (sem sombra) |
| A Sala 01 parada foi a 4,5 redesenhos/s | O retângulo da água (com o canal) encostava 8 px na vista e a água pedia redesenho | A água só anda quando pixels de água aberta aparecem na vista (amostragem da máscara) |
| A TV não acendia na reunião | A TV fica na parede, acima do piso da sala, e o teste de reunião olhava um ponto fora dela | A sala conta a partir de dois tiles acima do piso |
| `qa.py` reprovou a brisa do gramado às 3 h | Com os efeitos, o gramado fica azul-marinho e o teste lê a paleta da arte | O QA roda com os efeitos desligados |
| Setinha do microfone "não fazia nada" | O painel de dispositivos do WA abre 80 px abaixo do grupo, pensado para a barra no topo; no dock embaixo ele caía fora da tela | O tema abre o painel acima do dock e vira a setinha; o Esc fecha o painel |
| A mesma função em até três categorias do editor (20/10/2026) | Cada coleção nomeava as próprias categorias ("Mobília: cadeiras", "Escritório moderno: cadeiras e sofás", "Koncluí: cores do design system") | Um contrato, `taxonomy.json`, com categorias por função para todas as coleções, testado sem build (`test_taxonomy.py`) |
| Três de quatro porta-retratos não podiam ser escolhidos no editor | O editor junta variantes de mesmo nome, cor e direção, e toda peça própria tinha a cor `#0A0A3D` | Cada variante com a cor média do próprio desenho, sem repetir (`taxonomy.colours`) |
| O teste parou em "taxonomy.json: no category for konclui piece 'Koncluí: xadrez'" (20/10/2026) | Peça própria nova, sem regra no contrato; build e teste recusam peça sem categoria | Uma linha em `sources.konclui.rules` de `taxonomy.json` |
| Som ambiente "de repente" no volume cheio (20/10/2026) | `WA.sound` não muda o volume de um som que já toca; a zona era um retângulo que ligava e desligava | O ambiente passou para a página (`theme/hud-audio.js`, Web Audio com `setTargetAtTime`), e o mapa só entrega as fontes; o `WA.sound` ficou como recuo. Curva medida no motor (seção Som ambiente) |
| A área antiga do lago incluía o canal e metade das Salas 02 e 03 | O retângulo ia da fachada norte até abaixo do lago, para cobrir a margem | Com queda, a área no volume ideal é só a água; a margem e os caminhos ficam na queda. No recuo pelo `WA.sound`, a área cresce meia queda |
| O cartão do sino cobria os avisos de área do WA (20/10/2026) | O WA empilha "Recepção" e "Sino da venda" (`.notification-playing`) no mesmo canto, justamente quando alguém chega para tocar | O cartão fica logo abaixo dos avisos visíveis (opacidade acima de 0,1) e sobe quando eles saem; o `qa_sound` mede sobreposição 0 |
| Uma "venda" poderia ser forjada por qualquer visitante | `WA.event.broadcast('venda-nova')` está aberto a todo jogador | Só vale o evento sem `senderId` (Room API). O `qa_sound` prova as duas rotas de forja (broadcast de outro visitante e `senderId` na borda do iframe) e a venda sem remetente |
| Em teste, a venda sem remetente precisa da Room API, e o WA local não tem chave | A Room API exige a autorização da admin-api | O `qa_sound` põe o evento na borda da API do iframe (`{type: 'receiveEvent', data}` vindo de `window.parent`), o mesmo caminho que o WA usa ao repassar um evento do servidor |

## Limites

- **Licença:** a arte de terceiros vale para a sala local. Publicar depende do dono.
- **Paredes finas e pose sentada:** o gateway descrito em `local-wa/README.md`, "O mesmo gateway em produção", serve os
  patches no WA local e na produção. O [port nativo](https://github.com/konclui/workadventure/tree/9d538d6a025ad5e7716618c366361385fc83990b/play/src/front/Phaser/Game)
  ainda é somente código-fonte:
  não foi compilado nem validado no navegador, e não representa um corte para fora do gateway. A paridade e os hashes
  estão em [native-wall-seat-parity.md](../docs/performance/native-wall-seat-parity.md).
- **Carpas e reações:** são páginas por cima do canvas; os efeitos só escurecem as carpas à noite (filtro de brilho no
  iframe) e não as alcançam com refração nem luz.
- **Quadro branco:** abre o Excalidraw externo, só quando alguém aperta Espaço.
- **Jogos:** o Escape fica dentro do jogo e não fecha a janela; para voltar a andar, feche pelo X. Os jogos são os do
  campus, compartilhados com o escritório principal.
- **Variáveis compartilhadas:** qualquer visitante pode alterar mesas e salas.
- **Sala antiga:** a sala local com o nome anterior foi removida do armazenamento; a cópia do `.wam` está em `.scratch/hq-office/backup/`.
- **Interface só no gateway local:** a visão entra pelo `theme/local-dev.html`. Na produção, entraria pela injeção do
  serviço `theme` (como `theme.css` e `boot.html`), que não foi mudada.
- **Textos nativos:**
  - Rótulos como "Tools" e o pedido "Allow notifications?", que o WorkAdventure mostra quando o status vira Ocupado,
    continuam em inglês.
  - O aviso de área do WorkAdventure desce para baixo da pílula, sem sumir.
- **Presença:** depende de todos rodarem o script da sede. Quem fecha a aba some da lista em até 45 s. O ponto de
  quem está longe se move a cada parada, não a cada passo.
- **Status Ocupado:** ao sentar numa estação, os colegas veem a pessoa como Ocupada. "Encerrar foco" desfaz.
- **Venda real na sede:** o serviço `bell` (`bell/bell.mjs`) manda `venda-nova` para uma sala só, `BELL_ROOM_URL`, hoje
  o campus. O mapa da sede já aceita o evento. Falta o serviço mandar também para a sala da sede, com uma lista de
  salas ou uma segunda instância. Isso é mudança de produção e não foi feita. Até lá, só o sino manual toca aqui.
- **Som e cartão só no gateway local:** como a visão, `hud-audio.js` e `hud-sale.js` entram pelo `theme/local-dev.html`.
  Sem eles, o ambiente toca pelo `WA.sound` sem degradê e o cartão é a página do campus.
- **Som ambiente sem paredes:** a queda conta só a distância. Vidro e parede não abafam: quem está numa cabine a 3 tiles
  do lago ouve um quarto do volume ideal.
- **Mural de avisos (campus) não portado.** Precisaria de:
  - um módulo novo no runtime: botão "Avisos (N)" com os não lidos (`avisosLidoEm` em `WA.player.state`) e o painel
    `notices.html` no modal;
  - a variável `avisos` declarada no `build.py` e a página copiada do campus;
  - o toast "Novo aviso de …" pelo cartão do HUD (um quarto tom no `hud-sale.js`);
  - o botão no dock e no painel de reações. É a parte que pede o `moment-hud.js`: hoje `BAR_ICONS` e `MORE` só
    conhecem os botões atuais.
