# Gather: origem, licença e o que ficou de fora

As imagens vêm da coleta "Gather Asset Collector" que o dono fez em 14/10/2026 no catálogo do Gather 2.0
(`app.v2.gather.town`, `static.gather.town`). `office/gather.py import <pasta da coleta>` copia só o que a coleção usa,
byte a byte, para `files/<sha256>.png`, e grava a geometria de cada peça em `catalog.json` (tamanho, deslocamento,
linha de profundidade, colisão e pontos de assento, como o Gather os declara). Os nomes em português ficam em
`names-pt.json`.

| Entrou | Quantidade | Vira no editor |
|---|---|---|
| Móveis e decoração do catálogo (10 categorias do Gather, 592 tipos) | 9.444 variantes de cor e direção | 19 categorias "Gather: …" |
| Pisos (`walls-and-floors/floors`) | 803 ladrilhos de 32 px | "Gather: pisos", um nome por padrão e as cores como variantes |
| Paredes finas (`walls-and-floors/walls`) | 216 peças, 8 posições em 27 acabamentos | "Gather: paredes" |
| Folhas de porta (`doors-n`, `doors-s`, `doors-e/w-top/bottom`) | 6 folhas | "Gather: portas", quadros fechado e aberto |

**Licença.** A arte é do Gather (Gather Presence, Inc.) e não tem licença aberta conhecida; vale o uso permitido pelos
termos do Gather. O dono pediu a importação para o escritório interno da Koncluí nesta conversa de 14/10/2026. Até
uma decisão dele, as peças ficam na sala local: o envio para work.konclui.com, aberto a qualquer visitante, serviria
essas imagens publicamente. Não publique as imagens avulsas fora do mapa.

**Ficou de fora, de propósito:**
- avatares (9.435 sprites, cada um de uma peça de roupa isolada; não são as camadas-fonte nem combinações, e o formato
  é outro que o Woka do WorkAdventure);
- 36 recursos de interface do aplicativo, cadeado, logotipos de Meet/Teams/Zoom e as portas simplificadas do minimapa;
- 61 prévias de escritórios (são imagens, não mapas editáveis) e o layout de 203 objetos do escritório coletado, que
  a própria coleta marca como formato não validado;
- 6 referências antigas que o servidor devolveu como HTML.

A pasta da coleta continua sendo a fonte de tudo isso: `organized/manifest.jsonl` liga cada SHA-256 ao nome, à
categoria e à URL de origem.
