# Plano integral de atualização de dependências

**Todas as 419 declarações diretas estão contempladas, incluindo TypeScript nativo.** O alvo é a versão estável mais recente compatível, com migração explícita quando a compatibilidade exige trabalho. A atualização continua planejada, ainda não instalada.

Consulta de 12/11/2026. O [CSV completo](../inventory/dependency-upgrade-targets.csv) contém uma linha por declaração, manifest, tipo, versões resolvidas encontradas nos grafos, versão candidata, fila e decisão. O [snapshot do registry](../evidence/dependency-registry-snapshot.json) guarda versões, engines, peers, depreciações e fontes.

São 217 nomes distintos. Foram consultados com sucesso 208 pacotes externos npm. Oito nomes são pacotes internos; uWebSockets.js usa release GitHub, com 20.71.0 verificada na consulta anterior de 11/11. Não confundir `@workadventure/*` publicado com workspace local. Os originais permanecem preservados.

## Executar em cinco ondas

1. **Compatibilidade e ferramentas.** D01/D02. Identificar consumidores da API TypeScript, alinhar API 6.x e então adotar compilador 7.0.2. Atualizar cada família de ferramentas em PR próprio. Manter um benchmark anterior às mudanças.
2. **Experiência no cliente.** D03/D04/D06. Svelte primeiro, Matrix em migração própria e Phaser com seu patch. Componentes e estilos têm gates visuais. A janela do chat e a interpolação continuam mudanças de comportamento/performance separadas.
3. **Rede e integrações.** D05/D07/D08/D09/D10. Cada fronteira tem seus testes de contrato. Não mudar schema e transporte ao mesmo tempo. P3/P4/P5 continuam independentes e recebem nova medição após upgrades relevantes.
4. **Distribuição e infraestrutura.** D11/D14. Desktop, Node, imagens e serviços atualizados separadamente. Migração de dados deve ter restauração ensaiada. O servidor Redis e o cliente npm Redis são produtos distintos.
5. **Fechar cobertura e medir o conjunto.** D12/D13 e transitivas. Resolver cada linha do inventário, validar consumidores e executar novamente os cenários de 1.000 usuários no conjunto aceito.

Ondas organizam precedência, não representam cinco PRs gigantes. Cada fila pode originar vários PRs pequenos. Dependências independentes podem avançar sem esperar toda uma onda, desde que seus pré-requisitos e o baseline estejam identificados.

## Filas de PRs e responsabilidade

| Fila | Família | Candidato e escopo | Gate específico | Declarações |
|---|---|---|---|---|
| D01 | Compilador e integração TypeScript | TypeScript 7.0.2; API 6.x para consumidores incompatíveis; svelte-check 4.7.8 | PR P6 em três etapas. Checagem, emissão, lint, Svelte e resolução dos executáveis | 47 |
| D02 | Build, lint, testes e automação | Vite 8.3.8; Vitest 5.1.0; Playwright 1.65.0; typescript-eslint 8.72.2 | PRs separados para bundler, runner, navegador e lint. Plugins/peers juntos quando necessário | 76 |
| D03 | UI, estilos, componentes e conteúdo | Svelte 5.57.3; demais versões no CSV | P2 cobre Svelte. Componentes, Tailwind, editor rich text e sanitização em PRs próprios | 44 |
| D04 | Renderer, plugins e mapas | Phaser 4.2.1; plugins e tipos compatíveis no CSV | Portar patch de GPU; testar zoom, tiles, animação e aparelhos reais | 8 |
| D05 | Mídia, efeitos e SDKs RTC | LiveKit client 2.23.0; server SDK 2.19.3; demais no CSV | Separar controle/API de mídia e efeitos. Verificar tokens, codecs, câmera, reconnect e tracks | 12 |
| D06 | Chat e comunicação Matrix/XMPP | Matrix 45.1.0; demais no CSV | Migração de API, crypto/IndexedDB, login, threads e desligamento. Independente da janela de DOM | 4 |
| D07 | HTTP, sockets, gRPC, cache e S3 | Express 5.3.0; cliente npm Redis 6.3.1; uWS.js 20.71.0 | Subdividir transporte, HTTP, Redis e AWS. Testar auth, backpressure, streams e persistência | 51 |
| D08 | Identidade e autenticação | Versões por pacote no CSV | OIDC, sessão, refresh, JWT e Passport. Contratos e fluxos de erro preservados | 11 |
| D09 | Schemas e geração de protocolo | Zod 4.6.7 como candidato condicionado; ts-proto 2.18.4 | Separar geração Protobuf da migração Zod/OpenAPI. Gate de formato e validação canônicos | 44 |
| D10 | Observabilidade e erros | Versões por pacote no CSV | Sentry, métricas e logging. Verificar tags, cardinalidade, sourcemaps, fila e desligamento | 20 |
| D11 | Desktop e distribuição | Electron 45.3.0; demais no CSV | Lockfile próprio. IPC, preload, permissões, atualização e pacote por plataforma | 7 |
| D12 | Utilitários e ferramentas restantes | Versões por pacote no CSV | Um PR por pacote ou acoplamento comprovado. Arquivos, ZIP, filas, RxJS e helpers não viram um bump coletivo | 67 |
| D13 | Pacotes internos e consumidores | Sem bump de registry | Reconstruir e validar consumidores. Preservar identidade workspace/file e contratos publicados | 28 |

