from datetime import datetime
from html import escape
from pathlib import Path
import os


REPORT_DIR = Path('docs/audits/eight-user-performance').resolve()

CANDIDATES = [
    {
        'id': 'A02', 'title': 'Uma sessão de proximidade com um dono',
        'strength': 'Strong', 'category': 'mock · transporte remoto', 'refs': 'H10 · H11 · H13 / D03 · D07',
        'files': ['play/src/front/WebRtc/ProximitySpaceManager.ts', 'play/src/front/Chat/Connection/Proximity/ProximityChatRoomManager.ts', 'play/src/front/Chat/Connection/Proximity/ProximityChatRoom.ts', 'play/src/front/Space/SpaceRegistry/SpaceRegistry.ts'],
        'problem': 'A interface efetiva exige conhecer abort, serialização, espera de participantes e descarte em vários modules.',
        'solution': 'Concentrar identidade, cancelamento e término da operação no module da sessão; preservar histórico no chat e transporte no registry.',
        'seam': 'A seam existente RoomConnectionForSpacesInterface possui adapter real e MockRoomConnectionForSpaces. Outra interface genérica não é necessária por antecipação.',
        'deletion': 'Excluir repasse remove indirection; excluir ordenação espalha a mesma complexidade pelos consumidores. A depth precisa concentrar essa responsabilidade.',
        'wins': ['locality: cancelamento em um module', 'leverage: entrada e saída consistentes', 'interface: verificar operações obsoletas'],
        'test': 'Entrar, sair e reentrar; abort antes do primeiro peer; destruir durante join; preservar histórico. Reusar testes de ProximitySpaceManager, ChatRoomManager e SpaceRegistry.',
        'gate': 'Strong significa explorar ownership. As proteções atuais podem já cobrir o incidente; não há vazamento comprovado.',
        'before': ['Evento do grupo', 'Abort + serialização', 'ChatRoom + espera', 'Registry + descarte'],
        'after': ['Mudança de presença', 'Module deep da sessão', 'Chat / registry preservados'],
        'pattern': 'stack',
    },
    {
        'id': 'A01', 'title': 'A bolha concentra suas regras de atualização',
        'strength': 'Worth exploring', 'category': 'in-process', 'refs': 'H01 · H02 · H03 / D02',
        'files': ['play/src/front/Phaser/Game/GameScene.ts', 'play/src/front/Phaser/Entity/ConversationBubble.ts', 'play/src/front/Phaser/Game/Game.ts'],
        'problem': 'Cena e bolha compartilham conhecimento de influência, avatares, animação e vida da textura.',
        'solution': 'Aprofundar o module da bolha para possuir pertencimento, invalidação e necessidade de desenho, com implementation gráfica interna.',
        'seam': 'Phaser é o único adapter de desenho observado. Uma seam universal de renderer seria hipotética; começar pelo cálculo in-process.',
        'deletion': 'Uma fachada shallow só acrescenta repasse. Remover o module deep redistribuiria geometria e descarte pela cena.',
        'wins': ['depth: regras exigem menos contexto', 'locality: geometria e invalidação juntas', 'leverage: movimento local e remoto'],
        'test': 'Bolha estável para de desenhar; influência muda o contorno; retirada e destruição liberam recursos. Não confundir balão de fala com contorno de conversa.',
        'gate': 'Já há seleção de bolhas afetadas e índice espacial. Medir geração de textura antes de otimizar.',
        'pattern': 'mermaid',
        'before_graph': 'flowchart TB\n  S["Cena: influencia e avatares"] --> B["Bolha: geometria"]\n  B --> S\n  B --> T["Textura e descarte"]\n  classDef cross fill:#fff7ed,stroke:#b45309,color:#273244;\n  class S,B cross;',
        'after_graph': 'flowchart TB\n  W["Mudancas do mundo"] --> D["Module deep da bolha"]\n  D --> R["Implementation de desenho"]\n  classDef deep fill:#172e2b,stroke:#172e2b,color:#ffffff;\n  class D deep;',
    },
    {
        'id': 'A04', 'title': 'Entrega e recuperação com garantias locais',
        'strength': 'Worth exploring', 'category': 'in-process · mock', 'refs': 'H15 · H18 · H19 / D05',
        'files': ['play/src/pusher/services/PusherWebSocket.ts', 'play/src/common/NoncedMessageStore.ts', 'play/src/front/Connection/WorkAdventureWebSocket.ts', 'back/src/Services/SocketManager.ts'],
        'problem': 'A interface efetiva exige regras de flush, nonces, replay e drenagem; retenção por tempo não estabelece limite de bytes.',
        'solution': 'Aprofundar garantias nos modules de entrega existentes; manter o orçamento de aplicação da cena separado da ordenação do transporte.',
        'seam': 'O cliente já possui seam com factory e FakeWebSocket como adapter de teste. Cliente e pusher não são adapters intercambiáveis.',
        'deletion': 'Remover retenção perde reconexão ou espalha replay. Uma nova fachada shallow de fila não aumenta depth.',
        'wins': ['locality: entrega possui suas garantias', 'leverage: consumidores dispensam flush manual', 'interface: exaustão tem resultado verificável'],
        'test': 'Ordem patch/resposta, drain, limite de retenção, replay sem duplicação e parada final. Reusar testes de WebSocket e SpaceStateQuery.',
        'gate': 'Medir crescimento da fila; preservar eventos duráveis. Conferir trabalho upstream registrado na auditoria anterior.',
        'pattern': 'mermaid',
        'before_graph': 'flowchart TB\n  C["Consumidor conhece flush"] --> P["Pusher e store"]\n  P --> W["Cliente e replay"]\n  W --> S["Cena drena fila"]',
        'after_graph': 'flowchart TB\n  C["Consumidor"] --> D["Module deep de entrega"]\n  D --> S["Cena: custo de aplicacao observavel"]\n  classDef deep fill:#172e2b,stroke:#172e2b,color:#ffffff;\n  class D deep;',
    },
    {
        'id': 'A05', 'title': 'A timeline possui projeção e âncoras',
        'strength': 'Worth exploring', 'category': 'in-process · DOM', 'refs': 'H05 · H10 / D06',
        'files': ['play/src/front/Chat/Connection/ChatConnection.ts', 'play/src/front/Chat/Connection/Proximity/ProximityTimelineItemsStore.ts', 'play/src/front/Chat/Components/Room/RoomTimeline.svelte'],
        'problem': 'A view coordena coleções inteiras, agrupamento, paginação, não lidas e geometria DOM.',
        'solution': 'Concentrar projeção estável e âncoras no module da timeline; providers conservam busca e significado das mensagens.',
        'seam': 'ChatRoom é uma seam existente com Matrix e Proximity como adapter. Outra interface genérica de provider não acrescenta variação real.',
        'deletion': 'Remover ownership das âncoras espalha conhecimento entre views. Extrair apenas map/sort não cria depth.',
        'wins': ['locality: âncora e projeção juntas', 'leverage: Matrix, proximidade e threads', 'interface: leitura e foco verificáveis'],
        'test': 'Prepend sem salto, append durante leitura, não lidas, redaction, perguntas e troca de sala. Preservar seleção, foco e recibos.',
        'gate': 'Oito participantes não implicam histórico grande. Medir DOM e chat visível antes de escolher janela de renderização.',
        'before': ['Provider: histórico', 'View: agrupa + pagina', 'View: âncoras + leitura', 'DOM: itens atuais'],
        'after': ['Providers existentes', 'Module deep da timeline', 'View: projeção estável'],
        'pattern': 'stack',
    },
    {
        'id': 'A03', 'title': 'Uma captura que explica o mesmo instante',
        'strength': 'Speculative', 'category': 'in-process', 'refs': 'H01–H22 / D01 · D04',
        'files': ['back/src/Services/CpuTracker.ts', 'play/src/front/WebRtc/CpuLimitationDetector.ts', 'play/src/front/Phaser/Game/Game.ts', 'back/src/Enum/EnvironmentVariableValidator.ts', 'contrib/helm/values.yaml'],
        'problem': 'CPU do processo, limitação do encoder, quadros e joins têm semânticas distintas; não há captura correlacionada do incidente.',
        'solution': 'Capturar primeiro com ferramentas existentes. Explorar um module próprio apenas se correlação e limites se repetirem em consumidores reais.',
        'seam': 'Nenhuma seam comum foi estabelecida. Um adapter genérico de analytics seria hipotético; preservar a depth do detector de mídia existente.',
        'deletion': 'Se retirar o module não duplicar correlação entre consumidores, ele não se justifica. Uma interface que só repassa logs não resolve o problema.',
        'wins': ['locality: origem e unidade explícitas', 'leverage: reprodução comparável', 'depth: somente após necessidade demonstrada'],
        'test': 'Limites de duração/tamanho, ordem, teardown e mídia desligada. A captura não inclui tokens, áudio ou conteúdo de chat.',
        'gate': 'Necessidade de investigar: Strong. Novo module: Speculative. Ausência de padrões no código inspecionado não audita telemetria externa.',
        'before': ['Quadros e desenho', 'CPU e quotas', 'Encoder e peers', 'Filas e joins'],
        'after': ['Fontes com origem e tempo', 'Captura limitada e correlacionada', 'Evidência para decidir'],
        'pattern': 'stack',
    },
]


