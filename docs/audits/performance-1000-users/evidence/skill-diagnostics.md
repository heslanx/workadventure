# Diagnóstico amostral das skills solicitadas

**Não existe nota global de qualidade do repositório nesta auditoria.** A inspeção cobre movimento/interpolação, timeline, interfaces de chat/mídia, replay, zonas e autosave. Os checks e perfis de execução ainda não foram executados. Os números abaixo registram evidência disponível segundo as rubricas das skills, sem transformar desconhecimento em defeito.

## Evidência observada

| Skill | Critérios evidenciados | Contrapontos e lacunas | Consequência no plano |
|---|---|---|---|
| Domain-driven design | Nomes de domínio e objeto `PlayerMovement` com comportamento. Dois critérios observados da rubrica de dez | Mapa de contextos adotado pela equipe, invariantes de agregados e linguagem validada com especialistas não foram estabelecidos | Context map proposto; nenhuma migração automática para microserviços |
| Clean architecture | Cálculo de movimento testável e independente da entrega. Dois de sete critérios observados, equivalentes ao piso provisório 3/10 da rubrica | Grafo inteiro, composição e independência de banco/provedores não auditados; interfaces expõem detalhes Matrix/LiveKit | Usar fronteiras existentes; retirar dependência de navegador do benchmark |
| Refactoring patterns | Smell nomeado e localizado. Um de oito critérios evidenciados | `GameScene` combina responsabilidades e há métodos longos; baseline de testes, passos executados e ganho de legibilidade ainda inexistem. Piso documental 1/10, não nota do produto | Caracterizar comportamento antes de extrair; sem commits nesta tarefa |
| Clean code | Nomes expressivos, nomes comportamentais dos testes inspecionados e constantes temporais nomeadas. Piso amostral 3/10 | Métodos extensos, blocos comentados e responsabilidade concentrada; cobertura e duração real dos testes não verificadas | Evitar regras mecânicas de contagem de linhas e refatoração cosmética |
| Contract-first | Protobuf e WAM existentes identificados como fontes canônicas | Caps de replay, recusa de resume, limites de retry/dirty state e interação da timeline exigem invariantes explícitos | Nenhum schema paralelo; mudanças internas não precisam de OpenAPI |

Os pisos indicam apenas quantos critérios receberam suporte nesta amostra. Não significam que o restante falhou. Os diagnósticos não são benchmarks e não justificam reescrever o projeto para elevar uma nota.

## Contratos que precisam permanecer explícitos

| Fronteira | Fonte de verdade | Comportamento a preservar |
|---|---|---|
| Cliente, pusher e backend | `messages/protos/messages.proto` e codecs gerados | IDs, ordem, nonces, rejeição, encerramento e limpeza |
| Conteúdo e edição | `libs/map-editor/src/types.ts`, comandos e WAM | Validação, comando aplicado, identidade do mapa e separação entre aplicado e persistido |
| Armazenamento | `map-storage/src/Upload/FileSystemInterface.ts` | Resultado da escrita, falha, concorrência e invalidação |
| Interpolação | Tipos TypeScript e consumidor `GameScene` | Última posição ao expirar, ordem e extrapolação |
| Timeline | IDs de evento e fluxos de navegação/leitura | Âncora, unread, foco, seleção, acessibilidade e recibos |

Antes de uma mudança independente de produtor/consumidor, revisar o contrato primeiro e derivar os tipos necessários. Para refatoração local, preservar comportamento observável e usar a fronteira mais estreita que o problema exige.