D14 cobre as 44 declarações Docker/Compose, sete declarações de imagens Helm e os pacotes de SO declarados no inventário. Esses componentes têm um caminho de atualização próprio abaixo. Os totais da tabela são declarações, não pacotes únicos nem quantidade de PRs.

## Contratos que impedem um bump automático

| Caso observado | Tratamento planejado |
|---|---|
| TypeScript 7.0.2 e consumidores da API 5/6 | Compilador nativo e API de compatibilidade lado a lado; ver plano específico |
| `svelte-check` 4.7.8 aceita TS 5/6; typescript-eslint 8.72.2 exige TS abaixo de 6.1 | Não forçar peers nem usar `--legacy-peer-deps` para declarar compatibilidade |
| Zod 4.6.7 e `@anatine/zod-openapi` 2.2.8, que declara Zod `^3.20.0` | Registrar incompatibilidade. Definir adaptador suportado ou retenção temporária de Zod 3; testar schema/erros antes da migração |
| `@types/node` latest 26.6.6 frente a Node 24 do projeto | Escolher último patch da linha de tipos 24 durante execução. Não introduzir APIs de runtime ausentes |
| Nove pacotes com marca de depreciação no registry consultado | Examinar motivo e consumo antes de decidir substituição, remoção de tipos redundantes ou exceção documentada |

Os pacotes marcados como deprecated no snapshot são `@types/adm-zip`, `@types/http-status-codes`, `@types/mime`, `@types/mkdirp`, `@types/uuid`, `axios-retry`, `dtslint`, `prom-client` e `uuidv4`. A marca não demonstra falha de execução nem ganho potencial de performance. O texto original de cada aviso está no JSON; nenhuma substituição foi escolhida sem analisar o consumidor.

Cada versão em `latest_observed` é candidata, não aprovação. Uma versão já presente em um lockfile pode faltar em outro. Os valores de `locked_versions_across_graphs` agregam resoluções e não afirmam qual versão cada import carrega. Resolver essa identidade no ambiente de instalação é parte do gate de execução.

## Atualizar transitivas e todos os grafos

| Grafo | Ação |
|---|---|
| Raiz e npm workspaces | Atualizar manifests da família e lockfile raiz, evitando múltiplas instâncias incompatíveis por acidente |
| `messages/package-lock.json` | Verificar o fluxo de geração isolado, imagem de build, protobuf e declarações públicas |
| `desktop/electron/package-lock.json` | Atualizar pelo ciclo próprio de desktop, sem assumir que o root controla esse grafo |
| `libs/room-api-clients/room-api-client-js/package-lock.json` | Verificar build/publicação, imports e consumidores da biblioteca |
| `benchmark/package-lock.json`, `benchmark/yarn.lock` e `maps/yarn.lock` | Identificar runner/caminho de build que os consome antes de escolher o lockfile autoritativo. Não apagar um lockfile só por estar duplicado |

