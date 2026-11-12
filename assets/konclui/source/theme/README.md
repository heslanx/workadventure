# Tema Koncluí para o escritório (WorkAdventure v1.34.1)

O design system escuro da plataforma (acento menta `#53FFC8`, texto `#1A1F1E` sobre o acento) aplicado por cima da
interface do WorkAdventure com **um arquivo de CSS e um fragmento de abertura**. Nenhuma linha do bundle do WorkAdventure
é alterada, e nenhuma regra mira o canvas do Phaser.

O [personalizador de avatares](../design/avatars/implementation.md), implementado localmente em
`avatars/`, acrescenta um módulo independente à seleção nativa. O botão abre peças e cores próprias da
Koncluí, usando a API pública `/avatar-api/`. O catálogo é carregado ao abrir o editor; seus módulos
revalidam o cache (`no-cache`), enquanto os PNGs com IDs canônicos têm cache imutável. O pacote abaixo
descreve o tema base, sem contar esse editor. Nenhum arquivo do mapa precisa ser reenviado.

| Arquivo | Bytes | Papel |
|---|---|---|
| `theme.css` | 27.782 | Tokens `--k-*`, regras por tela com o componente e a linha de origem, movimento e perfil Leve |
| `boot.html` | 16.734 | A tela de carregamento do escritório: logo em SVG montada peça por peça, o loader "morph" (quatro peças em menta e branco que andam pelos cantos e viram círculo no caminho), linha de status com troca de texto. Estilo e script de estado embutidos, sem rede |
| `fonts/urbanist-latin.woff2` | 27.752 | Urbanist variável 400 a 800, subconjunto latin (cobre o português), copiada de `konclui-platform/packages/ui/src/styles/fonts/` |
| **Total** | **72.268** (70,6 KiB) | Limite do pacote: 120 KiB. `grep -c "!important" theme/theme.css` dá 16 linhas (23 ocorrências) |

O logo do `boot.html` é o SVG vetorial real da plataforma (`apps/web/src/assets/logo-konclui-white.svg`, o mesmo desenho
do PNG `logo-konclui-white.png`), sem redesenho.

## Pipeline de produção (o que `tests/theme_preview.py` simula)

O nginx do serviço `theme` reescreve o documento HTML (`/`, `/~/*`, `/@/*`, `/_/*`) e serve `/konclui-theme/*` a partir desta pasta:

1. injeta `<link rel="stylesheet" href="/konclui-theme/theme.css?v=<hash>">` antes de `</head>`: a folha entra depois das folhas do
   WorkAdventure e vence empates de especificidade; injeta também o módulo `/konclui-theme/avatars/bridge.js`;
2. troca `background-color:rgb(27, 42, 65);` por `background-color:#03051a;` no estilo direto do `<body>` (`play/index.html:211`);
3. acrescenta o conteúdo de `boot.html` no fim do documento (`add_after_body`). O navegador o põe como irmão do `#app` no `<body>`,
   então `#app:... ~ #kboot` continua valendo.

O teste reconhece o que a produção já fez e não aplica de novo: link com `href` começando em `/konclui-theme/theme.css` (com ou sem
`?v=`), `#kboot` em qualquer ponto, cor do corpo. Cada passo sai como `applied` ou `already in response`. Antes do deploy ele espelha a
produção (boot no fim do documento). `/konclui-theme/*`, com qualquer query, é servido do disco local, então o que roda é o arquivo
em edição. `--before` faz o contrário: tira link, boot e cor do documento ao vivo, para a linha de base sem o tema.

A prévia também injeta/remove o módulo de avatar. Enquanto `/avatar-api/status` não existir no escritório
ao vivo, o módulo mantém a seleção nativa sem o botão novo. Para validar o editor e a integração completa
antes de publicar, use `tests/avatar_editor.py` e `tests/avatar_runtime.py`, que executam a API local.

## Como verificar

```
cd ~/Developments/konclui-project/konclui-work
python3 tests/theme_preview.py --check                   # 4 viewports, exit 0 só se os checks executados passarem
python3 tests/theme_preview.py --check --viewports 360   # um viewport
python3 tests/theme_preview.py --before --viewports 1440 # linha de base, sem o tema
python3 tests/theme_preview.py --boot --after            # quadros da abertura em 0, 300, 600 ms e na saída, movimento reduzido
python3 tests/popup_fit.py                               # popups de ajuda do WA sem botão cortado, 6 larguras + celular
python3 -m unittest tests.test_theme_preview_rules tests.test_theme_preview_browser tests.test_theme_cache -v
```

Regras do escritório no ar, cumpridas pelo teste: `getUserMedia`, `getDisplayMedia` e `enumerateDevices` bloqueados antes da
primeira navegação; visitante "Tema"; sem chat, emote, sino, edição do mapa, clique no canvas, status, convite ou
denúncia; só `Tab`, `hover` e cliques em botões de interface; sessão de cerca de 40 s por viewport; navegador sempre fechado.
O `--check` imprime as medições, grava o detalhe em `ux-audit/screenshots/overlay/check-report.json` e as screenshots
`after-<viewport>-<tela>.png` ao lado das `before-<viewport>-<tela>.png`.

Resultado histórico do tema clássico, antes do layout da Sede (nenhuma falha): seletores 51/51 em cada viewport, contraste mínimo de par nomeado 5,47:1,
varredura de todo texto visível sem reprovação, zero `backdrop-filter` ou `filter: blur` ativos, zero overflow horizontal
(`scrollWidth <= innerWidth` em 360, 768 e 1440), anel de foco visível em todo controle alcançado por `Tab`.

**Contrato do verificador, 11/11/2026.** Cada medição registra o layout observado. `html.kmh-g` em larguras a partir
de 768 px usa o contrato do desktop da Sede; o tema clássico e o celular conservam as regras anteriores.
O desktop verifica o dock pintado, o vidro nos seletores previstos e o cartão do chat. Os wrappers transparentes
do WA não contam como superfícies pintadas. Desfoque fora dos elementos previstos, material diferente e dock ausente
continuam reprovando. As medidas brutas ficam no relatório.

O estado aberto do chat usa `closeChatButton` e um ícone por máscara em `::before`; seu SVG fica oculto.
O verificador mede esse ícone e só abre o chat quando ele ainda está fechado. Classes sintéticas de estado no
antigo `chat-btn` não representam esse controle. O contraste sobre o gradiente aprovado usa um limite inferior
conservador que inclui qualquer pixel do mapa sob sua transparência. Fundos não reconhecidos ficam inconclusivos;
um par obrigatório sem medida conclusiva não passa. Os testes de navegador usam o CSS real e provocam erros de
material, desfoque, contraste e ausência de elementos para conferir o próprio verificador.
O comando sai com código 1 quando há falha comprovada e com código 2 quando restam apenas medidas inconclusivas.
Um limite inferior abaixo de 3:1 não prova contraste insuficiente se o intervalo ainda inclui valores acima de 3:1.
Opacidade de grupo não suportada pelo cálculo também impede certificação.

O resultado cobre as telas alcançadas. O relatório explicita telas não exercitadas, incluindo o perfil e as
configurações próprios da Sede, cujo fluxo pertence a `hq-office/qa_hud.py`. Esta checagem não certifica todos os
estados dos controles de chamada. Evidências desta rodada ficam no [plano de execução](../docs/plans/20261111-wa-1.34.5-fast-client.md).

Resultado final desta rodada: 34 testes de regras/navegador/cache passaram; a varredura das quatro larguras
reprovou com 11 achados e seis medidas inconclusivas, concentrados em 360 e 768 px. Os traços de mídia desligada
passaram no desktop com limite inferior de 3,75:1. O proxy recusou os dois identificadores Gemini com
`unknown provider`. A pedido do dono, Sonnet 5.5 revisou as mesmas capturas: zero erros e dois avisos em 768 px
(presença divergente e minimapa sobre o dock). Os ícones alterados passaram na revisão visual; os avisos ficam
pendentes de reprodução e não há aprovação geral. Resultado e limites estão no plano de execução vinculado acima.

**Minimapa em telas estreitas, 11/11/2026.** Em 768 px, o minimapa ficava a 14 px do rodapé e cobria o avatar
da barra, que crescia independentemente dele. A medição no motor confirmou 2.760 px² de sobreposição.
`moment-hud.js` agora mede o retângulo pintado da barra. Quando falta espaço horizontal, coloca o minimapa 8 px
acima dela. Quando sobra espaço, mantém os 14 px originais. A medição acompanha redimensionamento, painel,
chat e substituição dos controles. Não depende da posição vertical atual do minimapa, evitando alternância.

`python3 -m unittest tests.test_moment_hud_layout -v` executa sete casos com o JS e CSS reais.
Os seis casos originais falharam antes da correção; os sete finais passaram. No motor, a sobreposição ficou
em zero em 768, 1000 e 1440 px. O avatar recebeu o teste de apontamento, e Enter abriu o minimapa, Escape
fechou e devolveu o foco. O Sonnet 5.5 confirmou o afastamento sem erros novos na alteração.
Evidência local em `.audit/narrow-hud-20261111/`; nenhuma publicação nesta rodada.