def boxes(labels, deep=False):
    items=[]
    for index,label in enumerate(labels):
        style='block deep' if deep and index==1 else 'block'
        items.append(f'<div class="{style}">{escape(label)}</div>')
        if index<len(labels)-1:
            items.append('<svg class="arrow" width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M9 1v16m-5-5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>')
    return '<div class="diagram-stack">'+''.join(items)+'</div>'


def card(c):
    before = '<pre class="mermaid">'+escape(c['before_graph'])+'</pre>' if c['pattern']=='mermaid' else boxes(c['before'])
    after = '<pre class="mermaid">'+escape(c['after_graph'])+'</pre>' if c['pattern']=='mermaid' else boxes(c['after'],True)
    status={'Strong':'strong','Worth exploring':'explore','Speculative':'speculative'}[c['strength']]
    files=''.join(f'<li><a href="../../../{escape(p)}">{escape(p)}</a></li>' for p in c['files'])
    wins=''.join('<li>'+escape(w)+'</li>' for w in c['wins'])
    return f'''<article id="{c['id']}" class="candidate">
      <div class="card-heading"><span class="id">{c['id']}</span><div><div class="badges"><span class="badge {status}">{c['strength']}</span><span class="tag">{c['category']}</span></div><h2>{c['title']}</h2><p class="refs">{c['refs']}</p></div></div>
      <div class="diagrams"><figure><figcaption>Antes · conhecimento distribuído</figcaption>{before}</figure><figure><figcaption>Depois · ownership proposto</figcaption>{after}</figure></div>
      <div class="card-copy"><div><h3>Problema</h3><p>{c['problem']}</p></div><div><h3>Direção de mudança</h3><p>{c['solution']}</p></div></div>
      <div class="analysis"><p><strong>Seam / adapter.</strong> {c['seam']}</p><p><strong>Deletion test.</strong> {c['deletion']}</p></div>
      <ul class="wins">{wins}</ul>
      <p class="test"><strong>Testes pela interface.</strong> {c['test']}</p>
      <p class="caveat">{c['gate']}</p>
      <div class="files"><h3>Files</h3><ul>{files}</ul></div>
    </article>'''