As resoluções transitivas também entram no programa, mas obedecem aos ranges e contratos dos pacotes pais. Após cada atualização direta, gerar o lockfile pelo gerenciador adotado, inspecionar a árvore, duplicatas, licenças e mudanças transitivas relevantes. Não forçar a major mais recente de cada dependência transitiva com overrides globais.

Para uma transitiva antiga que permaneça, registrar o pai responsável e uma decisão verificável. Atualizar o pai, usar um override estreito com prova de compatibilidade, ou manter uma exceção com motivo e condição de saída. Nenhuma linha deve simplesmente desaparecer da revisão. Não foi realizado novo audit de vulnerabilidades nesta tarefa; executar o fluxo aprovado pelo projeto na implementação e não confundir atualização com ausência de vulnerabilidade.

## D14. Atualizar imagens e serviços com responsabilidade por dados

| Componente inventariado | Caminho planejado | Evidência antes de aceitar |
|---|---|---|
| Node 24 Trixie e imagens thecodingmachine Node | Último patch mantido da linha escolhida, digest e arquiteturas explícitos; mudança de major em PR próprio | uWS nativo, Node real, OpenSSL, gRPC, build e soak; compatibilidade de todas as engines |
| Traefik, nginx, Alpine, busybox, iconserver e OIDC mock | Resolver release mantida e digest por imagem; alinhar Compose, testes e Helm | Rotas, headers, WebSocket upgrade, TLS, healthchecks, OIDC e plataformas |
| Redis server 6, RedisInsight e chart/dependências Helm | Definir migração da versão mantida e storage/backup; separar de `redis` npm | RDB/AOF, restauração, reconexão, persistência e compatibilidade do LiveKit |
| LiveKit server, egress, Synapse e RustFS | Um ciclo por serviço ou par explicitamente compatível. RustFS atual é alpha | Tokens, mídia, gravação, crypto/histórico, objetos S3, migração e restauração |
| Imagem PHP/Apache/Node12 de mapas, AWS CLI, imagens próprias e pacotes apt | Modernizar ambiente auxiliar; reconstruir imagens próprias no SHA aceito; atualizar SO pela base mantida | Fixtures, mapas, uploads, scripts e build. Tags geradas por SHA/variáveis não recebem `latest` indiscriminadamente |

As versões novas de todas essas imagens e as dependências transitivas dos sistemas operacionais **ainda precisam de resolução e SBOM na execução**. Este plano cobre seu trabalho, sem afirmar uma consulta que não ocorreu. Consultar release notes oficiais, arquitetura da imagem e compatibilidade de dados antes de preencher o alvo final. Imagens variáveis do próprio WorkAdventure acompanham o build do projeto, não um bump independente de biblioteca.

## Ficha obrigatória para cada PR derivado

Registrar pacote/família, versão de origem e alvo, manifests e lockfile, motivo da atualização, breaking changes, consumidores e contratos. Anexar evidência da release oficial quando houver alegação de ganho. Separar correção, manutenção, redução de tempo de CI e performance do produto.

Definir checks focados antes da mudança. Testar o comportamento do consumidor, o build realmente publicado e o fluxo de erro relevante. Mudanças de UI precisam de comparação visual e interação; mudanças de dados precisam de restauração/downgrade avaliado. Reversão inclui manifests, lockfile e efeitos persistidos, quando existirem.

Para D01, medir duração e pico de memória de typecheck/emissão. Para D03/D04/D06, medir memória e interação no cliente. Para D05/D07, medir rede, CPU e fila. Para D14, medir operação, recursos e custo. Não exigir um ganho de FPS de uma ferramenta que só roda no CI.

Cada declaração termina com estado `updated`, `already_current`, `blocked_with_reason`, `replaced_with_contract_proof` ou `internal_rebuilt`. O encerramento deve mostrar o denominador completo e as exceções; “todos atualizados” só se aplica quando não restam pendências. Revalidar a pesquisa de PRs antes de publicar cada contribuição.

`@workadventure/iframe-api-typings` tem workspace de publicação com versão placeholder, mas os consumidores solicitam versões publicadas. Por isso ele foi consultado no registry e incluído em D09, não tratado como simples rebuild interno.