O aviso de presença teve outro comportamento. A lista convergiu depois da entrada, mas novas chegadas
produziram diferenças temporárias entre os jogadores próximos e o catálogo anunciado pelo mapa.
Uma amostra estável não certifica todas as entradas. O protocolo de presença permanece sem alteração.

A varredura completa posterior terminou com código 1, com 13 achados e 18 medidas inconclusivas.
Continuam abertos o layout de 360 px, o dock ausente no estado de chat em 768 px, o foco de 1 px no contêiner
das câmeras e os contrastes sem cálculo conclusivo. Os estados de chamada variam entre execuções;
a diferença de contagens não demonstra correção ou regressão por si só.

## Decisões e desvios (INTENT)

- **Uma tela de carregamento só (Carregamento).** O escritório tinha duas: a abertura (`#kboot`, logo de 160 px) e o
  carregador do WorkAdventure (logo da admin-api em 194 px, 42 px mais abaixo, outro texto). E a abertura não tinha memória:
  era uma regra `:has()` que a escondia enquanto havia tela de nome, de Woka ou carregador, então nos intervalos entre duas
  telas ela voltava inteira. Medido em 2026-10-11 a 807 px: numa primeira visita a abertura voltava duas vezes (depois do
  nome e depois do Woka) e terminava numa troca com o carregador em que a logo mudava de tamanho e de lugar, as "três
  piscadas". Agora um script de 20 linhas no `boot.html` mantém um estado em `html[data-kload]`: `boot` (página aberta),
  `input` (nome, Woka ou erro na tela), `loading` (carregador do WA) e `done` (`#game.game-scene-loaded`). Num intervalo
  nada é reconhecido e o estado anterior fica, então a abertura não volta. Ela cobre o carregador do WA, cujo conteúdo o
  tema esconde (seção 4), e mostra a mesma logo e a mesma barra do primeiro quadro ao jogo. Medido depois: numa visita de
  volta, uma tela só da primeira pintura até o jogo; numa primeira visita, a abertura sai para o nome, não volta entre o
  nome e o Woka, entra uma vez para o carregamento e sai com o escritório na tela; a logo do WA nunca aparece. Rede de
  segurança: se uma versão do WA renomear o que o script procura, a abertura sai 15 s depois da montagem. Quando a fase
  muda de verdade (de `boot` para `loading`), só a linha de status troca, de "Abrindo o escritório da Koncluí" para
  "Entrando no escritório da Koncluí", com a receita "Text states swap" do transitions.dev (200 ms, sai para cima e entra
  por baixo); logo, barra e fundo não se mexem. Se a tela estava escondida (depois do Woka), o texto troca sem movimento. O canvas do
  Phaser usa a cor da sala (`backgroundColor` da admin-api) nos intervalos entre telas: passou de `#06141F` para
  `#03051A`, a mesma da página, para que o intervalo não pisque em outro tom.
- **Loader "morph" no lugar da barra pulsante (19/10/2026).** O dono pediu "uma tela de carregamento mais bonita" com
  o componente "morph" (React e Tailwind). O WA não roda React: o mesmo desenho virou HTML e CSS no `boot.html`, entre
  a logo e a linha de status, em 64 px. Quatro peças de 16 px, menta e branco alternados, andam pelos cantos de um
  quadrado, cada uma 0,2 s atrás da anterior, e no meio de cada lado viram círculo (escala 0,62). Só `transform` e
  `opacity`, como o resto da tela, porque ela pinta enquanto o navegador compila o app: o quadrado some por cima de
  um círculo que fica sempre lá (`border-radius` animado repintaria na thread principal, e dois fades cruzados
  apagavam a peça no meio). Uma `@keyframes` por peça, sem `var()` dentro, para o compositor aceitar. Com movimento
  reduzido, as quatro ficam paradas num quadrado 2×2. Visto em captura quadro a quadro (`boot-strip.png`).
- **Saída e volta com o movimento da marca.** A abertura sai e volta em 200 ms, ease-out-expo, por opacidade
  (`--animate-fade-out` do platform), e `display:none` só no fim (`transition-behavior: allow-discrete`). A entrada da tela
  de nome começa 400 ms depois do início da saída: título e campo em 200 ms, botão 40 ms depois, `translateY(12px)` e
  opacidade.
- **A barra do carregador do WorkAdventure não dá para tornar monotônica por CSS** (`LoaderScene.svelte:31`, 93% para 54%
  e depois 100%). Por isso o carregador do WA fica escondido sob a abertura e o único indicador é o pulso dela (2 px,
  opacidade 0,35 a 0,75, 3200 ms). É o único loop do pacote e para quando o escritório abre.
- **Três materiais.** Página (`--k-bg`), cromo sobre o mapa (`--k-surface`: grupos da barra, menus, chat, painel e
  ferramentas do editor, zoom, janelas laterais, tooltips) e cartão de cena ou diálogo (`--k-card`: nome, Woka,
  configurações). O WorkAdventure pinta o cromo com `bg-contrast/50`, `/80` e `/90`; antes o tema cobria só a barra
  (`#020112`), e o chat, o editor, o zoom e os menus ficavam em marinho translúcido. Uma regra (seção 5) cobre todos, e o
  `--check` reprova se houver mais de uma cor (`surface_failures`).
- **Nada abre do nada** (seção 12, o contrato de movimento do platform: `globals.css` `--animate-*`, `lib/menu-motion.ts`,
  `ui/sheet.tsx`, `ui/dialog.tsx`). Menu: recorte a partir do ponto que o abriu, 200 ms (`menu-morph-in`; recorte e não
  escala, para o texto não borrar). Painel lateral (chat, editor, janela lateral): desliza da borda, 300 ms ease-out-quint.
  Diálogo (configurações, janela central): fade e 95 a 100%, 300 ms. Tooltip, véu e coluna de ferramentas do editor: fade,
  200 ms. O WA remove esses elementos de uma vez, então a saída por CSS não é possível e fica instantânea. Modo de
  preenchimento `backwards`: depois da entrada não sobra `transform` (viraria o bloco de contenção dos elementos fixos de
  dentro do painel) nem `clip-path` (cortaria um submenu). Os tooltips do zoom voavam 240 px animando `right` (um layout
  por quadro); agora só a opacidade transiciona. O `--check` confere a animação de cada superfície aberta (`MOTION`).
- **Geometria da barra, uma regra só** (seção 5 do `theme.css`, conferida pelo `--check` em `bar_failures`). Superfícies
  separadas ficam a 8 px umas das outras e só se emendam dentro de um grupo do WorkAdventure (chat e pessoas, reações e
  apps, microfone e câmera). O conteúdo fica tão longe das bordas laterais quanto o ícone fica do topo: 16 px na barra
  compacta e 20 px na grande (container `actions` abaixo de 640 px ou a partir de 1280 px, os `@sm`/`@xl` do Tailwind do
  WorkAdventure). Dentro de um grupo, de um ícone ao outro, 24 px ou 32 px. Hover com 8 px de raio (16 menos o recuo de
  8 px), rótulos em 600 (o botão do platform). Cada botão do script (Guia da Koru, Som ambiente, Avisos) é uma pílula
  própria de 16 px de raio (U2). Antes, o WorkAdventure separava o lado direito com `ps-2`/`pe-2` no Mapa, `me-*` no
  último botão do script e `gap-1` a `gap-4` conforme o tamanho, e deixava os botões com rótulo encolherem: o conteúdo
  vazava do padding (Avisos ficava a 8 px de uma borda e 12 px da outra). Agora os botões não encolhem e o que não cabe
  sai pela esquerda, onde o `VisibilityChecker.svelte` já o leva para o menu. O teste também confere o raio de toda
  superfície (só 0 px nas emendas e 16 px nas pontas); a aba do chevron do microfone (`rounded-b`, 8 px) é apêndice e fica fora.
- **Menu do perfil no contrato de menu do platform** (`konclui-platform/packages/ui/src/lib/menu-surface.ts`: `MENU_PANEL`,
  `MENU_ROW_BASE`, `MENU_LABEL`; conferido em `menu_failures`). Painel com 6 px de padding, linhas de 44 px com 6 px de
  raio, 10 px nas laterais e 8 px entre ícone e texto, uma coluna de ícone de 24 px para todo rótulo começar no mesmo x
  (a bolinha do status fica centrada nela), texto do item em 400 e rótulo de seção em 12 px, caixa alta, 500. O
  WorkAdventure misturava linhas de status de 25 px em 400 com as demais de 40 px mais 4 px de margem em negrito.
- **Acento e semântica.** Menta `#53FFC8` no primário e no botão ativo da barra, texto `#1A1F1E`. Perigo `#C62F26`
  (branco sobre ele: 5,47:1). Verde `#10B981` só em "ao vivo" (compartilhar tela), com ícone escuro. As variáveis HSL do
  WorkAdventure (`--secondary-*`, `--contrast-*`, `--danger-*`, `--success-*`) são sobrescritas em `html:root`, que vence o
  `:root` que o servidor escreve depois do `<body>`.