CSS = '''
:root{--paper:#f6f4ee;--ink:#202c2b;--muted:#586560;--line:#d6dcd5;--green:#215a44;--amber:#805016}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--green);text-underline-offset:4px}a:focus-visible{outline:3px solid #bf6d28;outline-offset:5px}main{max-width:1120px;margin:auto;padding:64px 28px 80px}.eyebrow,.refs,figcaption,h3,.tag{font-size:12px;letter-spacing:.08em;text-transform:uppercase}.eyebrow{color:var(--green);font-weight:700}main h1{font:500 clamp(36px,5vw,64px)/1.08 Georgia,serif;letter-spacing:-.04em;margin:24px 0}main h2{font:500 clamp(25px,3vw,35px)/1.2 Georgia,serif;letter-spacing:-.025em;margin:12px 0}main h3{font-weight:700;margin:0 0 8px;color:var(--muted)}main p{margin:0 0 14px}.meta{color:var(--muted);font-size:14px}.stats{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:30px 0}.stats>div{padding:20px 16px;border-right:1px solid var(--line)}.stats>div:last-child{border:0}.stats strong{display:block;font:500 32px/1.2 Georgia,serif}.stats span{font-size:13px;color:var(--muted)}.legend{display:flex;flex-wrap:wrap;gap:20px;font-size:12px;color:var(--muted);margin:20px 0}.key{display:inline-block;width:16px;height:11px;border:1px solid var(--ink);margin-right:6px;vertical-align:middle}.key.seam{border-style:dashed}.key.deep{background:#172e2b}.key.leak{border-color:#b45309}.note{border-left:3px solid var(--green);padding:16px 20px;background:#edf1e9;font-size:14px}.nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0 40px}.nav a{padding:8px 12px;border:1px solid var(--line);border-radius:4px;text-decoration:none;font-size:13px}.candidate{background:#fffefb;border:1px solid var(--line);border-radius:10px;margin:34px 0;padding:32px;scroll-margin-top:20px}.card-heading{display:grid;grid-template-columns:60px 1fr;gap:16px}.id{font:500 27px/1.4 Georgia,serif;color:#77857a}.badges{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.badge{font-size:12px;padding:3px 9px;border-radius:3px;font-weight:650}.strong{background:#e0efdf;color:#235332}.explore{background:#fff0d9;color:#795016}.speculative{background:#e9edf0;color:#485760}.tag,.refs{color:var(--muted)}.refs{margin:10px 0 0}.diagrams{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}.diagrams figure{margin:0;background:#f7f8f4;border:1px solid #e2e6df;padding:18px;border-radius:6px;min-width:0}.diagrams figure:nth-child(2){background:#f0f5ed}figcaption{color:var(--muted);font-weight:650;margin-bottom:18px}.diagram-stack{min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center}.block{background:#fffefb;border:1px solid #bdc8be;border-radius:4px;min-height:42px;padding:10px 13px;text-align:center;font-size:13px;max-width:300px;width:100%;overflow-wrap:anywhere}.block.deep{background:#172e2b;color:#fff;border:3px solid #172e2b;padding:30px 13px}.arrow{flex-shrink:0;color:#7c897e}.mermaid{min-height:320px;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;font:12px/1.5 monospace;overflow-wrap:anywhere}.mermaid svg{max-width:100%!important;height:auto!important;max-height:350px}.card-copy{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card-copy p,.analysis p,.test,.caveat{font-size:14px}.analysis{padding-top:10px;border-top:1px solid var(--line)}.wins{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:16px 0}.wins li{font-size:12px;background:#edf2e9;padding:5px 9px;border-radius:3px}.test{margin:16px 0}.caveat{padding:12px 15px;border-left:2px solid #ac762b;background:#faf4e9}.files{border-top:1px solid var(--line);padding-top:16px;margin-top:20px}.files ul{padding:0;list-style:none;margin:0}.files li{font:11px/1.9 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.recommendation{background:#172e2b;color:#fff;padding:32px;border-radius:8px;margin-top:40px}.recommendation a{color:#c7e4c4}.recommendation h2{margin-top:0}.footer{margin-top:28px;color:var(--muted);font-size:12px}body .muted{color:var(--muted)}
@media(max-width:700px){main{padding:30px 16px}.candidate{padding:20px 16px}.diagrams,.card-copy{grid-template-columns:1fr}.card-heading{grid-template-columns:40px 1fr;gap:10px}.stats>div{padding:14px 8px}.stats strong{font-size:26px}.legend{gap:12px}.diagram-stack,.mermaid{min-height:260px}.recommendation{padding:24px}.files li{font-size:10px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{body{background:white}main{max-width:none;padding:0}.candidate{break-inside:avoid}.nav{display:none}.recommendation{background:white;color:var(--ink);border:1px solid var(--line)}.recommendation a{color:var(--green)}}
'''


