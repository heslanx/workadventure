# Carpas do lago (Escritório Sede) — módulo v2

Sobreposição animada de carpas para o lago e o canal do escritório `hq-office/`.
Substitui, **só neste mapa**, o módulo `office/koi/` do escritório principal. Em relação a ele:

- **Resolução nativa:** 1 pixel do canvas = 1 pixel do mapa (32 px por tile). Sem os blocos 2x
  do módulo antigo; o corpo é um caminho suave com leve anti-aliasing nas bordas.
- **Comportamento novo:** campo de distância da margem, campos de fluxo geodésicos (o canal
  estreito funciona nos dois sentidos), boids leves, personalidade por peixe, nado de impulso e
  deslize, descanso no fundo, disputa por comida e curiosidade por quem para na margem.

O espírito da referência aprovada 10/10 (`docs/references/water-koi-2026-10-12/`) foi mantido:
tamanhos e padrões variados, incluindo carpa preta, grupo solto, impulso das batidas e deslize,
respostas individuais à comida e círculos sutis quando uma carpa come.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Página aberta pelo mapa como `WA.room.website`; carrega `/iframe_api.js` e `koi.mjs` |
| `koi.mjs` | Entrada: carrega `scene.json` e as máscaras, laço de quadros, clique, API do WA |
| `simulation.mjs` | Simulação pura e determinística (sem DOM): `createSchool(...)` |
| `field.mjs` | Campo de distância com sinal, gradiente e campos de fluxo geodésicos |
| `draw.mjs` | Pintor em canvas 2D |
| `preview.html` | Prévia independente com as fixtures, fundo escuro e botões |
| `fixtures/` | Lago de teste: `scene.json`, `swim.png`, `open.png` |
| `simulation.test.mjs` | Testes (`node --test`) |

## Contrato de runtime

O build do mapa grava estes arquivos **ao lado** de `index.html`:

- `scene.json`: `{"width": W, "height": H, "count": N, "seed": S, "spawnPoints": [[x, y], ...], "scale": 1}`.
  Coordenadas em pixels do mapa relativas ao canto superior esquerdo da sobreposição.
  Campos opcionais: `"origin": [ox, oy]` (posição da sobreposição no mapa; liga a curiosidade e a
  dica de teclado) e `"nearWaterPx"` (distância da água para a dica de ESPAÇO; padrão 48).
- `swim.png` (W×H): alfa > 127 onde a carpa pode nadar (lago + canal, inclusive sob o deck).
- `open.png` (W×H): alfa > 127 onde a água é vista de cima. Carpas, sombras, comida e círculos
  só aparecem aí; sob o deck a carpa some, como se passasse por baixo. Comida só cai aqui.

No script do mapa, a sobreposição segue o padrão do escritório principal:

```js
WA.room.website.create({
  name: 'carpas', url: new URL('koi/index.html', WA.room.mapURL).href,
  position: { x: ox, y: oy, width: W, height: H },   // the same origin/size as scene.json
  visible: true, allowApi: true, origin: 'map', scale: 1,
});
```

Sem a API do WA (prévia), tudo funciona igual, menos curiosidade e dica de teclado.

## Modelo de comportamento

Aproximação artística, não modelo etológico. Unidades: px do mapa e segundos.

**Geometria.** `field.mjs` calcula a distância euclidiana exata até a margem (positiva na água,
negativa em terra; fora da imagem conta como terra) e o gradiente. Numa grade de 8 px, até 12
**âncoras** são escolhidas por amostragem do ponto mais distante; cada uma tem um campo de fluxo
geodésico (Dijkstra com custo maior perto da margem), que leva o peixe pela boca do canal sem
encalhar em quinas. A margem é evitada em três camadas: empurrão pelo gradiente aqui e num
ponto à frente, teste de raio em 16 direções candidatas e, por fim, uma trava dura que desliza
o peixe ao longo da margem em vez de deixá-lo entrar em água rasa demais.

**Movimento.** Passo fixo de 1/60 s; `step(dt)` limita `dt` a 0,05 s e nunca recupera tempo
perdido (aba oculta, fora da tela, pausa). Giro limitado com aceleração angular, sem tremor nem
teleporte. Coluna de 7 juntas que seguem a cabeça.

| Parâmetro | Valor |
|---|---|
| Comprimento / largura | 18–44 px / 25–30% do comprimento; pretas tendem a ser grandes |
| Cruzeiro | 6,5–11,5 px/s por peixe; impulso até 1,3× e deslize até 0,78× |
| Velocidade máxima | 20–28 px/s (ousadia e tamanho), teto absoluto 28 |
| Propulsão | empuxo 15·esforço·(0,3 + 0,7·sen²(fase)), arrasto 0,3/s; batida 0,45–3 Hz |
| Giro | 1,1 rad/s cruzeiro, 1,8 comida, 0,35 descanso; aceleração 3 rad/s² |
| Folga da margem | dura 0,3·L + 2 px; conforto 0,4·L + 8 px |
| Vagar | soma de 3 senoides por peixe (períodos ~5–50 s), ±0,7–1,15 rad em torno do rumo |

