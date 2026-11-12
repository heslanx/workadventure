# Atualizações com possibilidade de benefício

**Escopo ampliado em 12/11/2026.** O [programa integral](full-dependency-program.md) cobre todas as 419 declarações e infraestrutura. O [plano TypeScript nativo](typescript-native-migration.md) acrescenta 7.0.2 com API 6.x de compatibilidade. As prioridades abaixo continuam sendo o recorte de benefícios em runtime; a consulta completa está no [CSV de alvos](../inventory/dependency-upgrade-targets.csv).

**Prioridade imediata proposta: Svelte 5.55.9 para 5.57.3.** Há correções de memória aplicáveis à interface. Ainda falta demonstrar quanto elas afetam este WorkAdventure.

Versões observadas em 11/11/2026. A origem local é o lockfile do commit auditado. Revalidar as versões e os PRs antes de implementar. O inventário completo permanece em [DEPENDENCIES.md](../baseline/DEPENDENCIES.md) e nos [CSVs](../inventory/direct-dependencies.csv).

## Primeiro candidato

| Item | Decisão |
|---|---|
| Svelte | `5.55.9` → `5.57.3`, em PR isolado |
| Evidência | `5.56.10` libera a referência ao último evento propagado; `5.57.2` evita retenção de dependências desconectadas por leituras derivadas sem rastreamento |
| Benefício plausível | Menos objetos/DOM retidos após abrir e fechar painéis ou desmontar componentes |
| Prova necessária | Mesmos ciclos de chat, painéis e troca de sala; comparar heap retido, elementos destacados e latência de interação |
| Cuidados | Atualizar consumidores web de forma consistente e verificar plugin Svelte, stores, efeitos e build. Desktop tem grafo separado e já declara `^5.57.3` |

Fontes primárias: [changelog](https://github.com/sveltejs/svelte/blob/main/packages/svelte/CHANGELOG.md), [correção de evento](https://github.com/sveltejs/svelte/pull/18569), [correção de derivados](https://github.com/sveltejs/svelte/pull/18829). Melhorias de parser/SSR não devem ser descritas como ganhos de FPS do jogo.

## Migração relevante, depois do primeiro marco

**Matrix JS SDK `42.4.0` → `45.1.0`.** Na versão 44, o SDK limita a três as buscas concorrentes de eventos iniciais de threads e deixa de bloquear inicialização de criptografia em certas buscas de chaves pendentes. Na versão 45 há correções de fechamento do banco de criptografia e de interrupção de serviços em `stopClient`. Isso combina com sessões longas, muitas threads e entrada/saída repetida do chat.

Há mudanças incompatíveis em responsabilidade de refresh OAuth na 43, APIs MatrixRTC na 44 e tipos de endpoints LiveKit na 45. Não juntar esse trabalho ao upgrade Svelte. Validar login/refresh, histórico criptografado, IndexedDB após atualização e reabertura, reconexão, logout, threads, paginação, recibos e divisão do bundle. Confirmar que as APIs alteradas são ou não consumidas antes de escolher a estratégia.

Os consumidores locais estão em `MatrixChatRoom.ts`, `MatrixChatConnection.ts` e `MatrixClientWrapper.ts`, em `play/src/front/Chat`. Fontes: [44.0.0](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v44.0.0), [45.0.0](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v45.0.0) e [limitação de concorrência](https://github.com/matrix-org/matrix-js-sdk/pull/5519). As notas justificam experimentar, não fornecem um ganho medido para este aplicativo.

## Manutenção separada da meta de capacidade

| Dependência | Base → estável encontrada | Decisão e verificação |
|---|---|---|
| Node.js | Tag `24-trixie-slim`, patch resolvido desconhecido → linha 24 em `24.22.3` | Registrar versão real e digest. A tag pode já resolver para esse patch. Conferir binário nativo uWS, streams gRPC e memória sob reconexão |
| LiveKit server SDK | `2.15.3` → `2.19.3` | SDK de tokens/API, não servidor SFU. Verificar tokens com `exp`, webhooks e compatibilidade. Egress passthrough só pode reduzir transcodificação se um fluxo compatível for adotado separadamente |
| Vite | `8.1.4` → `8.3.8` | Ganho potencial de build/desenvolvimento. Validar workers, WASM, CSS, assets e carregamento tardio do Matrix. Não prometer FPS |
| uWebSockets.js | `20.67.0` → `20.71.0` | Microcache HTTP nativo é opt-in e não comprova ganho no fanout WebSocket. Validar ABI, plataformas, upgrade, fechamento e backpressure |
| Phaser | `4.2.0` com patch local → `4.2.1` | Release de correções, sem ganho de performance aplicável comprovado. Portar/revalidar patch antes de considerar atualização simples |

Fontes: [Node 24](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md), [índice Node](https://nodejs.org/dist/index.json), [SDK LiveKit](https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/CHANGELOG.md), [Vite 8.3.8](https://github.com/vitejs/vite/releases/tag/v8.3.8), [uWS.js 20.71.0](https://github.com/uNetworking/uWebSockets.js/releases/tag/v20.71.0), [Phaser 4.2.1](https://github.com/phaserjs/phaser/releases/tag/v4.2.1).

`patches/phaser+4.2.0.patch` trata precisão de sampler, arredondamento de bytes, tiles vazios/rotacionados, recorte de textura, margem/espaçamento e animação. Uma atualização sem esse comportamento pode piorar compatibilidade em GPU móvel. Validar Android/Adreno real, WebGL, restauração de contexto, zoom e tiles animados. Os números de versão da biblioteca C++ uWebSockets são distintos dos de uWebSockets.js.

## O que já foi atualizado upstream

| Trabalho | Situação consultada | Consequência |
|---|---|---|
| [LiveKit client #6852](https://github.com/workadventure/workadventure/pull/6852) | Integrado; cliente local `2.23.0`, também estável encontrada | Nenhum bump novo a propor |
| [LiveKit e codecs #6935](https://github.com/workadventure/workadventure/pull/6935) | Integrado | Preservar configuração e medir fluxos reais |
| [Matrix #6593](https://github.com/workadventure/workadventure/pull/6593) e [lazy loading #6753](https://github.com/workadventure/workadventure/pull/6753) | Integrados | Não repropor carregamento tardio que já existe |
| [Redesenho de balões #6814](https://github.com/workadventure/workadventure/pull/6814) | Aberto | Verificar sobreposição antes de mexer nesse desenho |
| [Tracks após reconexão #6800](https://github.com/workadventure/workadventure/pull/6800) | Aberto | Colaborar no fluxo existente se a medição apontar esse problema |

A consulta de títulos não encontrou duplicata nova de Svelte/Matrix, mas a busca foi limitada e houve rate limit. Não equivale a liberação completa para abrir PR.

## Como aceitar uma atualização

1. Fixar versão, SHA, lockfile, imagem, aparelho e cenário da comparação.
2. Alterar uma família de dependências e executar os checks dos consumidores afetados.
3. Comparar comportamento e desempenho intercalando base/candidato. Preservar resultados brutos e explicar ruído.
4. Publicar benefício somente quando reproduzido. Caso só haja correção de ciclo de vida, descrevê-la sem percentual de economia.
5. Reverter manifests e lockfile juntos se houver regressão. Não misturar mudança de renderer, API ou UI na mesma atualização.
