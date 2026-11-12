# Capacidade e volume de dados

## O que foi medido

O inventário de arquivos do commit ddbe245a8 registra 123.711.003 bytes, aproximadamente 123,7 MB decimais ou 118,0 MiB. `play/public` contém 933 arquivos e 38.526.877 bytes. `maps/tests/BigMap/map.json` sozinho ocupa 17.380.422 bytes e é um mapa de teste. Nada disso é o bundle transferido para uma sessão real.

Não foram medidos usuários simultâneos suportados, FPS, RAM de uma aba, heap dos serviços, latência de mensagens, tráfego por sessão, tamanho do build ou dados persistidos de uma implantação. Não há uma base de produção neste checkout para contar usuários, mensagens, mapas ou anexos.

## Recursos dos servidores

| Componente/cenário | Referência disponível | Interpretação correta |
|---|---|---|
| Núcleo aberto em Docker Compose | 2 CPUs, 4 GB RAM, até 300 usuários concorrentes, segundo contrib/docker/README.md:11 | Orientação do projeto, não benchmark reproduzido. Exclui o dimensionamento de LiveKit e Coturn. |
| Implantação com painel comercial | 4 CPU/8 GB de base + 1 CPU/1 GB por 100 usuários concorrentes | Topologia diferente do repositório aberto. Não somar ou substituir diretamente a recomendação do núcleo. |
| LiveKit SFU | Documentação recomenda servidores de computação e rede de 10 Gbps ou mais para produção | CPU, pacotes por segundo, banda e maior sala importam. A recomendação de rede não é um mínimo universal para um piloto. |
| LiveKit Egress | Pelo menos 4 CPU/4 GB por instância recomendados; composição de sala pode consumir 2–6 CPUs | Gravação/composição tem custo separado do encaminhamento SFU. |
| Compilação do Play | Guia local oferece limite de heap de 16.384 MiB para contornar falta de memória no build | É ajuste de build, não RAM mínima de runtime nem consumo medido. |