**Grupo (boids leves).** Separação ciente do corpo (cabeça, meio e cauda), cessão de passagem a
quem vai à frente na mesma faixa, mão direita para quem vem de frente, desvio preditivo de
trajetórias que se cruzam em até 3 s e um deslize lateral de no máximo 3 px/s quando os corpos
se tocam. Alinhamento (0,35) e coesão (0,45) fracos com os 4 vizinhos mais próximos, escalados
pela sociabilidade. Ao escolher novo destino, o peixe às vezes adota o do vizinho, formando
grupos soltos que se desfazem.

**Personalidade.** Ousadia, sociabilidade, curiosidade, tendência a descansar, profundidade
preferida, região de origem (âncora preferida) e ritmo do vagar, sorteados pela semente.

**Modos.**

- *Cruzeiro:* rumo a uma âncora; destinos distantes são mais prováveis, então todos circulam
  por lago e canal; âncoras sob o deck valem menos.
- *Descanso:* na água mais funda (≥ 45% da maior distância da margem), quase parado, fundo
  (profundidade 0,92), nadadeiras peitorais abanando, por 4–14 s.
- *Comida:* clique ou toque em água aberta solta 1–3 pelotas que boiam e derivam devagar.
  Cada peixe percebe com atraso de 0,25–2 s (menos ousado, mais lento) mais distância/140 px/s,
  num raio de 110–200 px com linha de visada. Disputam; o primeiro a alcançar abocanha (boca
  abre), gera um círculo e fica um pouco saciado (3 pelotas = perde o interesse por um tempo).
  Os que perderam a disputa se dispersam com um impulso. Pelota não comida afunda em 30 s.
- *Curiosidade:* com a API do WA, se o visitante fica a até ~90 px da água por 3 s, os peixes
  próximos e ousados vão até a margem dele, cada um no seu lugar, sobem e ficam de frente.
  Cansam em 25–60 s; quando o visitante sai, voltam a nadar em até 1,5 + 2,5 s.
- *Gole na superfície:* a cada 10–22 s uma carpa em cruzeiro toca a superfície (um círculo).

**Movimento reduzido** (`prefers-reduced-motion`): velocidades e batidas a 35%, giro a 60%,
onda do corpo pela metade e nenhum círculo. **Pausa** fora da tela (IntersectionObserver) e com
a aba oculta (`visibilitychange`).

## Desenho

Canvas 2D em 1:1, `image-rendering: pixelated` (o zoom do WA amplia como o resto do mapa).
Por quadro: sombras suaves deslocadas conforme a profundidade, nadadeiras translúcidas, corpo
com onda que cresce com o empuxo, manchas recortadas no corpo (kohaku, sanke, gold, shiro e
preta), linha dorsal, contorno fino azul-escuro, olhos e véu de água pela profundidade; depois
comida e círculos; por fim tudo é recortado por `open.png`. Cores levemente apagadas.
Sem alocação por quadro nos laços quentes (arrays tipados e cores constantes).

Custo medido: simulação ~10–16 µs por passo com 10–16 carpas no Node; desenho p50 ~0,2 ms
por quadro no Chromium headless (sem GPU/compositor e sem o motor do WA).

## Prévia

```sh
cd hq-office/pool
python3 -m http.server 8791 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8791/koi/preview.html`. Botões: **Pausar**, **Alimentar**,
**Contorno da água aberta**, **Visitante na margem** (simula a curiosidade) e **Zoom**.
Clicar na água também alimenta. O fundo (margem, água, deck) existe só para dar contexto;
no mapa a arte é do próprio mapa.

O lago de teste tem canal de 96 px (3 tiles) e ~490 px vindo do topo, lago de ~352×352 px com
contorno irregular e um deck em K cobrindo ~25% do lago. As fixtures foram geradas por
`.scratch/koi-v2/make_fixtures.py` (Pillow), pasta fora do Git: copie o script para o repositório
se elas precisarem ser regeneradas no futuro.

## Testes

```sh
cd hq-office/pool/koi
node --test
```

Cobrem: contrato das fixtures; campo de distância; determinismo pela semente (e `reset`);
16 carpas por 120 s com comida sem sair de `swim.png` (cabeça, focinho e meio do corpo), sem
saltos, com limites de velocidade e giro; cruzeiro lento com impulso e deslize; nenhuma
sobreposição longa; toda carpa visita canal e lago em 240 s; comida só em água aberta, disputada,
comida em menos de 25 s com círculo e dispersão; `dt` limitado e inválido rejeitado;
movimento reduzido mais lento e sem círculos; curiosidade e perda de interesse; custo de CPU.

## Pendências

- O build do `hq-office` ainda não gera `scene.json`/`swim.png`/`open.png` nem cria o site
  no script do mapa; este módulo foi validado só com as fixtures, fora do motor do WA.
- Curiosidade e dica de ESPAÇO dependem de `origin` no `scene.json` e de `allowApi: true`.
- Custo no WA real (GPU, compositor, outros iframes) ainda não medido.
