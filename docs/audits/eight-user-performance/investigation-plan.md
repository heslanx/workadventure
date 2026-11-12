# Investigar o travamento e encerrar cada hipótese

**Comece por P0: capturar o sintoma com oito participantes, correlacionando navegador e backend.** Este protocolo ainda não foi executado. O [registro](README.md) separa mecanismos existentes de causas não confirmadas; o [mapa arquitetural](architecture.md) não substitui a medição.

## 1. Prepare uma comparação reproduzível

Registre commit/build, mapa e revisão, scripts ativos, navegador/SO, dimensões físicas do canvas, classe do dispositivo, rede e estado da aba. Registre valores efetivos não sensíveis de grupo, limite P2P, provider, recursos e quotas. Não copie `.env`, tokens, ICE credentials ou payloads de chat.

Use build de produção para conclusões de capacidade. Uma reprodução em desenvolvimento é válida como diagnóstico, desde que identificada. Distribua participantes entre dispositivos representativos. Oito abas numa máquina medem também a contenção dessa máquina; bots sem renderer não medem FPS e bots sem mídia não medem áudio.

Defina antes do experimento o que é travamento: duração dos quadros, atraso até resposta ao input, saltos remotos, áudio interrompido ou desconexão. Mantenha relógios correlacionáveis, identifique a execução e anote início/fim do evento observado. Não confunda um relógio monotônico do navegador com timestamp UTC do backend sem relacioná-los.

Use uma captura inicial de 60 segundos para triagem. Ela não estima, sozinha, a cauda de latência nem substitui repetição. Para aceitar uma otimização, execute pelo menos três repetições comparáveis de baseline e alteração, alternando a ordem quando possível. O número é protocolo inicial, não garantia estatística; aumente apenas se a variabilidade impedir conclusão.

## 2. Execute a matriz por etapas

| Etapa | Comparação                                                                           | Isola principalmente                    | Evidência necessária                                                         |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------- |
| P0    | Com participantes presentes: 30 s afastados/andando, 30 s próximos/andando           | Sintoma e custo associado à proximidade | Gravação de frames/tarefas; menus locais; CPU/filas/joins no mesmo intervalo |
| P1    | 1, 4 e 8 pessoas; depois oito paradas/andando e afastadas/próximas                   | Contagem, movimento, bolhas e limiares  | H01/H02/H12/H13/H15/H18                                                      |
| P2    | Fora de conversa, dentro sem publicação, microfone, supressão                        | Mídia efetiva com câmera desligada      | Tracks/conexões, provider, CPU, perda e bytes; H11–H14                       |
| P3    | Mapa real versus mínimo; integrações isoladas; chat curto/longo; cache frio/quente   | Conteúdo, DOM e entrada                 | H03/H05–H09; uma alteração por comparação                                    |
| P4    | Mesma carga em outros dispositivos/redes; ciclo repetido de salas; build equivalente | Ambiente, retenção e regressão          | H04/H10/H16/H17/H19–H22                                                      |

Se a primeira captura não reproduzir, registrar o resultado como inconclusivo e buscar a condição ausente. Não testar todas as combinações cartesianas antes de olhar os primeiros sinais. Priorizar a próxima comparação que diferencia duas explicações plausíveis.

## 3. Colete métricas com origem e unidade

| Área           | Coleta                                                                                | Interpretação e limite                                                        |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Navegador      | Duração dos quadros em ms, p50/p95/p99, tarefas longas, input, custo de layout/render | FPS médio esconde pausas; profiler também acrescenta custo                    |
| Recursos       | Heap/RSS, nós DOM, texturas, GC, processos/uso de GPU e dimensão do canvas            | Memória JS não inclui toda a GPU; crescimento inicial não prova leak          |
| Mídia          | Provider, peers/tracks, bitrate, RTT, perda, estado, tentativas, encoder              | Limitação do encoder não equivale à CPU total da página                       |
| Backend/pusher | CPU, quota/throttled time, event-loop delay, GC, memória, fila/drain/replay, overheat | Medir cada processo; CPU total do host não mostra saturação da thread afetada |
| Rede/sessão    | Quantidade/tamanho das mensagens, encerramentos, reconexões e correlação temporal     | Bytes de payload excluem cabeçalhos; resposta 304 não significa zero tráfego  |

As ferramentas existentes do navegador e da operação são a primeira opção. `perf_hooks.monitorEventLoopDelay` é uma opção para atraso de processamento se for necessário instrumentar Node; converter sua unidade corretamente. Marcar instrumentação temporária e removê-la após uso. Uma captura precisa de limite de duração e tamanho; não transformar diagnóstico em retenção permanente de dados pessoais.

## 4. Transforme hipótese em decisão

Use a ficha abaixo para cada ID, sem preencher ausência de evidência com zero:

```text
Hypothesis ID:
Run ID and artifact path:
Owner:
Date, commit, build and map revision:
Devices, network and effective nonsecret settings:
Observed symptom and reproduction steps:
Control condition:
Changed variable:
Metric, unit and baseline distribution:
Result and repeated-run variation:
Evidence supporting or weakening the mechanism:
Decision: confirmed / refuted within scope / inconclusive
Smallest candidate correction:
Behavioral invariants and existing tests:
After-change evidence:
Rollback and remaining limitations:
```