- **Uma ajuda só.** O item "Ajuda e dicas" do menu do perfil some (`ProfileMenuContent.svelte:248`); o Guia da Koru fica.
  A aba "Ajuda e tutoriais" das configurações some pela posição (4ª e última, `Menu.svelte:176`), porque só tem texto: se
  um dia o mapa acrescentar abas, a regra deixa de casar e nada some por engano.
- **Controles do modal lateral abaixo da barra.** Em modal à direita ou à esquerda (telas largas), o WorkAdventure pendura a caixa
  de expandir e fechar ao lado do painel em `top-0`, em cima da barra (`Modal.svelte:74`). O tema a desce para `top: 96px`
  (barra termina em 80 px). Em modal de celular ou tela cheia o painel cobre a barra e os controles ficam em `top-4 right-4`,
  longe do "Fechar" que fica no canto esquerdo da página da Koru. O `--check` mede as caixas e reprova sobreposição com superfície
  de barra visível ou com esse "Fechar".
- **Sem desfoque, sem sombra animada.** `backdrop-filter` e `filter: blur` zerados em todo o app; superfícies da barra,
  menus, modais e chat opacas; só `transform` e `opacity` animam.
- **Cascata.** As utilities do Tailwind v4 ficam em `@layer`, então regra sem camada vence sem `!important`. O `!important`
  só aparece onde o WorkAdventure escreve estilo direto (`background-color` do fundo da entrada, do carregador e da tela
  de erro, `width` do logo da entrada) ou usa `!` em utilitário (`md:!mt-[15vh]` no Woka, que o tema contorna pelo
  invólucro em vez de brigar).

## Textos oficiais (tabela da errata) e o que o CSS alcança

| Lugar | Texto | Como |
|---|---|---|
| Abertura | "Abrindo o escritório da Koncluí" | `boot.html` |
| Carregador | "Entrando no escritório da Koncluí" | troca de texto no script do `boot.html` |
| Depois de 8 s | "Primeira visita demora um pouco mais: o escritório baixa cerca de 4 MB." | `animation-delay: 8s` no `boot.html` |
| Tela de erro | "Não conseguimos abrir o escritório" | título trocado por `::after` (texto original escondido com `visibility`); o título de reconexão fica como está |
| Personagens, peças e mascotes padrão do WorkAdventure | seções por tipo ("Tons de pele", "Curtos", "Cachorros"...), sem a antiga seção única "Clássicos" | `avatars/sections.json` gera `admin-api/woka.json` e `companions.json` (`python3 avatars/sections.py`); continuam todos disponíveis (testes `test_should_keep_every_default_workadventure_character_when_woka_list_is_requested`, `tests/test_avatar_sections.py` e `tests/avatar_bridge.test.mjs`) |
| Nome vazio, ajuda, exemplo, "Avisos (2)" | n/d | **não dá por CSS**: vêm de tradução, dado do mapa ou script do mapa (Onda 1) |

## Contrato de seletores (ao vivo, 360 / 768 / 1440)

Contagem de elementos que cada seletor acha no DOM real, depois do tema. A coluna "Origem" é o componente do WorkAdventure
(`play/src/front/Components/...`, v1.34.1). Em 360 o botão "pessoas" do grupo esquerdo fica fora (abaixo de `@sm`), por isso o
mínimo daquela linha é 1.

| Tela | Elemento | Seletor | Origem | 360 / 768 / 1440 |
|---|---|---|---|---|
| entry-empty | entry form | `form.loginScene` | LoginScene.svelte:112 | 1 / 1 / 1 |
| entry-empty | entry logo | `.main-logo` | LoginScene.svelte:104 | 1 / 1 / 1 |
| entry-empty | name input | `input[data-testid="loginSceneNameInput"]` | LoginScene.svelte:129 | 1 / 1 / 1 |
| entry-empty | primary button | `.btn.btn-secondary.loginSceneFormSubmit` | LoginScene.svelte:155 | 1 / 1 / 1 |
| entry-empty | backdrop image (mapa de exemplo do motor → azul-marinho com aurora no acento, 21/10/2026) | `form.loginScene ~ div.bg-cover` | LoginScene.svelte:176 | 1 / 1 / 1 |
| entry-empty | backdrop overlay | `form.loginScene ~ div.bg-contrast.opacity-80` | LoginScene.svelte:177 | 1 / 1 / 1 | (opacidade 0 desde 21/10/2026)
| entry-error | error text | `.loginScene p.err` | LoginScene.svelte:141 | 1 / 1 / 1 |
| entry-error | invalid input | `input.border-danger` | LoginScene.svelte:136 | 1 / 1 / 1 |
| woka | outer container | `.mobile-webkit.bg-contrast` | WokaSelectScene.svelte:205 | 1 / 1 / 1 |
| woka | card | `.mobile-webkit.rounded-lg` | WokaSelectScene.svelte:207 | 1 / 1 / 1 |
| woka | preview tile | `.woka-preview > div` | WokaSelectScene.svelte:215 | 1 / 1 / 1 |
| woka | woka tiles | `button[id^="woka-"]` | WokaSelectScene.svelte:262 | 24 / 24 / 24 |
| woka | selected tile | `button[id^="woka-"].border-white` | WokaSelectScene.svelte:262 | 1 / 1 / 1 |
| woka | collection label | `.mobile-webkit p.text-gray-500` | WokaSelectScene.svelte:257 | 1 / 1 / 1 |
| woka | randomize button | `.btn.btn-light.btn-border` | WokaSelectScene.svelte:228 | 1 / 1 / 1 |
| woka | customize button | `.mobile-webkit button.bg-white\/10:not([id]):not([aria-label])` | WokaSelectScene.svelte:290 | 1 / 1 / 1 |
| woka | continue button | `.mobile-webkit .selectCharacterSceneFormSubmit` | WokaSelectScene.svelte:294 | 1 / 1 / 1 |
| woka-customize | tabs | `button.capitalize.border-b-2` | WokaCustomizeScene.svelte:316 | 12 / 12 / 12 |
| woka-customize | texture tiles | `button[id^="texture-"]` | WokaCustomizeScene.svelte:370 | 33 / 33 / 33 |
| loader | logo | `.z-50.h-dvh.w-dvw img[alt="Logo loading screen"]` | LoaderScene.svelte:27 | 1 / 1 / 1 |
| loader | bar track | `.z-50.h-dvh.w-dvw .w-full.h-3.bg-contrast` | LoaderScene.svelte:29 | 1 / 1 / 1 |
| loader | bar fill (hidden) | `.z-50.h-dvh.w-dvw .w-full.h-3.bg-contrast > div` | LoaderScene.svelte:30 | 1 / 1 / 1 |
| loader | text column | `.z-50.h-dvh.w-dvw .flex-col.items-center` | LoaderScene.svelte:20 | 1 / 1 / 1 |
| loader | dim layer | `.z-50.h-dvh.w-dvw > .z-20` | LoaderScene.svelte:39 | 1 / 1 / 1 |
| koru | modal container | `.menu-container` | Modal.svelte:67 | 1 / 1 / 1 |
| koru | modal panel | `.menu-container > .w-full.h-full` | Modal.svelte:72 | 1 / 1 / 1 |
| koru | close parent (opacity-25) | `.menu-container div:has(> [data-testid="close-modal-button"])` | Modal.svelte:74 | 1 / 1 / 1 |
| koru | close button | `button.btn[data-testid="close-modal-button"]` | Modal.svelte:108 | 1 / 1 / 1 |
| hud | action bar root | `.bp-menu` | ResponsiveActionBar.svelte:99 | 1 / 1 / 1 |
| hud | bar surfaces | `.bp-menu .bg-contrast\/80` | ActionBarButton.svelte:101, MapSubMenu.svelte:54, ProfileMenu.svelte:76 | 11 / 12 / 12 |
| hud | left group buttons | `[data-testid="chat-action"] button` | ActionBar.svelte:53 | 1 / 2 / 2 |
| hud | reactions and apps | `:is([data-testid="emoji-btn"],[data-testid="apps-button"])` | ActionBar.svelte:78 | 2 / 2 / 2 |
| hud | mic and camera | `:is([data-testid="microphone-button"],[data-testid="camera-button"])` | ActionBar.svelte:66-141 | 2 / 2 / 2 |
| hud | hardware group | `.group\/hardware` | ActionBar.svelte:66 | 1 / 1 / 1 |
| hud | script buttons | `#action-wrapper .group\/visibilitychecker > .relative` | ActionBar.svelte:143-148, MenuStore.ts:372 | 4 / 4 / 4 |
| hud | off state (danger) | `.bp-menu button.bg-danger` | ActionBarButton.svelte:118 | 2 / 2 / 2 |
| hud | map menu | `[data-testid="map-menu"]` | MapSubMenu.svelte:46 | 1 / 1 / 1 |
| hud | profile card | `[data-testid="action-user"]` | ProfileMenu.svelte:69 | 1 / 1 / 1 |
| profile-menu | menu | `[data-testid="profile-menu"]` | ProfileMenuContent.svelte:156 | 1 / 1 / 1 |
| profile-menu | status items | `[data-testid="profile-menu"] .status-button` | ProfileMenuContent.svelte:157 | 4 / 4 / 4 |
| profile-menu | section headers | `[data-testid="profile-menu"] .text-xxs` | HeaderMenuItem.svelte:9 | 5 / 3 / 3 |
| profile-menu | help entry (hidden) | `[data-testid="profile-menu"] button:has(path[d^="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0m9 4v.01"])` | ProfileMenuContent.svelte:248 | 1 / 1 / 1 |
| settings | nav | `.menu-nav-sidebar` | Menu.svelte:161 | 1 / 1 / 1 |
| settings | content | `.menu-submenu-container` | Menu.svelte:226 | 1 / 1 / 1 |
| settings | nav items | `.menu-item-container` | Menu.svelte:186 | 4 / 4 / 4 |
| settings | help tab (hidden) | `.menu-nav-sidebar nav > div:nth-child(4):last-child` | Menu.svelte:176 | 1 / 1 / 1 |
| chat | chat panel | `section#chat.chatWindow` | Chat/Components/ChatLoader.svelte, style/chat.css | 1 / 1 / 1 |
| error | error screen | `main.errorScreen` | ErrorScreen.svelte:60 | 1 / 1 / 1 |
| error | login logo (hidden) | `main.errorScreen .logo` | ErrorScreen.svelte:70 | 1 / 1 / 1 |
| error | error logo | `main.errorScreen .icon img` | ErrorScreen.svelte:82 | 1 / 1 / 1 |
| error | title | `main.errorScreen h2` | ErrorScreen.svelte:88 | 1 / 1 / 1 |
| error | code line | `main.errorScreen p.code` | ErrorScreen.svelte:92 | 1 / 1 / 1 |

