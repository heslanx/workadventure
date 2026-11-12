# Pets do escritório

Companheiros que continuam vivos quando a pessoa para (pedido do dono, 20/10/2026): o gato explora, se lambe,
dorme, deita de barriga para cima e brinca de bolinha; a Koru voa e pousa no ombro, na cabeça, numa cadeira ou mesa,
respira e olha em volta; todo pet aceita carinho e mostra o nome quando o mouse passa por cima. Cada espécie tem
variações de cor, como os gatos clássicos do WorkAdventure.

Sem o runtime (um navegador sem o gateway, local ou de produção), cada pet continua um companheiro comum do
WorkAdventure: a folha `picker` de 96×128 anda atrás do dono.

## Pastas

| Caminho | O que é |
|---|---|
| `species/<espécie>/` | Fonte da arte e o script que gera a espécie (dono: quem desenha a espécie) |
| `out/<espécie>/` | Gerado: atlas por cor, folhas `picker`, `<espécie>.json`, prévias em `out/<espécie>/preview/` |
| `tools/petkit.py` | Contrato executável: valida, gera cores, folhas `picker` e prévias |
| `tools/degrid.py` | Lê uma folha de pixel art ampliada gerada por IA e devolve os pixels nativos (ponto de partida, não arte final) |
| `theme/pets/` (fora desta pasta) | O runtime da página: assume os companheiros no motor e dá o comportamento. Mora no `theme/` porque é de lá que o gateway local e o nginx da produção servem módulos para a página (`/konclui-theme/`), como os shaders em `theme/fx/` |

## Contrato do atlas (v1)

- **Atlas:** PNG RGBA, alfa binário (0 ou 255), células de 32×32, 16 células por linha (512 px de largura), quantas
  linhas precisar. Quadro `i` = coluna `i % 16`, linha `i // 16`. Uma célula vazia é toda transparente.
- **Âncora:** o ponto de apoio (onde os pés tocam o chão ou o poleiro) fica no pixel `anchor` da célula, o mesmo em
  todos os quadros da espécie. Padrão `[16, 28]`. Quadros de voo e de flutuação desenham o corpo com a mesma âncora:
  a altura no ar é do runtime, que sobe o sprite e deixa a sombra no chão.
- **Sem sombra desenhada:** o runtime desenha a sombra (elipse `shadow` = `[largura, altura]` em px), para que ela
  fique no chão quando o pet voa, pula ou pousa num móvel.
- **Tamanho (o validador cobra desde 21/10/2026):** em pose de pé, sentada, pousada ou parada (`idle`, `sit`,
  `look`, `happy`, `blink`, `perch`, `groom`, `sniff`…), no máximo 17 px de altura para `bird` e 20 px para os
  outros corpos, mais `headroom` linhas quando o `species.json` declara um chapéu (a Koru chef usa 4). Nessas poses o
  pet também não pode ter mais de 1,35 vez os pixels do próprio `idle-down`: ao receber carinho ele não cresce.
  Asas para cima, deitado, nadando e pendurado ficam fora dessa regra. Andar e uivar (`walk-*`, `howl-*`) também têm o
  teto de 20 px de altura nos corpos que não são `bird`, sem a regra de crescimento (o andar de lado é mais comprido).
- **Tamanho:** sempre menor que o avatar (o woka de 32 px tem uns 30 px visíveis). Pássaro de ombro: 13 a 17 px de
  altura. Quadrúpede: 13 a 20 px de altura sentado, até 26 px de comprimento deitado (`lie-`, `sleep-`, `bellyup-`, `loaf-`,
  conferido pelo validador). Nenhum pixel opaco fora da
  célula. A imagem-alvo exagera: o cachorro dela é mais alto que o avatar; vale este limite, não a escala do alvo.
- **Estilo da família:** contorno escuro de 1 px (nunca preto puro: o tom mais escuro da própria cor), sombreamento
  chapado com uma luz e uma sombra por material, luz vindo de cima à esquerda, sem degradê, sem pontilhado, sem
  pixel solto. Olhos legíveis em tamanho nativo. Referência: `.dream-loop/pets/target.png` (o alvo no motor) e
  `.dream-loop/pets/targets/koru-target.png` (o alvo da Koru).
