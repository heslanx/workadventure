# Definir e comprovar 1.000 usuários

**A meta precisa passar simultaneamente nos servidores e nos aparelhos reais.** Mil conexões não implicam mil avatares visíveis nem mil vídeos decodificados por cliente. Este documento define experimentos propostos, não capacidade já demonstrada.

## Cinco cenários de aceitação

| Ordem | Cenário | Carga proposta | O que separa |
|---|---|---|---|
| 1 | Presença distribuída | 1.000 sessões aceitas, 20 salas de 50, 30% em movimento, viewport típico com cerca de 20 avatares | Sockets, zonas, gRPC, backend e reconexão sem custo de mídia |
| 2 | Conversas simultâneas | 1.000 usuários em 250 grupos de quatro; variantes sem câmera, P2P direto, TURN e SFU | CPU de encode/decode, banda dos clientes, relay e SFU. O cenário SFU precisa ser configurado explicitamente |
| 3 | Uma sala lotada | 1.000 usuários na mesma sala; repetir com 20, 100, 500 e 1.000 avatares visíveis | Limite do proprietário da sala, fanout, interpolação e GPU. Visibilidade de 1.000 é stress, não promessa inicial |
| 4 | Apresentação | Um apresentador e 1.000 espectadores; tela com e sem câmera | Banda de saída, assinaturas e capacidade de mídia, com participação de audiência limitada |
| 5 | Uso prolongado e falhas | Quatro horas de chat, paginação, troca de sala, reconexão e edição; inclui usuários que entram/saem | Crescimento de memória, replay, temporizadores, durabilidade e limpeza |

Nos defaults auditados, `MAX_PER_GROUP` e `MAX_USERS_FOR_WEBRTC` são ambos quatro. A bolha espontânea fica limitada antes de ultrapassar o limiar do SFU. Espaços de reunião, alterações desses limites e fallback têm comportamento próprio. Não assumir que o cenário 2 usa LiveKit automaticamente.

## Metas propostas para iniciar a discussão

| Medida | Critério inicial proposto | Limite de interpretação |
|---|---|---|
| Capacidade | 1.000 sessões aceitas por 60 minutos; depois testar rajada de 1.300 por cinco minutos | Contar aceitação na sala, não apenas sockets abertos. Tratar 1.300 como folga experimental |
| Entrada | p95 até cinco segundos do início da conexão até sala utilizável | Medir carga fria de assets separadamente, com rede e mapa fixos |
| Movimento | p95 até 250 ms e p99 até 500 ms da emissão do evento ao desenho remoto, com RTT de rede até 50 ms | A cadência de movimento pode acrescentar até 200 ms antes da emissão. Medir também entrada física ao desenho |
| Fluidez | Frame time p95 até 33,3 ms nos aparelhos modestos escolhidos; acompanhar p99 e travamentos | 30 FPS é piso experimental; 60 FPS é alvo nos aparelhos capazes. Não esconder travamentos em média de FPS |
| Estabilidade e custo | Sem crescimento contínuo de retenção após aquecimento; sem erros/reconexões inesperados; registrar custo por usuário-hora e GB | Falta baseline para definir teto de RAM e orçamento monetário. Injeções de falha são avaliadas separadamente |

Esses números são propostas de produto/engenharia. Nenhum foi atingido ou medido nesta auditoria. Não são requisitos oficiais do WorkAdventure. Escolher dois aparelhos modestos reais e registrar modelo, RAM, CPU/GPU, sistema, navegador, resolução, DPR, codecs e temperatura antes de congelar os critérios.

## Dimensionar a partir do que muda a carga

O servidor principal mantém presença e coordenação. A mídia usa P2P/TURN ou SFU e precisa de orçamento separado. Matrix/Synapse, Redis, armazenamento, proxy e eventual egress também devem ter métricas próprias.

Em distribuição P2P completa de grupos de quatro, cada participante pode enviar três cópias e receber três streams. Com 0,7 Mbps por câmera, isso sugere até 2,1 Mbps em cada direção por participante, antes de áudio e overhead. É um modelo simplificado, não tráfego medido. TURN muda onde esse tráfego passa e sua conta de rede.

Uma tela publicada a 3 Mbps para 1.000 assinantes representa aproximadamente **3 Gbps de saída de mídia**, ou **1,35 TB por hora** em bytes decimais, antes de overhead, retransmissão e camadas adicionais. Uma câmera de 0,7 Mbps assinada por todos acrescentaria aproximadamente 0,7 Gbps. O cálculo mostra por que política de mídia pode importar mais para custo que linguagem do backend. As taxas são cenários de modelagem baseados no orçamento configurado, não médias reais.

Para cada serviço, estimar `RAM = base + sessões × memória incremental + salas/mapas + filas/caches + buffers nativos + margem`. Medir heap, RSS e memória do container separadamente. O limite de replay de 4 MiB por socket proposto em #6688, se atingido por 1.000 sockets, ainda permite cerca de 3,91 GiB só de payload; limite não significa consumo normal nem dimensionamento suficiente.

A escolha atual de proprietário da sala usa hash módulo quantidade de backends. Mais réplicas não dividem automaticamente uma sala quente; mudar a quantidade remapeia salas. Testar redistribuição e reconexão antes de recomendar HPA. Os valores Helm sem requests/limits e sem HPA efetivo não fornecem capacidade comprovada.

A documentação pública de auto-hospedagem e a [orientação LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/) descrevem topologias e condições diferentes. Não extrapolar linearmente um número antigo de usuários para comprar infraestrutura. A [documentação de benchmark LiveKit](https://docs.livekit.io/transport/self-hosting/benchmark/) serve para desenhar o teste de mídia, não para certificar esta instalação.

## Procedimento de medição futura

1. Restaurar o gerador de protocolo e comprovar entrada, movimento e saída com um usuário. O script atual tem import inexistente e assinatura obsoleta. Registrar pré-requisitos de geração protobuf.
2. Rodar 100, 250, 500 e 1.000 sessões em gerador separado do servidor. Registrar carga do gerador para não atribuir sua saturação ao produto.
3. Acrescentar navegadores reais nos dois aparelhos modestos, enquanto a carga artificial permanece. Bots de protocolo não reproduzem DOM, GPU, codecs, câmera ou termalização.
4. Intercalar pelo menos cinco repetições válidas de base/candidato com o mesmo mapa, roteiro, imagens e rede. Apresentar mediana, p95/p99, dispersão e logs brutos. Não usar snapshots com GC forçado como substituto do comportamento natural.
5. Executar soak e falhas depois dos testes curtos. Publicar CPU, RSS/heap, event-loop lag, bytes/eventos, banda, tracks/decoders ativos, frame times e custo por usuário-hora. Encerrar todos os geradores e restaurar fault injection ao terminar.

Para PR puramente de performance, um limiar inicial é melhoria de pelo menos 10% na métrica alvo, fora do ruído, sem regressão superior a 5% nas demais métricas controladas. Esses limiares são propostas para decidir se vale manter complexidade. Correções de bug ou manutenção podem valer sem atingir 10%, desde que apresentadas honestamente e sem regressão material.

Nenhuma máquina, serviço pago ou ambiente de carga foi provisionado nesta tarefa. O sizing final depende desses resultados, especialmente da quantidade de vídeos e avatares visíveis por cliente.