## Contraste medido no DOM ao vivo

Cor computada do texto (ou do ícone) contra o fundo efetivo, em 360 / 768 / 1440. Mínimos: texto 4,5:1, ícone 3:1. Estados que o
WorkAdventure só mostra em uso (ativo `bg-secondary`, ao vivo `bg-success`) foram medidos pondo a mesma classe que o
WorkAdventure põe, num botão real, e tirando em seguida. O pulso do carregador é decorativo (o texto leva a informação) e
fica fora dos pares. Além dos pares, o teste varre todo texto visível de cada tela: nenhuma reprovação com fundo resolvido.

| Tela | Par | Medida (1440) | Razão 360 / 768 / 1440 | Mínimo |
|---|---|---|---|---|
| entry-empty | primary button (entry) | #1a1f1e sobre #53ffc8 | 13.11 / 13.11 / 13.11 | 4.5 |
| entry-empty | name input text | #f0f5fb sobre #0e2236 | 14.73 / 14.73 / 14.73 | 4.5 |
| entry-empty | placeholder | #98a3b3 sobre #0e2236 | 6.32 / 6.32 / 6.32 | 4.5 |
| entry-empty | input border vs card | #53ffc8 sobre #03051a | 15.86 / 15.86 / 15.86 | 3.0 |
| entry-error | error text | #e8594e sobre #03051a | 5.74 / 5.74 / 5.74 | 4.5 |
| woka | primary button (woka) | #1a1f1e sobre #53ffc8 | 13.11 / 13.11 / 13.11 | 4.5 |
| woka | customize button | #f0f5fb sobre #0e2236 | 14.73 / 14.73 / 14.73 | 4.5 |
| woka | collection label | #98a3b3 sobre #0e2236 | 6.32 / 6.32 / 6.32 | 4.5 |
| woka | selected tile border | #53ffc8 sobre #0e2236 | 12.69 / 12.69 / 12.69 | 3.0 |
| woka-customize | inactive tab | #b4bdcc sobre #0e2236 | 8.53 / 8.53 / 8.53 | 4.5 |
| loader | status text | #98a3b3 sobre #03051a | 7.9 / 7.9 / 7.9 | 4.5 |
| koru | modal close icon | #f0f5fb sobre #0e2236 | 14.73 / 14.73 / 14.73 | 3.0 |
| hud | bar icon idle | #ffffff sobre #020112 | 20.68 / 20.68 / 20.68 | 3.0 |
| hud | bar icon off (danger) | #ffffff sobre #c62f26 | 5.47 / 5.47 / 5.47 | 3.0 |
| hud | bar icon active (synthetic bg-secondary) | #1a1f1e sobre #53ffc8 | 13.11 / 13.11 / 13.11 | 3.0 |
| hud | bar icon live (synthetic bg-success) | #1a1f1e sobre #10b981 | 6.58 / 6.58 / 6.58 | 3.0 |
| hud | script button text | #f0f5fb sobre #020112 | 18.86 / 18.86 / 18.86 | 4.5 |
| hud | map menu text | #f0f5fb sobre #020112 | 18.86 / 18.86 / 18.86 | 4.5 |
| hud | profile name | #f0f5fb sobre #020112 | 18.86 / 11.77 / 18.86 | 4.5 |
| profile-menu | menu item | #f0f5fb sobre #0e2236 | 14.73 / 14.73 / 14.73 | 4.5 |
| profile-menu | section header | #98a3b3 sobre #0e2236 | 6.32 / 6.32 / 6.32 | 4.5 |
| profile-menu | chosen status | #f0f5fb sobre #0e2236 | 14.73 / 14.73 / 14.73 | 4.5 |
| settings | nav item inactive | #b4bdcc sobre #0e2236 | 8.53 / 8.53 / 8.53 | 4.5 |
| settings | nav item active | #f0f5fb sobre #182c41 | 12.99 / 12.99 / 12.99 | 4.5 |
| chat | chat title | #ffffff sobre #0e2236 | 16.14 / 16.14 / 16.14 | 4.5 |
| error | title | #f0f5fb sobre #03051a | 18.41 / 18.41 / 18.41 | 4.5 |
| error | subtitle | #b4bdcc sobre #03051a | 10.66 / 10.66 / 10.66 | 4.5 |
| error | code line | #98a3b3 sobre #03051a | 7.9 / 7.9 / 7.9 | 4.5 |

## Anel de foco

`:focus-visible` desenha contorno de 2 px na cor do acento com 2 px de afastamento (`outline` sobrevive a pais com
`overflow:hidden`, e o WorkAdventure põe `outline-none` em quase tudo). Medido por `Tab` na entrada (campo e botão) e no HUD
(chat, pessoas, reações, apps, microfone, câmera e os três botões do script): 2 px de largura e razão contra a superfície de
13,6:1 a 16,25:1 em todos. Exemplos: `after-1440-focus-entry-1.png`, `after-1440-focus-hud-1.png`, `after-1440-focus-hud-4.png`.
Fora do alcance de `Tab` (não são focáveis no WorkAdventure, achados A06 e A07): o cartão do perfil, o menu Mapa e os botões
do canto (zoom, explorar).