- **Direções:** `down`, `left`, `up`; `right` é `left` espelhado pelo runtime quando a espécie não desenha `right`.
  Clipe sem direção usa `any`.
- **Cores:** a espécie é desenhada uma vez nas cores-chave e cada variação troca cores-chave por outras, cor por
  cor (`palette.json`). Toda variação tem exatamente o mesmo alfa da base.

### `out/<espécie>/<espécie>.json`

```json
{
  "v": 1, "species": "koru", "name": "Koru", "family": "koru", "plan": "bird",
  "cell": 32, "anchor": [16, 28], "shadow": [10, 3], "temperament": "curious",
  "clips": { "idle-down": { "frames": [0, 1], "fps": 2, "loop": true } },
  "picker": { "down": [16, 0, 17], "left": [20, 4, 21], "up": [24, 8, 25] },
  "variants": [ { "id": "turquesa", "name": "Turquesa", "atlas": "koru-turquesa.png", "picker": "koru-turquesa.picker.png" } ]
}
```

- `plan`: o corpo, que decide os clipes obrigatórios e o repertório de comportamento (tabela abaixo).
- `temperament`: `curious`, `calm`, `playful`, `lazy` ou `loyal`; pesa as escolhas do runtime.
- `picker`: os três quadros de cada linha da folha de 96×128 do WorkAdventure (`walk`, parado, `walk`), usados também
  quando não há runtime. `right` sai espelhado de `left`.
- `variants`: a primeira é a padrão. `id` vai no id do companheiro: `pet-<espécie>-<cor>`.
- `perch` (opcional): como a ave pousa. `{"owner": false, "rest": "hang", "hangAnchor": [16, 8]}` é o morcego
  (decisão do dono, 21/10/2026): nunca no ombro nem na cabeça do dono, voa atrás dele e, quando ele para, fica
  pendurado sob a borda de uma mesa, mesa de trabalho ou estante a até 4 tiles (sem borda por perto, dá voltinhas no
  ar); `hangAnchor` é o pixel `[x, linha]` dos quadros `hang-*` encostado na face de baixo da superfície.
- `headroom` (opcional): linhas extras acima do limite de altura, para chapéus (a Koru chef usa 4).

### Clipes por corpo

Nome do clipe: `<ação>-<direção>`. Obrigatórios por `plan` (o validador cobra); qualquer outro é opcional e o runtime
usa quando existe.

| plan | Obrigatórios |
|---|---|
| `bird` | `idle`, `hop`, `fly`, `perch` em down/left/up; `takeoff-left`, `land-left`, `glide-left`, `look-down`, `blink-down`, `sleep-down`, `preen-left`, `happy-down`, `celebrate-down` |
| `quadruped` | `idle`, `walk` em down/left/up; `sit-down`, `sit-left`, `lie-left`, `sleep-any`, `bellyup-any`, `groom-left`, `stretch-left`, `pounce-left`, `happy-down`, `yawn-down`, `look-down` |
| `hopper` | `idle`, `hop` em down/left/up; `sit-down`, `sleep-any`, `happy-down`, `look-down` |

O pulo do `hopper` é o seu andar e a única altura que ele ganha (o runtime ergue só quem voa ou flutua): os quadros
`hop-*` sobem até 4 px acima da âncora. Nos outros corpos, `hop-down` e `hop-up` ficam a até 2 px dela. Numa ave em pé, o rabo pode descer até 3 px abaixo da âncora; os pés ficam
nela.
| `floater` | `idle`, `move` em down/left/up; `happy-down`, `sleep-down`, `special-down` |
| `roller` | `idle`, `move` em down/left/up; `curl-left`, `happy-down`, `sleep-down` |
| `swimmer` | `idle`, `walk`, `swim` em down/left/up; `happy-down`, `sleep-down`, `look-down` |
| `plant` | `idle`, `walk` em down/left/up; `root-down`, `sway-down`, `happy-down`, `sleep-down` |

`look-down` tem dois quadros: olhando para a esquerda e para a direita. `blink-down`, um quadro de olhos fechados.

## Como a arte é feita

Decidido em 21/10/2026, depois de as grades desenhadas à mão pararem entre 4 e 7 na nota do juiz (pedido do dono:
"Pedir pro GPT já desenhar ele na quantidade de pixel que podemos ter... todas animações").