Promova a hipótese a causa somente quando o perfil mostrar o mecanismo relevante e uma intervenção controlada alterar o sintoma de forma reproduzível. Correlação temporal ajuda a escolher o experimento, mas não basta para fechar a causa.

Se a comparação mostrar benefício dentro da variação do teste, não declarar ganho. Se não houver o sintoma, não declarar a hipótese eliminada para produção. Se resolver apenas um dispositivo, registrar esse escopo.

## 5. Execute a fila com gates explícitos

| Ordem | Entrega                           | Depende de                                 | Critério de encerramento                                                                                  |
| ----- | --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1     | Baseline do incidente, D01        | Acesso ao mapa e cenário representativo    | Evidências correlacionadas e sintoma identificável; ou condição ausente registrada                        |
| 2     | Diagnóstico dos P1                | Baseline                                   | Cada H prioritária tem resultado confirmado, refutado no escopo ou inconclusivo com próximo discriminador |
| 3     | Primeira correção pequena         | Mecanismo confirmado                       | Sintoma reduzido no cenário-alvo, fora da variabilidade observada, sem quebrar invariantes                |
| 4     | Deepening escolhido entre A01–A05 | Fricção demonstrada e decisão de ownership | Menos conhecimento exigido dos consumidores, testes comportamentais preservados e regressões ausentes     |
| 5     | Sessão sustentada e fechamento    | Correção validada                          | Repetição representativa, ciclo de vida limpo, recursos estáveis e limitações documentadas                |

O orçamento de experiência precisa ser registrado antes de aceitar mudanças: dispositivo-alvo, taxa de atualização esperada, tolerância de resposta ao input e limite de interrupção de mídia. Não há SLO aprovado nesta investigação. Uma tela a 60 Hz oferece cerca de 16,7 ms por quadro; isso é uma relação física, não um compromisso já firmado para todos os dispositivos.

### Invariantes e testes existentes

Reusar os testes e runners dos packages envolvidos; não criar um teste por arquivo só para refletir a estrutura. Inventário e testes executados são registros diferentes. Nesta tarefa documental, **nenhuma das suítes de produto abaixo foi executada**.

| Mudança eventual  | Prova que deve sobreviver                                 | Ponto de partida                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movimento/bolhas  | Parada final, interpolação, remoção, aparência e descarte | [PlayerMovement.test.ts](../../../play/tests/front/Phaser/Game/PlayerMovement.test.ts), cenário real de conversa                                                                                                                                            |
| Proximidade/mídia | Cancelamento, join/leave concorrente, provider e limpeza  | [ProximitySpaceManager.test.ts](../../../play/tests/front/WebRtc/ProximitySpaceManager.test.ts), [CommunicationManager.test.ts](../../../back/tests/CommunicationManager.test.ts), [TransitionPolicy.test.ts](../../../back/tests/TransitionPolicy.test.ts) |
| Entrega/replay    | Ordem, recuperação, duplicatas e slow consumer            | [WorkAdventureWebSocket.test.ts](../../../play/tests/front/Connection/WorkAdventureWebSocket.test.ts), [SocketManagerSpaceStateQuery.test.ts](../../../play/tests/pusher/SocketManagerSpaceStateQuery.test.ts)                                              |
| Timeline          | Âncora, leitura, foco, prepend, redaction e troca de sala | [RoomTimelineNewMessages.test.ts](../../../play/src/front/Chat/Components/Room/RoomTimelineNewMessages.test.ts), testes de interação existentes                                                                                                             |
| Memória/recursos  | Encerrar operações e estabilizar após ciclos equivalentes | Perfil de retenção e testes de lifecycle do module realmente alterado                                                                                                                                                                                       |

Para uma futura alteração em `play`, seguir `play/AGENTS.md` e executar o teste focado pelo runner existente. Para `back`, seguir `back/AGENTS.md`. Mudança de protobuf exige geração pelo package `messages`. Não executar suítes de produto apenas para verificar texto de documentação.

### Limites de execução e reversão

Não atualizar dependências, reescrever linguagem, alterar protocolo ou adicionar infraestrutura para validar uma hipótese sem relação causal demonstrada. Workers, WASM, novo renderer e nova topologia de mídia permanecem alternativas condicionais. Novas dependências exigem autorização do projeto.

Separe mudanças de versão, configuração, renderização e arquitetura em comparações atribuíveis. Reversão de estado persistente/criptográfico precisa de compatibilidade própria; retornar uma versão de pacote não garante downgrade seguro. Reversão de replay precisa considerar conexões e mensagens já em trânsito.

Mantenha decisões descartadas com o motivo técnico relevante. Não apagar hipóteses refutadas: o cenário em que foram refutadas evita repetir investigação. Abra uma nova revisão quando mudar mapa, versão ou hardware e a evidência anterior deixar de representar o problema.

**Estado atual:** registro e plano preparados; causa e orçamento de desempenho continuam pendentes de medição. Escolher A02 inicia a discussão arquitetural; executar P0 inicia o diagnóstico de desempenho. Nenhuma dessas escolhas implica implementar os outros candidatos.