**Correção do verificador, 11/11/2026:** o check de entrada preenchia o nome depois de clicar em Continuar e media
o anel sem voltar ao teclado. Desde a regra de modalidade do HUD (18/10), `data-k-input="pointer"` oculta o contorno
por decisão do dono; o diagnóstico de CSS defeituoso era um falso positivo. A inspeção das regras realmente aplicadas
confirmou `moment-hud.css`: `outline: none !important` apenas no modo ponteiro. O teste agora usa Tab e Shift+Tab,
confere que voltou ao campo e só então mede o anel do campo e do botão. Não se deve remover a regra do produto nem
forçar `data-k-input` pelo teste: a prova deve passar pelo teclado real. Resultados desta rodada e limites do check
da barra estão no [registro da v1.34.5](../docs/plans/20261111-wa-1.34.5-fast-client.md#continuação-local--11112026).

## Movimento (escada do `motion.md`, uma família de curva)

Curva `cubic-bezier(.16,1,.3,1)` (ease-out-expo do platform) em tudo, e `cubic-bezier(.22,1,.36,1)` (ease-out-quint) nos
painéis laterais; `transform` e `opacity`, e `clip-path` só na abertura dos menus, como no platform.

A logo do boot é montada por quatro `<svg>` empilhados (haste, perna e pé do K, e "oncluí"), um por peça, para que cada
movimento seja uma camada do compositor: na abertura a thread principal está compilando o app. Medido em 2026-10-11 com a
thread principal travada por 450 ms no meio da montagem: zero pinturas e 25 quadros desenhados na janela, igual ao fade
antigo. Cada peça tem o seu `@keyframes`: com `var()` nos quadros-chave o Chrome deixou de passar a animação ao
compositor e caiu para 13 quadros na mesma janela. O menu do perfil abre e fecha sem animação (medido: transição de 0 s),
o certo para algo aberto dezenas de vezes por dia.

| Peça | Duração | Observação |
|---|---|---|
| Logo do boot, montagem | haste do K 360 ms, perna 360 ms com 60 ms de atraso, pé 320 ms com 120 ms, "oncluí" 420 ms com 180 ms (termina em 600 ms) | cada peça sobe 3 a 6 px com opacidade de 0 a 1, o conjunto fica em 0,8; no movimento reduzido, parado |
| Pressão (botões, barra, Mapa, cartão do perfil) | 160 ms, `scale(.97)` | a transição mora no estado de repouso: soltar também é suave |
| Texto e trilho do boot | 280 ms, atraso 600 ms | trilho pulsa 0,35 a 0,75 em 3200 ms |
| Aviso das 8 s | 280 ms, atraso 8 s | no movimento reduzido aparece sem fade |
| Saída e volta do boot | 200 ms, ease-out-expo, opacidade | `display:none` no fim do estado `done`, o pulso para |
| Menu (perfil, Mapa, mídia, reações, apps) | 200 ms, recorte a partir do botão | sem sombra: o recorte a cortaria |
| Painel lateral (chat, editor, janela lateral) | 300 ms, ease-out-quint, `translateX` | véu da janela: fade 200 ms |
| Diálogo (configurações, janela central) | 300 ms, fade e `scale(.95)` | |
| Tooltip (cartão de ajuda da barra, editor, zoom) | 200 ms, fade | os do zoom não voam mais |
| Tela de nome | 200 ms, 400 e 440 ms de atraso | termina em 640 ms depois do início da saída |
| Cartão do Woka | 280 ms | |

Movimento reduzido e Leve (`html.k-leve`, classe que o script do mapa porá depois): `animation-duration` e
`transition-duration` caem para 0,01 ms, atraso zero, uma iteração; o estado final é o mesmo. Medido: com
`prefers-reduced-motion`, o boot mostra o logo em 0,8, o texto em 1 e o trilho em 0,55 desde o primeiro quadro, zero animações
infinitas, o boot em `display:none` quando a tela de nome chega e a entrada em 1e-05 s; com `html.k-leve`, a entrada passa de 0,2 s para 1e-05 s.

Quadros do boot (`--boot`, animações varridas em tempos exatos): `after-<vp>-boot-0000ms`, `-0300ms`, `-0600ms`, `-8300ms`,
`-exit-000ms` a `-exit-560ms` e `-entry`; antes: `before-<vp>-boot-0300ms`, `-1500ms`, `-4000ms`, `-entry`.
`before-<vp>-loader.png` e `after-<vp>-loader.png` foram renderizados do snapshot do DOM real do carregador (com cache quente ele sai
em menos de 1 s, e a captura ao vivo pegava só o fundo ou o logo em fade). O `--check` mede o carregador logo que ele aparece.

## O que o CSS não alcança

- Canvas do Phaser: contorno e nomes dos personagens, bolhas, círculo de proximidade, arte do mapa.
- Conteúdo de iframes do mapa (Guia da Koru, Avisos): é página nossa.
- Texto vindo de tradução ou dado: "default" da coleção de personagens, nomes das abas do personalizador ("Body", "Eyes"),
  "Woka", subtítulo e linha de detalhe da tela de erro em inglês, "Reportar um problema".
- Controles sem teclado (cartão do perfil, menu Mapa, zoom) e botões só de ícone sem nome acessível: Onda 3.
- Tela de erro sem botão de recuperação para o erro `NETWORK_ERROR`: o botão não existe no DOM, CSS não cria ação.
- Estado "bloqueado pelo navegador" do microfone e da câmera (selo e risco animado): troca o componente de ícone, só por fork.
- Hover e estados desabilitados não foram medidos controle a controle; o teste cobre repouso, foco, ativo, desligado e ao vivo.

## Atualizar o WorkAdventure

Os seletores dependem das classes do v1.34.1. A cada atualização, rodar `python3 tests/theme_preview.py --check`: um seletor que
deixa de casar reprova com o nome do componente e a linha de origem nesta tabela.

## Abertura no WA local e convite — pedido do dono, 13/10/2026

O escritório local estava usando o HTML original do motor, sem o `boot.html` do tema. A restauração reutiliza esse arquivo, sem duplicar o logo nem criar outro controlador de estados. `local-shell.css` acrescenta apenas a fonte local, a supressão dos visuais concorrentes do carregador nativo enquanto `#kboot` existe e a remoção do convite da barra. Não liga o restante do tema por consequência.

O botão **Compartilhar** da barra é o convite da sala: no DOM da1.34.1 ele não tem `data-testid`, mas contém `svg.icon-tabler-share`. A regra esconde também o wrapper `group/visibilitychecker`, evitando uma pílula vazia. O botão de apresentação é `screenShareButton`, distinto, e permanece disponível. Não selecionar controles pela palavra “compartilhar” de forma genérica.

O gateway local, mantido pelo dono de hot reload, deve inserir a folha no head e o conteúdo de `boot.html` antes do fechamento do body, uma vez por documento do motor. O boot precisa continuar irmão de `#app`; não inserir seu div no head nem em páginas internas dos iframes. `/konclui-theme/fonts/urbanist-latin.woff2` usa o arquivo existente. O HUD automático tem dono e módulo próprios (`hud.js`/`hud.css`), preservados.

Verificação local: `python3 local-wa/check_shell.py` — abertura antes do bundle, saída para nome/avatar, conclusão sem reiniciar o boot, fonte local, convite oculto sem espaço vazio em360/768/1440, apresentação disponível numa conversa com câmera sintética e movimento reduzido. Contextos são descartados, mídia física e produção ficam bloqueadas. Integração servida e resultado ficam em `local-wa/evidence/shell/report.json`; não inferir aprovação antes do teste. Produção só muda mediante autorização de deploy.

**Resultado local,13/10/2026,13:01:** seis verificações nativas aprovadas no gateway servido. Sequência observada `boot → input → loading → done`, uma abertura só; fonte200; convite e seu espaço ocultos nas três larguras; botão nativo de apresentação visível e acessível por teclado na conversa; movimento reduzido respeitado. `tests/theme_preview.py --check` terminou com zero falhas, usando a rota histórica documentada, sem alterações em produção. Dois erros do verificador foram corrigidos sem alterar o boot: aguardar a saída200ms existente e executar a função que registra os estados. Os relatórios iniciais ficam junto da prova para não esconder essas correções.


## Controles recolhidos por borda — pedido do dono, 13/10/2026

`hud.js` e `hud.css` acrescentam recolhimento independente à interface nativa do WA1.34.1: conversa pela esquerda, mídia/reações pelo topo (pela base quando o motor os coloca embaixo no celular), mapa/perfil pela direita e navegação inferior pela base. A faixa de aproximação é de32px; a entrada começa no próximo quadro, com transição de200ms. A saída espera1s fora da região. Abas de44px continuam disponíveis por toque e teclado. Na primeira visita os controles ficam abertos por5s e mostram uma dica; após usar uma borda/aba a dica deixa de aparecer. Armazenamento bloqueado não impede a interação.

O grupo fica aberto durante hover, foco de teclado, uso por toque ou menu/painel nativo aberto. Tocar fora solta a abertura por toque. Controles recolhidos ficam `inert`; Tab alcança as abas, Enter abre o grupo e leva ao primeiro controle visível. Mapa, perfil, configurações de mídia e navegação recebem semântica de botão e ativação por teclado sem substituir seus handlers. Enter/Espaço são interceptados somente com foco nesses controles, preservando os atalhos do mapa fora deles. Movimento reduzido desliga o deslocamento animado. Avisos de erro e reconexão não são selecionados pelo módulo.

Microfone/câmera habilitados e apresentação ativa mantêm um botão compacto para desligar, derivado do estado visual nativo (não atesta captura física ou entrega de mídia). A ação revalida o estado antes de acionar o botão original; um indicador antigo não pode religar a mídia. O módulo não chama APIs de captura, não cria fluxos e não escreve no mapa.

**Integração local:** `local-dev.html` contém as tags do HUD, da visão por momento (seção seguinte) e dos shaders da
sede (`fx/fx.mjs`, módulo ES; documentados em `hq-office/README.md`, seção "Shaders"; o gateway serve `.mjs` desde
20/10/2026). O gateway mantido por `local-wa/dev.py` serve os arquivos em `/konclui-theme/` e lê esse fragmento a cada documento do motor. Recarregar a própria página recebe a mudança; não requer carga de mapa nem reinício do motor. O fragmento é independente de `local-shell.css`/`boot.html` e não ativa o tema completo. A configuração nginx de produção não foi alterada nem houve deploy.

**Aprendizados:** mover `#action-wrapper` inteiro dispara o `IntersectionObserver` do WA e pode transferir botões para o menu compacto; mover apenas as superfícies preserva as caixas nativas. Handlers de teclado apenas no alvo não bastam: Enter é capturado pelo motor e abre o chat; a interceptação limitada na fase de captura permite alcançar o menu com teclado. Ao entrar em iframe do mapa, limpar o último hover evita manter a barra aberta com uma coordenada antiga. A falta da folha de estilo deve deixar os controles nativos utilizáveis: o script exige a marca CSS antes de ativar `inert`.

Verificação: `python3 -m unittest tests.test_hud -v` (contratos de navegador isolados) e `python3 local-wa/check_hud.py` (desktop/celular no WA local, sem câmera/microfone físicos, produção, edição de mapa ou clique no canvas). Cada rodada nativa mantém relatório, capturas e hashes próprios em `local-wa/evidence/hud/<timestamp>/`; `--scenario desktop|mobile` permite repetir somente o cenário afetado após diagnóstico. As falhas iniciais permanecem registradas; o teste do tema completo continua sendo `python3 tests/theme_preview.py --check` e não substitui a prova nativa do HUD.

**Prova local atual (13/10/2026):**12 testes de contrato aprovados;18 verificações nativas aprovadas (desktop10, celular8), sem erros de página. Relatório e hashes: [`20261013T160832Z/report.json`](../local-wa/evidence/hud/20261013T160832Z/report.json). O JS/CSS servido coincide com os arquivos testados. Capturas de recolhimento, toque, menu e foco foram revisadas; a borda de foco fica para dentro do controle para não ser cortada pelo overflow nativo. O estado/atalho de desligar mídia foi validado com estados sintéticos dos controles, sem captura física nem alegação de entrega audiovisual. Nenhum override ou check desabilitado permanece no produto.

Diagnóstico `microinteractions`: **10/10 (8/8 critérios)** na revisão do comportamento especificado e dos contratos testados: gatilho visível, estado indicado, regras previsíveis, resposta iniciada no próximo quadro, movimento proporcional, dica progressiva, ausência de modo oculto e alternativa explícita por aba. Falhas descobertas na prova nativa — Enter abrindo o chat, hover preso no iframe e recorte do foco — foram corrigidas com evidência preservada. Essa nota não constitui pesquisa com usuários.

**Check geral do tema:** aprovado nas quatro larguras com `KONCLUI_ROOM=https://work.konclui.com/~/campus/escritorio.wam python3 tests/theme_preview.py --check` (exit0). A primeira execução no padrão `office.wam` não alcançou a barra porque esse arquivo ainda responde404; `README.md` §migração documenta o endereço publicado antigo, conferido200 antes da repetição. Nenhum caminho de produção foi alterado. Consolidação da entrega: [`acceptance.json`](../local-wa/evidence/hud/acceptance.json). Esse check protege o tema existente; a prova do novo HUD é a rodada local acima.

## Interface por momento — pedido do dono, 18/10/2026

`moment-hud.js` e `moment-hud.css` são a visão da interface da opção 11 de `design/ux/2026-10-18-hud-10/` (momento e
mapa de pessoas). Ficam adormecidos em toda sala até que o script do mapa os chame. Hoje só o Escritório Sede faz isso
(`hq-office/runtime/hud.mjs`, protocolo e comportamento em `hq-office/README.md` §Interface).

**Quando acordam:**
- encaixam a barra nativa embaixo, com a mesma inversão de coluna que o WorkAdventure usa no celular, e a desenham
  como dock (a partir de 768 px): uma superfície centralizada, com os botões de texto do escritório como ícones. A
  linha da barra mantém a largura nativa (o WA grava a largura livre como estilo inline na metade direita, e a
  largura do conteúdo entrava num ciclo); as metades são escolhidas por posição, porque o WA troca as classes delas;
- carregam `theme.css`;
- marcam `html[data-khud-mode="docked"]`, e com isso `hud.js` mantém os grupos abertos e esconde abas e dica;
- desenham chip do lugar, pílula, mapa, chip de foco e rótulo da conversa.

Os avisos de ação do WorkAdventure ganham a tecla desenhada.

**Regras herdadas do HUD:**
- Enter e Espaço são engolidos no próprio layer, em `keydown`, `keypress` e `keyup`, com o listener registrado ao
  carregar. Sem isso, o `keyup` do Enter abre o balão de fala.
- Os nomes de outros visitantes entram só como texto.
- O movimento reduzido desliga as animações.

**Verificação:** `python3 hq-office/qa_hud.py` (11 verificações no motor local). `tests.test_hud` e
`local-wa/check_hud.py` continuam provando o recolhimento nas salas sem o protocolo. Em 18/10, 12/12 e o check nativo
passaram com o `hud.js` novo, e o hash servido é o do arquivo.

## Layout do escritório de referência — pedido do dono, 18/10/2026

Na sala de trabalho do Escritório Sede, `konclui-office` (e na `escritorio-sede-hud`, seu nome até 21/10/2026 e o da
sala de produção), `moment-hud.js` liga
`html.kmh-g` e desenha o layout do Gather: trilho com engrenagem de configurações, painel de pessoas, mapa em cartão,
dock em ordem, barra da direita, minimapa, modos de visualização e economia de bateria. A `escritorio-sede`, congelada,
fica com a interface por momento.
Comportamento e verificação: `hq-office/README.md` §Interface no estilo do escritório de referência.

**Sistema de design:** tudo sai dos tokens do `theme.css`.
- Raios: superfície 16, botão, campo e menu 12, botão pequeno e elemento interno 8, linha 6, pílula 9999.
- Sombra: só `--k-shadow`, e só onde a superfície fica sobre o mapa.
- Texto: título 700 20/1.25, rótulo 600 14, corpo 500 14/1.3, parágrafo 500 13/1.5, apoio 12/1.5.
- Ícones: 18 px no dock e na barra da direita (botões de 36 px), 22 px no trilho e 16 px ao lado de texto, todos com
  traço de 1,8 no desenho de 24 (1,35 px na tela a 18 px), inclusive os do WA. O + e o − do zoom do WA vão a 21 px
  com o mesmo traço na tela: abertos, a 18 px pareciam menores que os vizinhos.
- Tamanhos de controle: dock 36 px, barra da direita e editor de mapa 30 px (como no Gather), trilho 36 px.
- Estados do dock, um sistema só sobre os estados do próprio WA (dono, 19/10/2026: "padronizar a cor, hover, ativo"):
  repouso no ladrilho (branco a 7%), hover a 13%; ligado (`bg-secondary`/`bg-success` do WA: reações ou conversa
  abertas, seguir, mão levantada, compartilhar) em menta, `rgba(83,255,200,.16)` com ícone em menta, .24 no hover;
  proibido (`bg-danger`, como a conversa trancada) em vermelho a 16% com ícone vermelho, menos microfone e câmera, que
  ficam no ladrilho com o traço vermelho; desativado a 45%. A cor do ícone vai no `<svg>`, nunca em cada `path`: o
  quadro invisível de 24 px dos ícones (`stroke="none"`) aparecia como um quadrado que parecia anel de foco.
- Traços de mídia desligada, corrigidos em 11/11/2026: o vermelho `#ef4444` ficava abaixo de 3:1 em parte do
  microfone e da câmera sobre o dock. Duas capturas por controle, com o ícone presente e oculto, mediram mínimos
  de 2,97:1 e 2,84:1; o fundo não variou entre os pares. Os traços agora usam `#ff8a8a`, o vermelho claro já usado
  nos outros estados de perigo do HUD. O teste de navegador confere os dois ícones contra todo o intervalo de
  fundos do vidro aprovado. A alteração está no checkout local; este registro não declara publicação.
- Barra da direita e editor de mapa: hover branco a 10%; aberto ("⋯") em menta, como o ligado do dock.
- Câmeras do topo num tamanho só (20/10/2026: "Padronize o tamanho disso aqui... Pra nunca ficar desse tamanho a não ser
  que a pessoa queira"): o WA mostra uma linha enquanto você anda e troca por uma grade, com alça, 10 s depois de parar.
  A altura da grade sai de `cameraContainerHeight` no navegador, que guardava o último arrasto para sempre (um print
  do dono com o próprio quadro a 74 % da tela). O HUD apaga a chave ao abrir a página e ao fim de cada conversa: toda
  conversa começa no padrão do WA (um quinto da tela), que é o mesmo quadro da linha; arrastar vale até a conversa
  acabar. Na grade encolhida o quadro segue a altura a 16:9 em vez de cortar o nome; na linha fica a largura do
  próprio WA. Um arrasto que deixa o quadro menor que o padrão também vale andando (20/10/2026: "Eu arrastei pra cima
  pra ficar pequeno... quando fui caminhar, ele aumenta sozinho"): a linha tem tamanho próprio e cresce, então o HUD
  limita os quadros da linha à altura que o arrasto deixou (`html.kmh-cam-capped` e `--kmh-cam-h`) até a conversa
  acabar. Um arrasto para maior continua cedendo à linha ao andar, como no WA. Os cantos têm um raio só, 12 px: o WA
  arredondava as camadas de dentro a 16 px dentro do recorte de 12, e o mapa aparecia nas pontas. Checagem `cameras`
  do `qa_hud` (inclui encolher e andar).
- Modo simplificado como o do Gather (19/10/2026): uma planta em SVG no lugar do mapa ao vivo, montada dentro do cartão
  do jogo (acima do canvas, abaixo da interface do WA, então o dock e as câmeras ficam por cima). Salas e áreas vêm das
  áreas com nome do mapa (o `hud.mjs` as manda no estado) e ganham cor e ícone pelo nome; mesas são blocos com o assento
  em ponto, a sua em menta; pessoas são bolinhas com as iniciais, a sua com o nome em cima. Arrastar move, a roda e o
  + e − da coluna da direita aproximam, um clique marca o ponto e um clique duplo anda até lá (intenção `walk` do
  `hud.mjs`, pelo caminho do próprio WA), com "A caminho! · Cancelar" acima do dock.
- Configurações num modal como o do Gather (19/10/2026): o fundo do escritório escurece, as seções ficam à esquerda
  nas cores do menu do K e fecham no X, no Esc ou fora. O modo míni é o do WA (Document Picture-in-Picture: as câmeras
  e uma barra pequena numa janela por cima, abre ao sair da aba durante uma conversa); a chave grava
  `allowPictureInPicture`, que o WA lê a cada tentativa.
- Todas as configurações do WA dentro do modal, sem abrir outra tela (20/10/2026: "Termine de preencher todas as
  opções... Pense em todas as configurações que o WorkAdventure já possui"; "Portar tudo pra cá... sem precisar abrir
  outro"; organização do Gather):
  - **Seções:**
    - Geral: idioma, tela cheia, copiar o link, rever as dicas, "Sobre o escritório" (nome e créditos do mapa, como no
      "Sobre a sala" do WA).
    - Áudio e vídeo: câmera, microfone e alto-falante escolhidos ali, com prévia da câmera, medidor do microfone e teste
      do alto-falante; qualidade da câmera e da tela, internet lenta, redução de ruído (tipo e modelo), ganho, eco,
      ruído do navegador, câmera e microfone fora da aba, qualidade da conexão.
    - Sons: volumes de vozes, ambiente e sino; música do mapa; som da bolha, mensagens e sino. O volume de efeitos
      ganha controle quando algum efeito tiver som.
    - Notificações: do navegador, perguntar antes de abrir sites, recusar pedidos para seguir.
    - Modo míni.
    - Desempenho: modo de visualização, nível e chave de cada efeito (`theme/fx`), animações do mapa.
    - Pets: as opções que o runtime dos pets publica (`window.__kPets.settings()`, de `theme/pets`, outra frente) com os
      controles do modal; a aba some sem o runtime.
    - Atalhos.
    - Perfil: nome editado ali; avatar e companheiro pelos editores de `theme/hud-profile.js`, quando carregado. O
      companheiro tem o campo "Nome do pet" (`__kPets.name()`/`setName()`), salvo com o mesmo Salvar e sem recarregar.
  - **Como as opções do WA funcionam:** pela ponte `window.__kWa` do gateway (`local-wa/README.md`, "Ponte com o
    WorkAdventure"). Cada controle chama o mesmo que o painel do WA chama, as mesmas stores e as mesmas chaves gravadas,
    sem abrir tela nenhuma. Até 20/10/2026 o modal abria a tela do WA escondida e apertava os controles dela; fora do
    jogo, sem o dock para apertar, as opções sumiam (print do dono com Desempenho e Áudio e vídeo vazios).
  - **Sem a ponte** (página fora do gateway): as opções do WA somem e o atalho para a tela original aparece.
  - **Nome:** gravado como a tela de entrada do WA grava; o mapa reinicia uma vez para entrar com o nome novo, como
    depois da tela do WA.
  - **Prévia de câmera e microfone:** usa o fluxo do próprio WA quando a câmera ou o microfone estão ligados. Com os dois
    desligados, abre uma captura só enquanto a seção está aberta, como a tela de teste do WA fazia, e para ao fechar.
  - **Telas do WA** (entrada, avatar, companheiro, teste de câmera): ocupam a janela inteira, sem a interface por cima
    (`html.kmh-offstage`, depois de 600 ms sem o layout do jogo). Quando o mapa reinicia, a interface passa a falar com
    o script novo.
  - **Itens do menu de perfil:** o menu do WA fala a língua do navegador, então o HUD reconhece cada item pelo rótulo
    em inglês ou em português (`WA_LABELS`, textos do próprio WA). O idioma oferece só esses dois por isso.
  - **Checagem:** `settings` do `qa_hud`, com o navegador em pt-BR. Ela cobre a ponte, a leitura das opções, uma opção
    mantida ao reabrir, os dispositivos e os níveis Leve e Completo.
- Engrenagem de verdade no trilho (20/10/2026: "Substitua o ícone por uma engrenagem"): a "settings" do Lucide (ISC),
  no lugar de um sol de raios.
- Economia automática fora da tela (19/10/2026): com a aba escondida o navegador já para o desenho do WA
  (`requestAnimationFrame`); o HUD ainda põe o limite do `frame-cap` em 5. Com a janela visível sem foco por mais de
  3 s, 20 (o foco num iframe da própria página não conta). Ao voltar, a taxa cheia volta na hora, sem mudar nada à vista.
  No modo simplificado o limite é 5 (o canvas fica escondido). Checagem `away` do `qa_hud`.
- Dica "Clique duas vezes…": some depois de três caminhadas por clique duplo (`konclui.hud.walks` no navegador).
- Revisão de animação (12 princípios, 19/10/2026): entradas de itens em 240 ms, curvas da casa em toda transição,
  botões com `scale: .97` ao pressionar; os pontos do mapa seguem `linear` de propósito (interpolam posições que chegam
  em fluxo).
- Logo: o K do `avatars/logo.svg`, branco e de uma cor só (manual da marca §24).
- Foco: anel só no uso pelo teclado, em todas as salas. `moment-hud.js` guarda em `<html data-k-input>` se o foco
  veio do ponteiro ou do Tab, e com `pointer` nenhum anel é desenhado (nem os do Tailwind, que são sombras).
- Vidro: um gradiente escuro único; o topo é escuro o bastante para o texto secundário (`fg-2`) dar 5,6:1 sobre o chão
  mais claro do mapa visto através dele.

**Depende do gateway local:** `game-inset` (o jogo mede o cartão), `tile-click` (clique num bloco, trava
`data-k-tile-pick`) e `frame-cap` (`data-k-max-fps`). Sem eles, o layout funciona, mas o jogo ocupa a janela inteira
por baixo do painel, o clique anda como no WA e o economizador só desliga o movimento.

## Som pela distância, sino da venda e contrato de volume — pedidos do dono, 20/10/2026

Pedidos: "Os sons de ambiente de repente aparecem com volume total... Ir do volume 0 até o volume 100 do efeito";
"em configuração a gente pode modular até que volume queremos os sons de efeitos, do ambiente, das vozes";
"Esquecemos de colocar o sino das vendas aqui no ambiente... As notificações de toast e tudo mais".

| Arquivo | Papel |
|---|---|
| `hud-audio.js` | Som ambiente que cresce com a proximidade e os sons curtos do escritório (o sino), em Web Audio |
| `hud-sale.js`, `hud-sale.css` | O cartão do sino como aviso do próprio HUD, no canto superior direito do mapa |
| `hud-audio.test.mjs` | Testes da parte pura do `hud-audio.js` (curva, distância, leitura do volume, fontes) |

Os três entram pelo `local-dev.html`, como a visão. Ficam adormecidos até o script do mapa dizer `hello`
(`hq-office/runtime/hud.mjs`); então respondem `{konclui: 'hud', kind: 'feature', feature: 'audio' | 'sale'}`. Só com
essa resposta o mapa deixa de tocar o ambiente pelo `WA.sound` e manda o cartão para a página. Sem estes arquivos,
o Escritório Sede segue como antes: o ambiente toca pelo `WA.sound` e o cartão abre a página do campus num website
(`hq-office/README.md`, Comportamentos).

**Ambiente pela distância** (`hud-audio.js`):
- **Fonte:** cada uma tem arquivo, volume ideal, uma área onde toca nesse volume e uma distância de queda, que vêm do
  `social.json` da sede. O lago toca na água e é ouvido a até 6 tiles dela. A cafeteria toca na copa e nas mesas do café
  e é ouvida a até 4 tiles.
- **Ganho:** é o volume ideal multiplicado por (1 − distância/queda)². Começa em 0 na borda, sem degrau, cresce devagar
  e chega ao ideal na área. Na metade da queda, dá um quarto do ideal (tabela medida em `hq-office/README.md`).
- **Transições:** toda mudança desliza (`setTargetAtTime`, constante de 0,25 s).
- **Liga e desliga:** uma fonte só começa a tocar quando fica audível, e para depois de 4 s em silêncio. O arquivo
  carrega quando a pessoa chega perto.
- **Aba:** escondida, o ambiente some aos poucos. Silenciada no navegador, cala tudo, como qualquer som da página.
- **AudioContext:** o navegador o cria suspenso até a primeira interação, e o primeiro clique ou tecla o retoma. Um som
  curto que não pode tocar naquela hora é descartado, nunca ouvido atrasado.

**Contrato de volume** (lido e gravado pelas Configurações; `hud-audio.js` obedece):

| Chave no `localStorage` | Valor | Sem a chave | Efeito |
|---|---|---|---|
| `konclui.volume.ambient` | número de 0 a 1, como texto (`'0.6'`) | 1 | Multiplica o volume ideal de cada som ambiente; 0 cala |
| `konclui.volume.bell` | idem | 1 | Multiplica o volume do sino (1 no escritório, 0,4 em salas, cabines, auditório e mesa em foco) |
| `konclui.volume.effects` | idem | 1 | Reservada para os sons curtos nossos. Hoje nenhum efeito tem som (as reações são só imagem): a chave existe e o `hud-audio.js` já a aplica à categoria `effects` |
| `konclui.sound.bell` | `'off'` | ligado | Desliga o som do sino; o cartão continua aparecendo |

Um valor que não é número conta como 1. As vozes das outras pessoas são o volume do próprio WorkAdventure e ficam com
as Configurações.

**O que as Configurações chamam:** gravar a chave e anunciar a mudança na página. Outras abas recebem o evento
`storage` sozinhas.

```js
localStorage.setItem('konclui.volume.ambient', String(value));            // value de 0 a 1
window.dispatchEvent(new CustomEvent('konclui:volume', { detail: { key: 'konclui.volume.ambient', value } }));
```

O ambiente muda na hora, deslizando. O sino usa o volume novo no próximo toque.

**Cartão do sino** (`hud-sale.js`): `{kind: 'sale', card, ms}` mostra e `{kind: 'sale', card: null}` tira. É o aviso do
HUD (vidro, ladrilho de 64 px com o sino balançando, Urbanist 22/14/13) em três tons: verde `#34D399` para venda nova,
ciano `#22D3EE` para renovação e dourado `#E0B341` para o sino manual. Os três passam de 6:1 sobre o vidro.
- **Conteúdo:** etiqueta, hora, valor (ou "Toca o sino!"), cliente (ou quem tocou), cidade/UF · plano e "Vendido por
  **fulano**, squad X". Todo campo entra como texto.
- **Posição:** o canto é dividido com o aviso do economizador e com os avisos de área do WorkAdventure ("Recepção",
  "Sino da venda", alguns segundos ao entrar numa área). O cartão fica logo abaixo dos que estiverem visíveis e sobe
  deslizando quando eles saem.
- **Somem quando:** há jogo ou modal aberto, nas telas do próprio WA e, no celular, com a folha de pessoas aberta,
  como os avisos do HUD.
- **O ×:** fecha o cartão e passa ao próximo da fila (intenção `sale-close`). Espaço e Enter no × não chegam ao jogo
  (classe `kmh-inj`).

**Verificação:** `node --test theme/hud-audio.test.mjs` e `python3 hq-office/qa_sound.py` (curva, caminhada, contrato,
sino, fila, venda e o recuo sem estes arquivos, no motor local).

## Avatar e companheiro no modal — pedido do dono, 20/10/2026

"Nas configurações melhore algumas opções pra conseguir abrir logo ali no modal, sem precisar abrir outro... Portar
tudo pra cá." As telas do WA (`SelectCharacterScene`, `SelectCompanionScene`) saíam do jogo e, no layout do escritório,
abriam espremidas no cartão do mapa, com a interface por cima.

`hud-profile.js` e `hud-profile.css`, carregados por `local-dev.html`, publicam `window.__kProfile.mount(slot, kind)`.
O `moment-hud.js` chama uma vez por espaço da seção Perfil (`avatar`, `companion`) quando a ponte `window.__kWa` está
no ar. Fora isso, um arquivo não conhece o outro.

- **Avatar:**
  - Prévia em CSS: as folhas das camadas empilhadas como fundos, em escala inteira de pixels do aparelho e
    `pixelated`; de frente em 4× e nas quatro direções em 1×.
  - Uma aba por camada do WA (Corpo, Olhos, Cabelo, Roupa, Chapéu, Acessórios) e "Personagens prontos". Cada aba lista
    as seções que `gameManager.loadWokaData()` devolve, na ordem recebida, sem lista própria.
  - Cada miniatura mostra a peça no seu avatar: as camadas de baixo e, por cima, olhos, cabelo e roupa. Chapéu e
    acessórios ficam de fora, porque cobririam as outras opções.
  - Leve: a aba é montada ao abrir, a miniatura carrega ao entrar na lista (IntersectionObserver) e uma escolha só
    muda atributos e uma variável de CSS.
- **Acessórios:** grupos e ordem de desenho vêm de `/resources/konclui/accessories.json`, o contrato que
  `local-wa/woka/konclui/accessories.js` aplica ao editor nativo. Uma peça por grupo, clicar de novo tira, "Sem
  acessório" tira todas. A lista salva leva as peças na ordem do contrato, ou a textura vazia. Sem o arquivo, um
  acessório só, como no WA.
- **Aleatório, Desfazer, Salvar:**
  - Aleatório é o do WA: cada camada sorteada da primeira seção; na aba de prontos, um personagem de qualquer seção.
  - Desfazer volta ao que está salvo.
  - Salvar valida como o WA (`areCharacterTexturesValid`), chama `gameManager.setCharacterTextureIds` e
    `connectionManager.saveTextures` e mostra "Salvando…". Depois fecha o modal pelo X e reinicia o mapa uma vez
    (`closeGameScene` e `goToNextScene`), como o nome.
- **Companheiro:** a lista `companion/list` do WA, com "Sem companheiro" e prévia em 4×. Salvar é o do
  `SelectCompanionScene`: `setCompanionTextureId` no `localUserStore` e no `gameManager`, `saveCompanionTexture`, e o
  mapa reinicia uma vez.
- **Teclado:**
  - Abas com setas. Cada lista tem um só ponto de Tab, setas em grade (para cima e para baixo vão à linha vizinha) e
    Espaço para marcar.
  - O roteador do modal para os cliques na janela e aperta os botões com Enter e Espaço. Por isso os editores ouvem
    cliques na janela e seguram as outras teclas na própria raiz, já que o WA lê setas e WASD da janela.
  - Anel de foco só no teclado, sem transição com movimento reduzido, sem blur.
- **Ao reabrir:** o que não foi salvo some ao fechar o modal; uma troca feita na tela do WA (menu do K) é lida de novo.

**Checagem:** `python3 hq-office/qa_hud.py --only profile`, com um visitante próprio e dois reinícios do mapa. Confere:
- abas e seções iguais às do motor, e a prévia igual ao Woka salvo;
- setas que escolhem sem andar o woka;
- um cabelo e dois acessórios de grupos diferentes, salvos no `gameManager`, em `localStorage.characterTextures` e nas
  folhas desenhadas pelo jogador da cena nova;
- depois, um companheiro: `localStorage.companion` e o companheiro desenhado;
- a interface acordada depois de cada reinício e nenhuma tela do WA no caminho.

Screenshots: `hq-office/reviews/hud/profile-avatar.png`, `profile-companion.png` e as versões `-saved`.

## Stick do iPad — removido em 24/10/2026

O stick nosso (`theme/tablet-stick.mjs`) saiu a pedido do dono, depois de ele ver a base nativa do WorkAdventure. Não recolocar. No Chromium com ponteiro grosso essa base continua visível e o arrasto não anda o jogador: o motor só liga o joystick quando `pointer.event` é um `TouchEvent`, e o toque chega como `PointerEvent`. O protótipo em `design/ux/tablet-controls.md` não entra no escritório.

## Popups sem corte — pedido do dono, 11/11/2026

**Problema:** no popup de câmera e microfone negados, "Permitir webcam e microfone" e "Continuar sem webcam e microfone"
apareciam cortados nas duas pontas ("…itir webcam e microfone", "Continuar sem webcam e micro").

**Causa:** o `.btn` do WA tem `white-space: nowrap`, e um item flex não encolhe abaixo do próprio rótulo. Os dois botões
`w-full` da linha (`HelpCameraSettingsPopup.svelte:91-128`) somavam mais que os 348 px úteis do form de 380 px, e o
`overflow-hidden` do form cortava o excesso. Abaixo de 768 px havia um segundo corte: o host dos popups é `w-max`, e só a
variante `mobile:` do WA o limita, mas ela exige ponteiro grosso. Numa janela estreita com mouse, o popup passava da borda
direita, além do recuo do trilho (`moment-hud.css`, `left: var(--kmh-card-left)`).

**Solução:** nos popups (`.popups`, `.helpCameraSettings`, `.helpNotificationSettings`), a linha de botões quebra (`flex-wrap`,
`gap: 8px`). Cada botão tem `flex: 1 1 auto; width: auto; min-width: 0` e rótulo que quebra (`theme.css`, seção 8). Os botões
ficam lado a lado quando os dois cabem e empilham quando não cabem. Um rótulo só quebra dentro do botão quando nem sozinho
cabe. Abaixo de 768 px, o host fica limitado ao espaço entre o trilho e a borda (`moment-hud.css`, junto da regra que o
desloca).

**Evidência:** `python3 tests/popup_fit.py` monta os três popups de ajuda com o markup da v1.34.5 e o CSS do WA servido pela
produção, sem rodar o app nem entrar na sala. Ele reprova botão fora da caixa que o corta ou da tela, e rótulo que transborda.
Com o tema publicado (`--before`), reproduziu o defeito: câmera cortada em 1440, 1280, 1024 e 820 px, e fora da tela em 390
e 360 px. Com o tema local, nenhuma falha nas seis larguras com mouse nem em 390 e 360 px com toque. Câmera empilhada;
notificação e WebRTC lado a lado, em uma linha. O teste copia o markup do WA: a cada atualização do motor, conferir os
templates de `HelpSettings/` e do host em `MainLayout.svelte`.
