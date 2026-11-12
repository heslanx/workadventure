# games

Jogos do campus v7. Cada jogo é um jogo open source pronto, copiado aqui e vestido com a marca (decisão do dono,
2026-10-11: "importar os prontos e dar um toque por cima"). No escritório, o `campus.js` abre cada jogo como modal
com `allowApi`, e o jogo fala com o WorkAdventure só pelo `game-kit.js`.

## Estrutura

```
games/
  game-kit.js        ponte com o WorkAdventure (KG); finge o WA quando aberto direto no navegador (?local=1)
  kit.css            tokens escuros do platform, cabeçalho, cartões, placar, botões de toque
  koru.png           a Koru (adversária nos jogos contra o computador)
  <jogo>/
    index.html       nossa página: carrega iframe_api.js, kit.css, game-kit.js, o jogo e a cola
    vendor/          arquivos do repositório de origem, só o necessário, sem etapa de build
    VENDOR.md        origem (URL), commit, licença, o que foi copiado, o que foi mudado e por quê
```

O build copia `games/` para `dist/campus/pages/games/` (sem `VENDOR.md`).

A arte do Flappy Koru (`flappy/art/`) é gerada por `art/build_flappy.py` a partir de `art/raw/flappy/` e da Koru de asas abertas
do chafariz (`office/fountain/assets/koru-open-wings.png`): mude o script e rode de novo, nunca edite os PNGs à mão.

## Regras para importar um jogo

1. **Baixar fora daqui**: clone raso em `.scratch/office-redesign/vendor-src/<repo>/` (pasta nova e vazia). Nada é
   instalado, buildado nem executado lá dentro.
2. **Copiar só o que roda**: HTML, JS, CSS e mídia necessária. Mídia grande sai (o teto é ~300 KB compactado por
   jogo, `BACKLOG.md` §3.2); música vira opcional ou some.
3. **Varredura de rede antes de entrar**: `rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.|https?://" vendor/`.
   Toda chamada externa (analytics, CDN, fonte do Google, servidor de partidas) é removida ou trocada por arquivo
   local. O teste `tests/games_check.py` falha se qualquer requisição sair do servidor local.
4. **Mudanças mínimas e anotadas** no `VENDOR.md`: o código de origem fica reconhecível, a cola fica no `index.html`.
5. **Licença**: anotar no `VENDOR.md` e manter o arquivo de licença da origem em `vendor/`.

## Contrato da página (`index.html`)

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sinuca</title>
<script src="https://work.konclui.com/iframe_api.js"></script>
<link rel="stylesheet" href="../kit.css">
<script src="../game-kit.js"></script>
</head>
<body>
<main class="kg-main"><div class="kg-stage">…</div><aside class="kg-side">…</aside></main>
<script src="vendor/…"></script>
<script>/* cola: KG.ready(), KG.chrome(), KG.board()/KG.table(), window.__game = { ready: true } */</script>
</body>
</html>
```

- `KG.ready()` → `{ id, name }` da pessoa. Sempre aguardar antes de usar estado.
- `KG.chrome({ title, help })` → cabeçalho padrão (título, linha de status, "Como jogar", "Fechar"); `status(text)`.
- `KG.board(var)` → placar dos 10 melhores: `load()`, `submit(pontos)` → `{ rows, rank }`, `render(el, rows, rank)`.
- `KG.table(var, { game, initial, validState })` → mesa por turnos numa variável de sala: `join()`, `play(state, { winner })`,
  `myTurn()`, `seat`, `role` (`jogador`/`espectador`/`livre`), `resign()`, `claimWO()`, `reset()`, `onChange(cb)`.
  O estado do jogo vai em `state` e precisa ser pequeno (menos de 1 KB por jogada) e validado por `validState`
  (qualquer pessoa pode escrever a variável).
- `KG.event.send/on` → momentos ao vivo (ex.: a animação de uma tacada para quem assiste). Quem envia também recebe.
- `KG.loop(step)` → laço de quadros que para em segundo plano e roda a 30 FPS no perfil Leve (`KG.profile`).
- `window.__game = { ready: true, … }` quando o jogo está pronto: o teste espera por isso. Cada jogo pode expor
  ganchos de teste ali (ex.: `__game.state()`), nunca usados pelo jogo em si.
- Texto para a pessoa em português (pt-BR), código em inglês. Nunca montar HTML com valor vindo de variável de sala:
  só `textContent`.

## Variáveis de sala (declaradas pelo build no `.tmj`)

| Variável | Jogo | Uso |
|---|---|---|
| `mesaSinuca` | Sinuca | mesa 1 contra 1 |
| `mesaXadrez` | Xadrez | mesa 1 contra 1 |
| `mesaLig4` | Lig 4 | mesa 1 contra 1 |
| `recordesPong` | Pingue-pongue | placar |
| `recordesAirHockey` | Air hockey | placar |
| `recordes2048`, `recordesTetris`, `recordesBreakout` | Fliperamas | placar |
| `recordesFlappy` | Flappy Koru | placar; **ainda não declarada em mapa nenhum**: declarar quando o jogo ganhar um lugar no escritório |

O piano não guarda estado: as notas vão por `KG.event` para quem está por perto.

## Testar

```bash
python3 tests/games_check.py            # todos os jogos, modo local, sem o escritório
python3 tests/games_check.py sinuca     # um jogo
```

Passos próprios de cada jogo em `tests/games/<jogo>.py` (`async def check(context, url) -> {"ok": ...}`); jogos de mesa
abrem duas páginas no mesmo contexto (dois jogadores). Para testar à mão: `python3 -m http.server -d map/campus_web 8088`
e abrir `http://127.0.0.1:8088/games/<jogo>/index.html?local=1&nome=Ana` em duas abas.
