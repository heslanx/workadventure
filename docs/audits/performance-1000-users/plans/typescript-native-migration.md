# Migrar para TypeScript 7 nativo preservando as ferramentas

**Alvo estável confirmado em 12/11/2026: TypeScript 7.0.2, com compilador em Go.** O checkout auditado usa 5.9.3. TypeScript 7.1 está em beta e não é o alvo padrão deste plano.

O benefício esperado está no tempo e memória de checagem, emissão e ferramentas de desenvolvimento. O resultado da aplicação continua JavaScript. A migração não transforma o servidor WorkAdventure em Go nem demonstra melhora de FPS ou capacidade para 1.000 usuários. Medir o ganho neste monorepo antes de publicar números.

Fontes primárias: [anúncio e migração do TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [registry TypeScript](https://registry.npmjs.org/typescript), [7.1 beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/).

## Versões e papel de cada pacote

| Pacote | Versão observada | Papel no plano |
|---|---|---|
| `typescript` | 7.0.2 estável | Compilador nativo, executável `tsc` |
| Última linha JavaScript 6.x | 6.0.3 | Baseline de compatibilidade antes do compilador nativo |
| `@typescript/typescript6` | 6.0.2 | Wrapper de compatibilidade com API antiga e `tsc6`; depende da linha 6.x por alias interno |
| `svelte-check` | 4.7.8 | Seus peers aceitam TS 5/6. Continua responsável por diagnósticos `.svelte` |
| `typescript-eslint` | 8.72.2 | Exige TS `>=4.8.4 <6.1.0`; API TS7 não é substituição transparente |

O wrapper 6.0.2 e seu compilador subjacente 6.0.3 são resoluções diferentes. Registrar ambos no lockfile. Fontes: [wrapper](https://registry.npmjs.org/@typescript/typescript6/latest), [svelte-check](https://registry.npmjs.org/svelte-check/latest), [typescript-eslint](https://registry.npmjs.org/typescript-eslint/latest), [versões suportadas](https://typescript-eslint.io/users/dependency-versions/).

A rota oficial lado a lado proposta é a seguinte. É um exemplo para a futura alteração do manifest, não uma alteração já aplicada.

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

Com a resolução correta, `tsc` usa TS7 e `tsc6`/imports de `typescript` mantêm o compilador/API JavaScript. Conferir resolução em cada workspace, instalação parcial e imagem, pois um binário local pode sombrear o da raiz. Não presumir que editar somente o manifest raiz migra todos os grafos.

Não usar `@typescript/native-preview` como caminho estável. A versão observada desse pacote é um build de desenvolvimento anterior ao release 7.0. TypeScript 7.0 não oferece a antiga compiler API; a API em desenvolvimento na 7.1 também exige avaliação de integração, não apenas bump.

## Cinco etapas e PRs separados

1. **D01a. Compatibilidade TS6.** Atualizar as ferramentas acopladas e tratar diagnósticos/configurações de 5.9.3 para a linha 6.x. Preservar targets de navegador. Medir baseline e executar os checks atuais. Não adicionar `ignoreDeprecations` amplo ou desabilitar regras para obter verde.
2. **P6 / D01b. Piloto do compilador nativo.** Introduzir aliases e comparação de `--noEmit` em `back` e `map-storage`. Registrar versão/caminho efetivo por workspace e comparar diagnósticos, códigos de saída, tempo frio/quente e pico de memória. Manter o gate existente até equivalência.
3. **D01c. Promover checagem nativa.** Migrar os checks TypeScript puros validados. Manter `svelte-check` e lint tipado na API TS6. A comparação temporária pode ser retirada após promoção, com recibo e rollback explícitos.
4. **D01d. Migrar emissão e declarações.** Validar builds das libs, `tsc --build`, declarações iframe/API pública e layout de sourcemaps. Separar da mudança de checker para localizar regressões de output.
5. **D09/P1. Geradores e launcher.** Atualizar `ts-proto` em PR próprio e avaliar o launcher antigo `ts-node` no reparo do benchmark. Não fazer a geração protobuf depender de uma conclusão baseada apenas em typecheck.

## Superfícies locais que exigem prova

| Superfície | Caminhos/scripts | Verificação |
|---|---|---|
| Diagnósticos TS e Svelte | `play/package.json`, `back/package.json`, `map-storage/package.json`, `libs/store-utils/package.json` | Mesmos erros relevantes e exit codes; `front:check` e `svelte-check` preservados |
| Lint tipado | `libs/eslint-config/index.js`, `libs/eslint-config/package.json`, ferramenta isolada em `messages` | `projectService`, parsers e rules acessam API compatível; não forçar peer ranges |
| Configuração | `play/tsconfig-pusher.json` contém `preserveValueImports: false`; vários tsconfigs omitem `types`/`rootDir` | Resolver opção obsoleta, tipos ambientes, side-effect imports, paths e layout de emissão, mantendo o target de runtime |
| Bibliotecas e contrato público | `libs/{messages,shared-utils,store-utils,map-editor}/package.json`, room-api-client, `play/tsconfig-for-iframe-api-typings.json` | Comparar exports `.d.ts`, paths, resolução por consumidores e source maps; iframe já tem tipos/rootDir explícitos |
| CI, desktop e publicação | `.github/workflows/continuous_integration.yml`, `desktop/electron/package.json`, script `push-sentry-sourcemaps` | Preservar geração, Svelte checks e locks separados. Validar mapas localmente sem executar upload como teste |

O TS6 muda defaults de tipos ambientes, raiz e verificação de imports por efeito colateral. Conferir os detalhes contra os tsconfigs efetivos, inclusive configuração herdada do Svelte. Fonte: [notas TypeScript 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).

O `ts-node` está em 10.9.2 na resolução inspecionada, também a estável encontrada. Ele usa a compiler API JavaScript; um peer range amplo não prova suporte a TS7. A origem de verificação é a [implementação versionada](https://github.com/TypeStrong/ts-node/blob/v10.9.2/src/index.ts). O benchmark pode continuar na API compatível ou migrar para tooling já existente no projeto, como decisão separada.

Em `messages`, `ts-proto` 2.11.8 tem candidato 2.18.4. O gerador produz serviços gRPC/oneof e acrescenta `@ts-nocheck`; arquivos gerados são excluídos do tsconfig de messages. Typecheck verde não prova identidade do protocolo. Comparar geração e comportamento dos consumidores/serialização.

## Aceitar a migração com evidência

Fixar SHA, lockfile, máquina, arquitetura, limite de CPU e versões reais de compiladores. Intercalar pelo menos cinco execuções válidas de TS6/TS7 em modo frio e incremental quando aplicável. Registrar wall time, pico de RSS, status e diagnósticos normalizados. Não comparar uma execução com cache contra outra sem cache.

Exigir diagnóstico equivalente ou diferenças revisadas, output/consumidores corretos e nenhuma perda de verificação Svelte/lint. Um limiar inicial para promover o piloto é melhora de pelo menos 10% em tempo ou memória além do ruído, sem regressão material da outra métrica. Os números são critérios propostos, não ganhos medidos.

Rollback do piloto retorna os checks afetados a `tsc6` e reverte aliases/scripts/lockfile de forma coordenada. Rollback da emissão exige reconstruir artefatos e conferir consumidores. Remover jobs comparativos temporários depois da decisão, preservando seus resultados. Não alterar configuração global do editor nesta tarefa.