def main():
    cards='\n'.join(card(c) for c in CANDIDATES)
    html=f'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkAdventure · arquitetura e travamento com oito pessoas</title>
<script src="https://cdn.tailwindcss.com"></script>
<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';mermaid.initialize({{startOnLoad:true,theme:'neutral',securityLevel:'strict',flowchart:{{htmlLabels:false}},themeVariables:{{fontFamily:'system-ui',fontSize:'13px'}}}});</script>
<style>{CSS}</style></head><body><main>
<header><div class="eyebrow">WorkAdventure / revisão de arquitetura / 12.11.2026</div><h1>Oito pessoas.<br>Onde o trabalho se acumula.</h1><p class="meta">Referência ddbe245a8 · análise estática + teste funcional de cache com dois clientes</p>
<div class="stats"><div><strong>22</strong><span>hipóteses registradas</span></div><div><strong>5</strong><span>candidatos arquiteturais</span></div><div><strong>0</strong><span>causas confirmadas do incidente</span></div></div>
<div class="legend"><span><i class="key"></i>module</span><span><i class="key deep"></i>module deep</span><span><i class="key seam"></i>seam = ponto de variação</span><span><i class="key leak"></i>conhecimento cruzado</span></div>
<p class="note">Relatório de investigação. Os diagramas propõem ownership, sem definir novas interfaces. Todos os candidatos merecem avaliação; otimizações dependem de evidência. Não representa inventário exaustivo do monorepo.</p>
<nav class="nav" aria-label="Navegação do relatório"><a href="#A02">A02 · proximidade</a><a href="#A01">A01 · bolhas</a><a href="#A04">A04 · entrega</a><a href="#A05">A05 · timeline</a><a href="#A03">A03 · diagnóstico</a></nav></header>
<section aria-label="Candidatos arquiteturais">{cards}</section>
<section class="recommendation" id="top-recommendation"><h2>Primeira exploração: A02</h2><p>O ciclo de vida da proximidade distribui regras de cancelamento e ordenação entre vários modules; testes existentes permitem aprofundar ownership preservando comportamento.</p><p><a href="#A02">Explorar a sessão de proximidade</a></p><p>Primeira medição: P0. Se o perfil apontar bolhas, A01 passa à frente na otimização. A03 começa com ferramentas existentes.</p></section>
<footer class="footer"><p><a href="README.md">Registro completo H01–H22</a> · <a href="architecture.md">Evidências e deletion tests</a> · <a href="investigation-plan.md">Protocolo e critérios de encerramento</a></p><p>GLOSSARY.md e docs/adr não localizados na descoberta delimitada. Nenhum conflito com ADR identificado. As duas bibliotecas visuais usam CDN; texto, CSS e diagramas manuais permanecem no arquivo. Nenhuma dependência foi adicionada ao produto.</p></footer>
</main></body></html>'''
    permanent=REPORT_DIR/'architecture-review.html'
    permanent.write_text(html)
    temporary=Path(os.environ.get('TMPDIR') or '/tmp')/('architecture-review-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.html')
    temporary.write_text(html.replace('<head>','<head><base href="'+REPORT_DIR.as_uri()+'/">',1))
    Path('.audit/eight-user-report-path.txt').write_text(str(temporary)+'\n')
    print(permanent)
    print(temporary)


if __name__ == '__main__':
    main()
