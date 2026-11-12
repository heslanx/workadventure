# Escopo e método

Análise do checkout `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`, em 11/11/2026.

Investigação estática de código, manifestos, lockfiles, Dockerfiles, Compose, Helm e documentação oficial. Nenhum benchmark de aplicação, build de produção ou teste de capacidade foi executado. Não foram instaladas dependências nem iniciados servidores. O código do repositório permaneceu inalterado.

O inventário percorreu os caminhos retornados por `git ls-files -z`; leu `package.json`, `package-lock.json`, `yarn.lock` e metadados de tamanho dos arquivos. Não percorreu node_modules nem arquivos não rastreados. Há 4.694 entradas rastreadas; 4.693 foram contadas como arquivos, e `.claude/skills` é um link simbólico que não resolve para arquivo regular. Os tamanhos excluem `.git`, instalações de dependências e imagens de containers. São tamanhos em disco, não transferências HTTP comprimidas.

Todos os manifestos rastreados entraram no inventário, incluindo pacotes fora dos workspaces da raiz. Os 16 workspaces raiz não incluem todas as instalações independentes, como desktop, gerador de mensagens, mapas e cliente Room API. As 419 declarações incluem 231 dependencies, 187 devDependencies e 1 peerDependency. Existem 217 nomes distintos ao combinar esses escopos. Nomes internos `@workadventure/*` também são contados.

Lockfiles npm v2/v3 foram percorridos pelo campo packages, excluindo entradas de links/workspaces; o lockfile v1 de benchmark foi percorrido recursivamente pelo campo dependencies. As 2.901 entradas são posições de instalação em cinco lockfiles, não 2.901 bibliotecas diferentes. Os pares nome/versão são 1.919 e os nomes distintos são 1.467. O lockfile raiz contém 1.428 posições. Os dois lockfiles Yarn contêm 97 grupos de seletores com versões; há sobreposição com npm e não devem ser somados como dependências únicas.

Os CSV foram conferidos contra os totais JSON. Imagens de containers são inventariadas pelas declarações FROM/image; 44 declarações não significam 44 serviços simultâneos. Um CSV adicional registra as expressões image dos templates Helm, sem expandir subcharts. Dependências herdadas das imagens-base, pacotes de sistema transitivos e serviços remotos exigem SBOM por imagem/digest e configuração da implantação para inventário completo de produção.

Números de bitrates extraídos do código são orçamentos configurados. Números calculados para cenários são modelos ilustrativos, não tráfego medido. Requisitos oficiais são atribuídos à topologia correspondente; não se aplica o dimensionamento do painel comercial ao núcleo aberto sem ajustes.

A investigação foi dividida entre três agentes de leitura e uma síntese independente. Todos retornaram como concluídos e sem recursos externos mantidos. A API nativa oferece interrupção, mas não exclusão de sessões; os registros de sessões concluídas podem continuar visíveis no runtime.