1. Um quadro-mestre nativo, ajustado à mão: a frente (e o perfil e as costas quando o corpo pede), com o rosto
   desenhado pixel a pixel.
2. O pipeline de linhas do GPT do sprite-gen (`.agents/skills/sprite-gen`, `docs/atlas-workflow.md`): o quadro-mestre
   ampliado é a base travada, os outros quadros-mestre são as âncoras de direção, o GPT desenha cada animação numa
   linha e o motor extrai com `pixel_unfake`. Linha que vem espremida ou fora do tamanho ganha outra tentativa com trava
   de tamanho no prompt; se ainda falhar, o Nano Banana (`.scratch/pets/tools/nano-image.sh`) com o mesmo prompt.
   Edições à mão depois do `prepare` (trava de tamanho no prompt, frase que permite sentar, célula 30×32) são
   permitidas e ficam no `qa-notes.md` da execução e nas `notes` do manifesto. Poses de pé que o GPT desenha
   acima de 20 px são extraídas de novo, das mesmas imagens, numa cópia da execução com teto de 20 linhas
   (`run-upright`), e poses deitadas, numa cópia com teto de 26 colunas (`run-lying`). Uma linha refeita pelo Nano é
   reencaixada nas posições dos quadros da linha original antes da extração.
3. `species/<espécie>/from_spritegen.py` põe os quadros nas nossas células e na âncora, dá nome de cor-chave a cada
   cor (as variações continuam funcionando) e tira pixels soltos; depois `petkit build`, `validate`, `preview`.
4. Um juiz independente dá a nota contra os alvos. Decisão do dono (21/10/2026): as estrelas (Koru, gato, caramelo)
   fecham com 8 ou mais; as demais com 7 ou mais e passando no teste de identidade (lê na hora como aquele bicho, de
   frente, de lado e de costas, no tamanho nativo e a 1,5x).

O que as rodadas de 21/10/2026 ensinaram:

- **A silhueta decide, não a animação.** Grade à mão sem um passo de desenho parou entre 5 e 6. O que funcionou foi
  desenhar primeiro os quadros-mestre no tamanho nativo, ao lado das referências, e só depois derivar os quadros.
- **Vista que não lê, troque a vista.** Um peixe de 10 px de frente vira rosto; um lobinho de 20 px de frente vira gato.
  A carpa passou com o koi sempre de perfil; o lobo melhorou com a frente em 3/4. Pelúcia dorme sentada, não deitada.
- **Derivar quadro apaga detalhe.** Respiração, achatamento e erguer pata por recorte de linhas cortaram olho, nariz e
  dente e abriram o contorno. Toda derivação passa pelo contorno de novo e nunca remove uma linha do rosto; o
  preenchimento de buracos fecha só buracos dentro do corpo, nunca o vão entre as pernas.
- **Afirmação de nota se confere no atlas.** Os juízes refutaram muitas notas de rodada ("olho 2×2 limpo", "0 pixels").
  Meça no atlas pronto e olhe cada quadro alterado a 6x e na cena a 1,5x antes de declarar.
- **Espécie com o juiz fica congelada.** Reconstruir durante o julgamento invalida a nota.
- **O contrato evolui com o caso real.** Pulo do `hopper` sobe até 4 px, rabo de ave pode passar 3 px da âncora,
  andar e uivar têm teto de 20 px e deitado de quadrúpede, de 26 px: todos vieram de defeitos achados pelos juízes.

Ferramentas instaladas para isso (21/10/2026): `spritefusion-pixel-snapper` (Homebrew, um quadro por vez) e as skills
do agent-sprite-forge em `.agents/skills/` (`generate2dsprite`, `video2dsprite`, `generate2dmedia`, `generate2dmap`,
`codeart2d`).

## Comandos

```sh
python3 pets/tools/petkit.py validate pets/out/<espécie>       # contrato; sai 1 com a lista de falhas
python3 pets/tools/petkit.py build pets/species/<espécie>      # base + palette.json -> cores, picker, validação
python3 pets/tools/petkit.py preview pets/out/<espécie>        # folha de contato 6×, GIF 4× por clipe, cena 1,5× (o zoom do motor)
python3 pets/tools/degrid.py <folha-ia.png> --out <pasta>      # pixels nativos de uma folha ampliada
```