Fontes: [Compose local](https://github.com/workadventure/workadventure/blob/ddbe245a84c78c947dd9ae5310da1fc53cd3d278/contrib/docker/README.md#L7), [painel comercial](https://docs.workadventu.re/admin/admin-self-hosting/), [LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/), [Egress](https://docs.livekit.io/transport/self-hosting/egress/), [problemas de build](https://github.com/workadventure/workadventure/blob/ddbe245a84c78c947dd9ae5310da1fc53cd3d278/docs/agent/common-issues.md#L5).

## Modelo de movimento

Para movimento contínuo, o cliente usa intervalo de 200 ms, equivalente a cerca de 5 atualizações por segundo. Transições e outros eventos alteram essa taxa. Um modelo simplificado de payload de saída é:

`bytes/s ≈ usuários em movimento × atualizações/s × destinatários relevantes × bytes por atualização`

Exemplo puramente ilustrativo: 300 usuários × 5/s × 20 destinatários × 100 bytes = 3 MB/s, ou 24 Mbit/s. Se cada atualização fosse enviada a outros 299 usuários, seriam 44,85 MB/s, ou 358,8 Mbit/s. O valor de 100 bytes é uma hipótese para demonstrar a fórmula; não é tamanho medido de um pacote do WorkAdventure. A implementação filtra por viewport/zonas e agrupa mensagens, portanto não usa indiscriminadamente o segundo caso. Headers, ACKs, TLS, WebSocket, gRPC e outros tipos de evento não estão contabilizados.

A consequência é que densidade visível e distribuição entre salas importam tanto quanto o número total de conexões. Contar conexões ociosas não mede a capacidade de uma sala movimentada.

## Modelo de mídia

O código usa curvas de orçamento por resolução, codec, qualidade e número de camadas. Referência: [VideoPresets.ts](https://github.com/workadventure/workadventure/blob/ddbe245a84c78c947dd9ae5310da1fc53cd3d278/play/src/front/WebRtc/VideoPresets.ts#L95).

| Referência de orçamento | Valor |
|---|---:|
| Câmera VP9 720p recomendada, uma camada | 0,7 Mbit/s |
| Câmera VP9 720p alta, uma camada | 1,8 Mbit/s |
| Compartilhamento AV1 1080p recomendado, uma camada | 3 Mbit/s |
| Compartilhamento AV1 1080p alto, uma camada | 4,5 Mbit/s |

Esses valores não são constantes universais do tráfego. Tiles menores recebem orçamentos menores; camadas SVC/simulcast, codec negociado, adaptação de congestionamento, áudio e headers alteram o total. Na curva, VP9 custa fator 1,4 em relação a AV1, e H.264/VP8 fator 2 para a mesma referência de qualidade. A âncora de câmera já está expressa em VP9; não se deve multiplicá-la por 1,4 outra vez.

Em uma bolha P2P de N pessoas, cada pessoa pode enviar N−1 cópias. Para quatro pessoas, supondo 0,7 Mbit/s por vídeo recebido em resolução plena, cada uma envia cerca de 2,1 Mbit/s e a bolha soma 8,4 Mbit/s de fluxos direcionais. Isso ignora áudio e protocolo; o código pode reduzir muito o bitrate em tiles pequenos.

No SFU, o cliente publica suas trilhas e o servidor encaminha apenas o que cada receptor assina. Para N=10 e todas as nove câmeras remotas a 0,7 Mbit/s, um modelo de uma camada dá 7 Mbit/s de entrada no SFU e 63 Mbit/s de saída. Adaptive stream, dynacast e assinaturas por visibilidade reduzem esse cenário quando aplicáveis. SFU reduz o trabalho repetido de upload/encoders no cliente; não elimina o custo de distribuição do servidor.

A 0,7 Mbit/s constante, uma direção de câmera consome 315 MB por hora. A 3 Mbit/s constante, uma direção de compartilhamento consome 1,35 GB por hora. Receber cinco fluxos soma aproximadamente os cinco bitrates. TURN retransmite os fluxos que não conseguem conexão direta e precisa de banda de entrada e saída. A porcentagem de usuários que usa TURN depende da rede real.

## Armazenamento

`crescimento de disco ≈ novos mapas/assets + anexos de chat + gravações + backups + logs − dados removidos pela retenção`

Mapas e assets dependem dos mundos publicados; mensagens e anexos dependem do servidor Matrix; gravações dependem de Egress e armazenamento de objetos. Uma gravação com bitrate médio de 3 Mbit/s, por exemplo, gera aproximadamente 1,35 GB por hora antes de particularidades do contêiner e outros fluxos. Isso é um modelo, não a configuração efetiva de gravação desta implantação.

## Recursos dos clientes

O projeto suporta versões recentes de Chrome, Edge, Firefox, Safari e navegadores móveis correspondentes. Funcionalidades não são iguais em todos: compartilhamento de áudio e picture-in-picture têm restrições de navegador. Fonte: [requisitos de navegador](https://workadventu.re/privacy-policy/), [compartilhamento](https://docs.workadventu.re/user/screen-sharing/).

Não foi encontrada uma especificação geral certificada de CPU/RAM/GPU mínima. É necessário distinguir renderização WebGL do mapa, trabalho JavaScript/Svelte, decodificação dos vídeos, codificação de câmera/tela, efeitos de fundo e iframes de terceiros. Uma GPU integrada e um processador com codecs em hardware podem se comportar muito melhor que outro dispositivo com a mesma RAM.

Como matriz de ensaio proposta, e não mínimo garantido, usar notebook de 4 CPUs lógicas/8 GB, notebook de 8 CPUs lógicas/16 GB e um celular intermediário real. Testar mapa simples, mapa denso, quatro participantes P2P, reunião SFU, compartilhamento de tela e efeitos de fundo separadamente. O gate de quatro CPUs lógicas no código de efeitos é específico dessa função, não do aplicativo inteiro.

Uma textura RGBA de 4096×4096 requer 64 MiB por cópia sem compressão, independentemente do tamanho pequeno do PNG. Mipmaps e cópias adicionais podem aumentar o uso. Um quadro RGBA 1920×1080 ocupa aproximadamente 7,9 MiB; pipelines de vídeo podem manter vários quadros e usar outros formatos. Esses cálculos explicam por que download pequeno não garante pouco consumo de RAM/VRAM.
