# Travamento com oito pessoas: investigação e débitos técnicos

**Investigar desenho e proximidade no navegador, correlacionando com mídia, rede e processamento no backend. A causa do incidente ainda não foi reproduzida nem confirmada.**

Registro de 12/11/2026. Código de referência: `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`. O checkout contém alterações locais anteriores; este registro não representa uma instalação de produção identificada. A data é a da consolidação, não a de um benchmark com oito pessoas.

A [verificação da entrega](VALIDATION.md) registra os checks de documentação e do HTML. O [plano completo enviado ao Fable](FABLE-EXECUTION-PROMPT.md) define execução paralela, ownership, uso de SSH, prazo e entregas; sua existência não comprova execução ou correção concluída.

O relato é: oito pessoas na mesma sala tiveram travamentos gerais, inclusive sem câmeras. A pergunta inicial sobre economizar tráfego de sprites levou à verificação do cache; a investigação seguinte ampliou o foco para processamento e arquitetura.

## Navegação

1. [Escopo, estado e evidências](#escopo-estado-e-evidencias).
2. [Registro completo de hipóteses](#registro-completo-de-hipoteses).
3. [Oportunidades arquiteturais](architecture.md) e [relatório visual](architecture-review.html).
4. [Protocolo de investigação e critérios de encerramento](investigation-plan.md).
5. [Relação com a auditoria anterior e referências](#relacao-com-a-auditoria-anterior).

<a id="escopo-estado-e-evidencias"></a>

## Escopo, estado e evidências

Este documento registra todas as hipóteses levantadas nesta investigação e os débitos identificados no caminho do incidente. **Não certifica um inventário exaustivo de todos os débitos do monorepo.** Autenticação, editor, persistência de mapas, segurança, acessibilidade global, custos e migrações de dependências não receberam uma auditoria completa aqui.

As categorias não são equivalentes:

| Categoria                      | Significado                                                      | O que permite concluir                                                     |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Observação reproduzida         | Comportamento visto no teste local descrito                      | Válido para aquele cenário, quantidade de participantes e ambiente         |
| Mecanismo confirmado no código | Implementação identificada e referenciada                        | O caminho existe; sua contribuição para o incidente não foi medida         |
| Hipótese de desempenho         | Mecanismo pode explicar o relato                                 | Requer comparação e perfil antes de uma otimização                         |
| Débito arquitetural            | Conhecimento, ordenação ou configuração espalhados entre modules | Pode justificar investigação de depth e locality; não promete ganho de FPS |
| Lacuna de evidência            | Informação necessária ainda ausente                              | Impede atribuir a causa ou aceitar a solução                               |

### O que já foi observado

| Evidência                                                    | Resultado                                                                                               | Limite                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| E01: duas pessoas, primeira aparição de avatar personalizado | Seis pedidos de imagens com resposta 200                                                                | Um teste funcional, seis texturas específicas             |
| E02: avatar sai e retorna, observador permanece na cena      | Texturas preservadas; zero novos pedidos dessas sprites                                                 | Não mede oito usuários, WebSocket, mídia ou FPS           |
| E03: observador recarrega a página                           | Seis respostas 304; texturas renderizadas                                                               | Revalidação em desenvolvimento; cabeçalhos ainda trafegam |
| E04: pedido HTTP condicional de uma sprite                   | Primeiro corpo de 3.488 bytes; resposta condicional 304 sem corpo                                       | Não representa o tráfego total da página                  |
| E05: inspeção do código                                      | Cache, protobuf, envio periódico, agrupamento, filtragem espacial e renderização condicional já existem | Não comprova eficácia sob a carga relatada                |

Os registros originais foram preservados em [sprite-cache.browser.json](evidence/sprite-cache.browser.json) e [sprite-cache.http.json](evidence/sprite-cache.http.json). A origem e a integridade estão em [provenance.json](evidence/provenance.json). Uma navegação do visitante teve timeout; a reconexão foi depois confirmada pelo observador, com novo ID e seis texturas renderizadas. Isso é um resultado funcional, não uma medição de velocidade.

O ambiente local foi iniciado anteriormente em `http://play.workadventure.localhost/`, com Docker Compose e build de desenvolvimento. A fixture é um mapa mínimo. O host compartilha recursos com outras cargas. Esse ambiente serve para reproduções controladas, mas não estabelece a capacidade da instalação onde ocorreu o incidente.

### O que já está otimizado

| Caminho      | Implementação atual                                                                           | Consequência para a investigação                                                     |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Sprites      | `SuperLoaderPlugin` retorna o recurso já disponível no cache                                  | Não começar adicionando outro cache equivalente                                      |
| Movimento    | Protobuf binário; intervalo em torno de 200 ms, com exceções para mudança de direção e parada | Medir frequência e bytes reais; não tratar como envio de sprites a cada movimento    |
| Distribuição | Agrupamento de mensagens em torno de 100 ms e interesse por viewport/zonas                    | Verificar filas e destinatários efetivos antes de propor outro mecanismo equivalente |
| Desenho      | Dirty rendering, interpolação e atualização seletiva das bolhas                               | Medir trabalho restante, inclusive update sem desenho                                |
| Mídia        | Política P2P/LiveKit, transições, limpeza e adaptações já implementadas                       | Verificar a configuração e o comportamento efetivos                                  |

Referências: [cache](../../../play/src/front/Phaser/Services/SuperLoaderPlugin.ts#L127), [envio de posição](../../../play/src/front/Phaser/Game/GameScene.ts#L4375), [mensagem de posição](../../../play/src/front/Connection/RoomConnection.ts), [protobuf](../../../messages/protos/messages.proto), [pusher](../../../play/src/pusher/services/PusherWebSocket.ts), [renderização](../../../play/src/front/Phaser/Game/Game.ts#L52).

### O que ainda falta

Mapa e scripts do incidente; versão efetivamente instalada; número de participantes por conversa; provedor de mídia utilizado; configurações não sensíveis de grupo/recursos; dispositivos e redes; confirmação de quais controles congelam; perfis simultâneos do navegador e backend. Nenhum valor de `.env` ou credencial foi consultado para este registro.

Não há ranking estatístico de causas. As prioridades abaixo ordenam o valor da investigação:

- **P0:** produzir reprodução e evidências comparáveis.
- **P1:** testar cedo porque distingue grandes classes de causas.
- **P2:** investigar quando o sintoma correspondente aparecer.
- **P3:** mudança estrutural ou substituição condicionada a evidência adicional.

<a id="registro-completo-de-hipoteses"></a>

## Registro completo de hipóteses

Cada item permanece aberto até ser confirmado, refutado no cenário delimitado ou marcado como inconclusivo. Responsável significa área sugerida, não uma pessoa designada. Os ganhos e o esforço de implementação permanecem a estimar após o diagnóstico.

### Navegador e desenho

#### H01. Recriação gráfica das bolhas de conversa

- **Estado e prioridade:** mecanismo no código; impacto não medido; P1. Responsável: renderização.
- **Evidência:** [ConversationBubble.ts](../../../play/src/front/Phaser/Entity/ConversationBubble.ts#L115) calcula o contorno conforme os participantes. `drawSpline` cria Graphics, remove a textura anterior e gera outra. [GameScene.ts](../../../play/src/front/Phaser/Game/GameScene.ts#L1530) já restringe quais bolhas precisam de atualização.
- **Discriminador:** oito pessoas afastadas versus próximas, paradas versus andando. Medir tempo em `step`/`drawSpline`/geração de textura, alocações e duração dos quadros.
- **Soluções condicionais:** reutilizar recursos gráficos, reduzir segmentos, atualizar só quando a geometria mudar ou ajustar a frequência. Escolher a menor alteração que reduza o custo observado.
- **Preservar e encerrar:** contorno, suavização, grupos simultâneos e descarte das texturas. Não chamar de vazamento: a remoção anterior já existe. Encerrar sem otimização se o custo não for relevante no perfil representativo.

#### H02. Trabalho de atualização por quadro e rajadas de eventos

- **Estado e prioridade:** mecanismo no código; P1. Responsável: execução do jogo.
- **Evidência:** [Game.ts](../../../play/src/front/Phaser/Game/Game.ts#L52) atualiza a cena antes do teste de desenho; [GameScene.ts](../../../play/src/front/Phaser/Game/GameScene.ts#L1379) processa repositório de jogadores, eventos, interpolação, bolhas e câmera.
- **Discriminador:** menus, digitação e movimento local congelam juntos; comparar participantes parados e andando. Separar custo contínuo de uma rajada após reconexão.
- **Soluções condicionais:** eliminar recomputação, agrupar trabalho equivalente, reduzir coleções temporárias ou distribuir trabalho caro. O interpolador que produz coleção intermediária já aparece na auditoria anterior.
- **Preservar e encerrar:** ordem, parada final, interpolação/extrapolação, remoção e câmera que acompanha jogador. Não reduzir genericamente a frequência da simulação sem medir efeitos. Aceitar apenas ganho fora da variação das repetições.

#### H03. Mapa animado mantém desenho ativo

- **Estado e prioridade:** mecanismo no código; P1. Responsável: mapas/renderização.
- **Evidência:** [GameMapFrontWrapper.ts](../../../play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts#L282) calcula intervalo de animação, com mínimo de 16 ms; [Game.ts](../../../play/src/front/Phaser/Game/Game.ts#L104) considera tweens ativos. Existem caminhos de desenho adequados à GPU.
- **Discriminador:** uma pessoa parada já consome continuamente; mapa mínimo estático melhora mantendo dispositivos e participantes.
- **Soluções condicionais:** reduzir camadas sobrepostas, transparência e animação decorativa; invalidar apenas o conteúdo necessário; revisar animações fora da área visível.
- **Preservar e encerrar:** animações funcionais, profundidade e leitura do mapa. O timer, sozinho, não prova que todos os quadros sejam caros. Comparar quadros e GPU antes/depois.

#### H04. Resolução, GPU e limitações do dispositivo

- **Estado e prioridade:** uso de densidade confirmado; impacto dependente do dispositivo; P1. Responsável: renderização/compatibilidade.
- **Evidência:** [WaScaleManager.ts](../../../play/src/front/Phaser/Services/WaScaleManager.ts#L133) considera densidade; [HdpiManager.ts](../../../play/src/front/Phaser/Services/HdpiManager.ts) já ajusta dimensões/zoom; nomes usam composição DOM.
- **Discriminador:** registrar dimensões físicas do canvas, densidade, aceleração e uso de GPU. Comparar janela menor, outra máquina e mesma carga. Distinguir queda térmica após tempo de uso de custo inicial.
- **Soluções condicionais:** qualidade/resolução ajustável, efeitos mais baratos ou correção de incompatibilidade gráfica. Validar legibilidade e input após reduzir resolução.
- **Preservar e encerrar:** não confundir zoom das coordenadas com limite de pixels físicos. O gerenciador HDPI já existe. Mudança precisa beneficiar os dispositivos-alvo sem degradar texto e controles.

### Interface, conteúdo e duração da sessão

#### H05. Histórico de chat e atualização do DOM

- **Estado e prioridade:** estrutura observada; custo não medido; P2. Responsável: chat.
- **Evidência:** [RoomTimeline.svelte](../../../play/src/front/Chat/Components/Room/RoomTimeline.svelte#L281) deriva linhas; o bloco `each` monta itens carregados; ResizeObserver acompanha itens e rolagem.
- **Discriminador:** histórico curto versus longo, aberto versus fechado, imagens com alturas variáveis. Medir nós DOM, recálculo de estilo/layout, memória e latência de digitação.
- **Soluções condicionais:** janela de renderização, overscan e IDs estáveis; limitar recomputação. Paginação sozinha não limita o DOM acumulado.
- **Preservar e encerrar:** âncora de rolagem, não lidas, foco, threads, respostas, redaction, teclado e recibos. Decidir seleção e busca do navegador. Janela menor não garante menor retenção de histórico. Reusar os testes de timeline existentes antes de inventar outra superfície de teste.

#### H06. Scripts de mapa e páginas incorporadas

- **Estado e prioridade:** mecanismo confirmado; scripts do incidente desconhecidos; P1. Responsável: scripting/integrações.
- **Evidência:** [IframeListener.ts](../../../play/src/front/Api/IframeListener.ts#L695) registra scripts em iframes e recebe mensagens; [GameScene.ts](../../../play/src/front/Phaser/Game/GameScene.ts#L925) registra scripts do mapa.
- **Discriminador:** cópia diagnóstica do mapa sem scripts/sites, mantendo o restante. Atribuir timers, eventos e requisições ao frame/origem correspondente.
- **Soluções condicionais:** corrigir polling, agrupar eventos, suspender trabalho inativo e liberar listeners. Investigar ciclos em que uma alteração remota provoca a mesma alteração novamente apenas se o trace mostrar esse padrão.
- **Preservar e encerrar:** contratos de scripting e comportamento das integrações. Iframe oculto não significa inativo; frames de outras origens podem consumir outro processo. Medir o navegador agregado também.

#### H07. Primeira aparição, decodificação e construção de avatar

- **Estado e prioridade:** construção e cache confirmados; pico não medido; P2. Responsável: assets/avatares.
- **Evidência:** [Character.ts](../../../play/src/front/Phaser/Entity/Character.ts#L358) cria sprites por textura; [SuperLoaderPlugin.ts](../../../play/src/front/Phaser/Services/SuperLoaderPlugin.ts#L127) reutiliza recursos disponíveis; E01–E04 demonstram cache no caso local.
- **Discriminador:** entrada sequencial versus simultânea; avatares iguais versus distintos; primeira visita versus retorno. Separar download, decode, upload à GPU e construção.
- **Soluções condicionais:** pré-carregar o conjunto comum, reduzir dimensões exageradas, consolidar atlas compatíveis ou escalonar construção. Alterar cabeçalhos só se tráfego/revalidação forem o problema demonstrado.
- **Preservar e encerrar:** invalidação após alteração de conteúdo, URLs versionadas e avatares corretos. PNG pequeno não implica textura pequena em memória. Não extrapolar seis sprites para todo o catálogo.

#### H08. Cópia do mapa e criação das colisões

- **Estado e prioridade:** mecanismo confirmado; P2. Responsável: carregamento de mapas.
- **Evidência:** [GameScene.ts](../../../play/src/front/Phaser/Game/GameScene.ts#L1925) clona dados do mapa; [GameMapFrontWrapper.ts](../../../play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts#L219) constrói estruturas de colisão.
- **Discriminador:** pausas na entrada, troca ou reconstrução do mapa; medir pico de memória e CPU por dimensão/complexidade.
- **Soluções condicionais:** reduzir conteúdo, evitar reconstruções comprovadamente redundantes e investigar processamento parcial se o custo justificar.
- **Preservar e encerrar:** a cópia protege o cache contra mutações de scripting. Removê-la pode contaminar visitas seguintes. Copy-on-write ou worker exigem inventário de mutações e medição dos custos de transferência. Não explica sozinho travamento contínuo em repouso.

#### H09. Cálculo de caminhos

- **Estado e prioridade:** mecanismo confirmado; P2. Responsável: movimento.
- **Evidência:** [PathfindingManager.ts](../../../play/src/front/Utils/PathfindingManager.ts#L28) já limita o trabalho a 1.000 iterações por cálculo e cancela caminhos em limpeza.
- **Discriminador:** teclado versus clique para destino distante/inacessível, no mesmo mapa. Correlacionar picos com solicitações de caminho.
- **Soluções condicionais:** simplificar malha de colisão, ajustar orçamento de trabalho e cancelamento; considerar worker apenas após medir cálculo e transferência.
- **Preservar e encerrar:** destino, obstáculos, cancelamento e troca de mapa. Não apresentar processamento parcelado como recurso ausente.

#### H10. Retenção e limpeza durante sessões longas

- **Estado e prioridade:** risco a investigar; limpeza já existe; P2. Responsável: ciclo de vida do jogo/chat/mídia.
- **Evidência:** [GameScene.ts](../../../play/src/front/Phaser/Game/GameScene.ts#L1218) possui limpeza de scripts, timers e managers; [UsernameDisplay.ts](../../../play/src/front/Phaser/Components/UsernameDisplay.ts#L142) remove elemento e listener.
- **Discriminador:** repetir o mesmo ciclo de entrada/saída, coletar heap em checkpoints equivalentes e inspecionar objetos retidos. Recarregar melhora, mas esse sinal sozinho não comprova vazamento.
- **Soluções condicionais:** corrigir a referência retentora identificada, cancelar trabalho assíncrono e definir um responsável pelo descarte de cada recurso.
- **Preservar e encerrar:** distinguir cache intencional de objeto abandonado. Crescimento estabilizado pode ser aquecimento. Comparar cenas, texturas, nós destacados, listeners e conexões, sem limpar todos os caches indiscriminadamente.

### Mídia e proximidade

#### H11. Áudio, supressão e medidores sem câmera

- **Estado e prioridade:** mecanismo confirmado; P1. Responsável: áudio.
- **Evidência:** [Space.ts](../../../back/src/Model/Space.ts#L849) considera câmera, microfone ou compartilhamento para publicação; [RemotePeer.ts](../../../play/src/front/WebRtc/RemotePeer.ts#L462) acompanha áudio remoto periodicamente; [MediaStore.ts](../../../play/src/front/Stores/MediaStore.ts#L850) pode manter captura desabilitada com `keepAudioWarm`.
- **Discriminador:** fora de conversa; dentro sem publicação real; microfone; microfone com supressão. Inspecionar tracks, conexões, bytes e CPU, além dos ícones.
- **Soluções condicionais:** corrigir o processamento caro, usar processamento do navegador quando adequado ou reduzir cadência dos medidores. Interromper captura quando a semântica do produto exigir.
- **Preservar e encerrar:** mute, privacidade, retomada e inteligibilidade. Captura mantida não prova supressão ativa: existe parada quando o áudio está ausente/desabilitado no caminho correspondente.

#### H12. Quantidade de conexões P2P e transição para SFU

- **Estado e prioridade:** política confirmada; topologia instalada desconhecida; P1. Responsável: comunicação.
- **Evidência:** [TransitionPolicy.ts](../../../back/src/Model/Policies/TransitionPolicy.ts#L41), [validator](../../../back/src/Enum/EnvironmentVariableValidator.ts) e [Helm values](../../../contrib/helm/values.yaml#L57). `MAX_USERS_FOR_WEBRTC` e `MAX_PER_GROUP` têm padrão 4 no código; Helm exemplifica grupo 1.000.
- **Discriminador:** observar provider e conexões efetivas ao cruzar o limite real. Oito usuários no mapa não demonstram oito no mesmo space. Só uma malha completa de oito gera 28 pares e sete contrapartes por participante.
- **Soluções condicionais:** validar disponibilidade e uso saudável do LiveKit, corrigir a política/configuração ou limitar conversas se o P2P dominar.
- **Preservar e encerrar:** publicação, assinatura, espectadores e permissões. SFU não resolve sozinho GPU, chat ou scripts. Configuração presente não comprova conexão funcional; indisponibilidade impede a troca na política atual.

#### H13. Criação/destruição de conexões ao mudar de conversa

- **Estado e prioridade:** mecanismo confirmado; P1. Responsável: comunicação/proximidade.
- **Evidência:** [CommunicationManager.ts](../../../back/src/Model/CommunicationManager.ts#L136) já possui atraso de 20 segundos para retorno LiveKit→WebRTC e coordenação de transições.
- **Discriminador:** grupo imóvel versus entradas/saídas repetidas; correlacionar pausas com provider, quantidade de peers e eventos de conexão. Separar ativação atrasada da conversa com menus responsivos de congelamento de toda a página.
- **Espera distinta da troca de provider:** [ProximitySpaceManager.ts](../../../play/src/front/WebRtc/ProximitySpaceManager.ts#L14) documenta cancelamento necessário para não prender joins seguintes na espera de participantes; [ProximityChatRoom.ts](../../../play/src/front/Chat/Connection/Proximity/ProximityChatRoom.ts#L1827) possui backstop de nove segundos. Verificar a fila serializada da sala padrão, abort antes do primeiro peer e saída/reentrada rápida. Esse caso também fundamenta A02.
- **Soluções condicionais:** corrigir transições duplicadas, ownership de recursos ou critérios de mudança se o trace os demonstrar. Ajustar limites espaciais e histerese apenas após observar churn.
- **Preservar e encerrar:** progresso e convergência após falhas, saída limpa e ausência de peers duplicados. Não adicionar outro debounce sem considerar o já existente.

#### H14. ICE, TURN, UDP, VPN e tentativas de mídia

- **Estado e prioridade:** mecanismos de tentativa/configuração confirmados; falha de rede não observada; P2. Responsável: mídia/operação.
- **Evidência:** [SimplePeer.ts](../../../play/src/front/WebRtc/SimplePeer.ts) gerencia tentativas; [IceServersManager.ts](../../../play/src/front/WebRtc/IceServersManager.ts) consulta e renova configuração com recuo após falhas.
- **Discriminador:** rota selecionada, latência, perda, estado e repetição das negociações; comparar mesma pessoa em redes diferentes. Inspecionar metadados sem registrar credenciais.
- **Soluções condicionais:** corrigir reachability, endereço publicado, UDP/firewall, relay ou renovação comprovadamente defeituosos.
- **Preservar e encerrar:** TURN é uma rota válida, não evidência automática de erro. Não desabilitar segurança de rede como correção genérica. Explica áudio interrompido mais diretamente que menus congelados; para o segundo caso, medir contenção adicional.

### Backend, transporte e recursos

#### H15. Descarte deliberado de movimentos sob CPU alta

- **Estado e prioridade:** mecanismo confirmado; ocorrência no incidente desconhecida; P1. Responsável: backend de salas.
- **Evidência:** [SocketManager.ts](../../../back/src/Services/SocketManager.ts#L257) ignora `moving === true` quando `CpuTracker` acusa sobrecarga; posições finais paradas continuam. [CpuTracker.ts](../../../back/src/Services/CpuTracker.ts) mede CPU do processo em relação ao tempo transcorrido; o limite padrão é 80.
- **Discriminador:** alinhar o aviso `CPU high threshold alert` aos saltos remotos; verificar se controles locais seguem fluidos.
- **Soluções condicionais:** reduzir o trabalho do backend ou ajustar recursos. Avaliar a política de degradação com critério explícito se a capacidade estiver adequada.
- **Preservar e encerrar:** proteção contra sobrecarga e posição final. Apenas aumentar o limite pode piorar filas. Esse mecanismo isolado não congela o menu local.

#### H16. Cota de CPU e disputa pelo host

- **Estado e prioridade:** configuração efetiva desconhecida; P1. Responsável: operação.
- **Evidência:** templates Helm aplicam recursos configurados; valores de exemplo não medem capacidade. O indicador interno de CPU não é uma leitura de utilização total do host nem considera automaticamente a cota do contêiner.
- **Discriminador:** medir tempo de CPU limitado, cota, concorrência e atraso do event loop por processo. Um host com núcleos livres ainda pode limitar um processo.
- **Soluções condicionais:** corrigir cotas inadequadas ou competição; eliminar o hot path observado. Uma sala quente pode continuar limitada mesmo com réplicas extras.
- **Preservar e encerrar:** roteamento e ownership do estado por sala. Ausência de aviso de CPU não descarta throttling. Não atribuir o incidente remoto aos recursos do ambiente local.

#### H17. Memória, GC, I/O bloqueante e reinícios do backend

- **Estado e prioridade:** classe de hipótese operacional; sem perfil do incidente; P2. Responsável: backend/pusher/operação.
- **Evidência:** Node executa orquestração dos fluxos; ainda falta trace que atribua pausas a GC, caminho síncrono, log excessivo ou I/O. Não há vazamento identificado aqui.
- **Discriminador:** RSS/heap, pausas de GC, atraso do event loop, reinícios/OOM e duração dos caminhos durante o mesmo intervalo dos clientes. Redis, armazenamento e Matrix só entram como causa após ligação temporal com o caminho afetado.
- **Soluções condicionais:** corrigir retenção, alocações, chamada bloqueante ou volume de logs; ajustar memória quando a necessidade legítima estiver medida.
- **Preservar e encerrar:** durabilidade, mensagens de erro úteis e recuperação. Memória adicional pode adiar um vazamento. Custo de banco remoto não explica automaticamente trabalho local de desenho.

#### H18. Backpressure, retenção de mensagens e rajadas de recuperação

- **Estado e prioridade:** mecanismo confirmado; filas do incidente desconhecidas; P1. Responsável: transporte.
- **Evidência:** [PusherWebSocket.ts](../../../play/src/pusher/services/PusherWebSocket.ts) agrupa mensagens e pausa alimentação durante backpressure; [WorkAdventureWebSocket.ts](../../../play/src/front/Connection/WorkAdventureWebSocket.ts) retém mensagens e coordena reconexão.
- **Discriminador:** bytes e quantidade de mensagens, tempo de fila, drenagem, retenção e atraso do consumidor. Verificar se o congelamento termina em uma rajada.
- **Soluções condicionais:** conter produtor excessivo, corrigir consumidor lento e discutir limites de retenção; coalescer posições superadas somente após separar estado descartável de eventos duráveis.
- **Preservar e encerrar:** nonces, ordem, replay, rejeição explícita e reconexão. Não descartar mensagens genéricas. A auditoria anterior registra trabalho upstream relacionado; revalidar a situação antes de abrir trabalho duplicado.

#### H19. Proxy, timeout, perda de sessão e reinício

- **Estado e prioridade:** keepalive/reconexão confirmados; falha não observada; P2. Responsável: transporte/operação.
- **Evidência:** [PusherWebSocket.ts](../../../play/src/pusher/services/PusherWebSocket.ts) possui ping; [WorkAdventureWebSocket.ts](../../../play/src/front/Connection/WorkAdventureWebSocket.ts) possui recuo e retomada; perda da sala pode encerrar a recuperação.
- **Discriminador:** códigos de fechamento, logs do proxy, reinícios e periodicidade; alinhar horários entre participantes.
- **Soluções condicionais:** corrigir suporte a WebSocket, timeout incompatível, instabilidade do processo ou roteamento de sessão.
- **Preservar e encerrar:** autenticação, identidade e validade da sala. Não assumir que mais keepalive é a solução: o mecanismo já existe. Reconectar não implica necessariamente baixar novamente sprites.

#### H20. Rede compartilhada, perda e congestionamento

- **Estado e prioridade:** hipótese de ambiente; P2. Responsável: operação/suporte.
- **Evidência:** sem medições da rede dos participantes. Pequenas mensagens continuam dependendo de entrega e latência; mídia pode disputar o mesmo enlace.
- **Discriminador:** comparar participantes na mesma rede e em redes distintas; medir RTT, perda e variação, usando um caminho de referência autorizado. Verificar upload ocupado, Wi-Fi e VPN.
- **Soluções condicionais:** corrigir o enlace ou a rota identificada, reduzir carga de mídia e ajustar localização da infraestrutura quando a latência for demonstradamente dominante.
- **Preservar e encerrar:** mesmos dispositivos e mapa durante A/B. Todos travarem juntos pode indicar rede comum, backend ou evento do mapa; não é prova isolada de servidor lento.

### Build, compatibilidade e fatores externos

#### H21. Build de desenvolvimento e instrumentação

- **Estado e prioridade:** ambiente local de desenvolvimento confirmado; ambiente do incidente desconhecido; P1 para validade do experimento. Responsável: build/operação.
- **Evidência:** a execução local usa Vite e processos de desenvolvimento. O teste de cache usou essa configuração.
- **Discriminador:** cenário equivalente com build de produção, mesmas versões e recursos. Considerar sobrecarga do próprio profiler; manter medições leves como controle.
- **Soluções condicionais:** corrigir implantação que use build inadequado; evitar medir capacidade com hot reload, compilação concorrente ou oito abas no mesmo host.
- **Preservar e encerrar:** nenhuma melhora local comprova capacidade de produção. Documentar diferenças em vez de misturar os resultados.

#### H22. Regressão de versão, extensões e estado do navegador

- **Estado e prioridade:** hipótese de compatibilidade; P2. Responsável: frontend/build/suporte.
- **Evidência:** o projeto possui patches locais, inclusive [Phaser](../../../patches/phaser+4.2.0.patch); não foi identificada regressão específica. Extensões interferiram na automação anterior, o que não comprova interferência no incidente dos usuários.
- **Discriminador:** comparar versões conhecidas, perfil limpo e perfil usual, mesma máquina e mapa; registrar aba visível/oculta, economia de energia e versão do navegador. Conferir aplicação dos patches.
- **Soluções condicionais:** corrigir ou reverter a alteração isolada, restaurar patch necessário ou documentar incompatibilidade reproduzida. Ajustar comportamento em segundo plano quando fizer parte do requisito.
- **Preservar e encerrar:** não recomendar atualização geral como diagnóstico. Não transformar falha da ferramenta de automação em causa de travamento do produto.

### Combinações e critérios para descartar

Entrada em conversa pode disparar H01, H11 e H13 ao mesmo tempo. Um navegador saturado por H02 pode consumir mensagens lentamente e revelar H18. H16 pode atrasar heartbeat e produzir H19. Histórico crescente de H05 pode reduzir a margem para um pico de H07.

Um resultado negativo descarta apenas a hipótese no cenário medido. Se a comparação não reproduzir o sintoma, classificar como inconclusiva. A solução pode exigir reduzir dois custos; isso não autoriza modificar todos os caminhos simultaneamente.

## Débitos e responsáveis pela investigação

| ID  | Débito ou lacuna                                                                    | Estado                                                                              | Encaminhamento                                                  |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| D01 | Falta de baseline correlacionada para o incidente de oito pessoas                   | Lacuna confirmada desta investigação; não afirma ausência global de observabilidade | P0, executar o protocolo e conservar evidências                 |
| D02 | Ownership e invariantes do desenho da conversa entre cena, grupo e textura          | Candidato arquitetural, A01                                                         | Revisar depth após H01/H02                                      |
| D03 | Ordenação/cancelamento de sessões de proximidade e transições de mídia distribuídos | Candidato arquitetural, A02                                                         | Relacionar H11–H14 às interfaces e testes atuais                |
| D04 | Diagnóstico de capacidade depende de configuração efetiva dispersa                  | Fricção confirmada: defaults e Helm divergem; A03                                   | Registrar configuração não sensível e política efetiva          |
| D05 | Semântica de fila, backpressure e recuperação distribuída entre cliente e pusher    | Candidato arquitetural, A04                                                         | Medir H18/H19; preservar contratos e conferir trabalho anterior |
| D06 | Ownership de timeline, observação e navegação do histórico                          | Candidato arquitetural, A05                                                         | Medir H05 e revisar testes comportamentais                      |
| D07 | Cobertura do ciclo de vida e do cenário com oito pessoas não demonstrada            | Lacuna de verificação, não afirmação de ausência de testes                          | Inspecionar casos existentes e acrescentar apenas lacunas reais |

As [oportunidades arquiteturais](architecture.md) aplicam o deletion test e diferenciam deepening de mera extração de arquivos. Nenhuma interface nova ou refatoração de produto foi definida nesta etapa.

<a id="relacao-com-a-auditoria-anterior"></a>

## Relação com a auditoria anterior

O pacote [performance-1000-users](../performance-1000-users/README.md) foi preservado sem edição. Ele contém inventário, planos de atualização e capacidade, incluindo interpolação, janela de chat e retenção de reconexão. Suas afirmações temporais sobre versões e PRs pertencem à consulta de 11/11/2026 e precisam de revalidação antes de execução.

Este documento acrescenta o relato específico de oito pessoas, a evidência funcional de cache, o registro H01–H22 e os testes que diferenciam as hipóteses. A meta de 1.000 usuários não é critério de aceite deste incidente. Também não se deve concluir que resolver oito usuários prova capacidade para 1.000.

## Referências externas

As fontes abaixo explicam as técnicas de diagnóstico; nenhuma contém evidência do incidente desta instalação.

- [Chrome: análise de desempenho](https://developer.chrome.com/docs/devtools/performance), tarefas e quadros.
- [Chrome: problemas de memória](https://developer.chrome.com/docs/devtools/memory-problems), heap e nós destacados.
- [MDN: boas práticas WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices), resolução e custos gráficos.
- [Docker: limites de recursos](https://docs.docker.com/engine/containers/resource_constraints), CPU e memória.
- [Node: perf_hooks](https://nodejs.org/api/perf_hooks.html), atraso e utilização do event loop.
- [LiveKit: conectividade](https://docs.livekit.io/intro/basics/connect/), estabelecimento e fallback de transporte.

**Próxima ação:** executar a captura inicial de 60 segundos descrita no [protocolo](investigation-plan.md), com participantes já presentes, antes de escolher a primeira otimização de produto.
