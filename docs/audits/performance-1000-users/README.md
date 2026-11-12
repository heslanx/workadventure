# WorkAdventure para 1.000 usuários simultâneos

**Plano ampliado para todas as dependências e TypeScript 7.0.2 nativo.** Para performance do produto, começar pelo Svelte, pelo gerador de carga e pela contribuição ao PR de reconexão já aberto. A meta inclui experiência em aparelhos modestos, capacidade e custo. Nenhuma atualização isolada comprova essa capacidade.

Análise do commit `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`. Versões e situação dos PRs consultadas inicialmente em **11/11/2026**. O inventário npm completo e TypeScript foram ampliados em **12/11/2026**. Este pacote contém diagnóstico e planejamento. Não foram executados benchmarks, instaladas dependências, alterado código de produto ou publicados PRs nesta tarefa.

## Leia nesta ordem

1. [Programa integral de dependências](plans/full-dependency-program.md), [TypeScript nativo](plans/typescript-native-migration.md) e [alvos por declaração](inventory/dependency-upgrade-targets.csv). Cobertura completa e sequência de PRs.
2. [Cenários e critérios para 1.000 usuários](plans/1000-user-workloads.md). Capacidade, experiência e custo medidos separadamente.
3. [Plano dos PRs iniciais e piloto TypeScript](plans/upstream-pr-plan.md). Escopo, contratos, verificação, sequência e reversão. Em inglês para facilitar uso upstream.
4. [Arquitetura, Go, Rust e próximos candidatos](plans/architecture-and-replacements.md). Onde a tecnologia pode ajudar e onde reduzir trabalho primeiro.
5. [Panorama completo original](baseline/REPORT.md). Stack, fluxos, armazenamento, dados e gargalos potenciais.

## Arquivos preservados

| Pasta | Conteúdo |
|---|---|
| `baseline/` | [Relatório](baseline/REPORT.md), [capacidade](baseline/CAPACITY.md), [dependências diretas](baseline/DEPENDENCIES.md) e [escopo](baseline/SCOPE.md) da primeira investigação |
| `inventory/` | [Resumo JSON](inventory/inventory.json), declarações diretas, resoluções npm/Yarn, imagens, pacotes de sistema declarados, extensões e assets |
| `plans/` | Documentos de decisões, migração de compilador e execução futura |
| `evidence/` | Procedência, validação, diagnóstico das skills e manifesto de integridade |
| `archive/` | ZIP original preservado sem alteração |

Os 14 arquivos da entrega anterior foram copiados integralmente. O [manifesto de importação](evidence/import-manifest.json) registra tamanho e SHA-256 de cada um. Os CSVs distinguem dependências diretas de resoluções transitivas. Imagens de containers não foram desmontadas para produzir um SBOM de suas dependências internas.

## Decisões principais

O Svelte tem correções específicas de retenção de memória. Matrix tem correções relevantes, mas exige migração entre versões principais. Phaser tem um patch local de GPU que precisa ser preservado. O cliente LiveKit já está na versão estável encontrada.

A troca generalizada de TypeScript por Go ou Rust não está justificada pelas evidências atuais. O LiveKit já usa Go, o transporte uWebSockets.js já tem núcleo nativo e parte da criptografia usa Rust. Vídeos decodificados, DOM acumulado e desenho de avatares continuam custando recursos no cliente.

O [PR #6688](https://github.com/workadventure/workadventure/pull/6688) já trata retenção e limites do histórico de reconexão. O plano prevê contribuir com testes e medições nesse trabalho. A pesquisa de duplicatas foi parcial por limite de consultas do GitHub e deverá ser repetida antes de qualquer publicação.

**Próxima ação em menos de dois minutos**. Abra as cinco ondas do programa integral e as etapas da migração TypeScript. O primeiro marco de execução será demonstrar uma sessão aceita pelo gerador de carga, movimento recebido e saída limpa.
