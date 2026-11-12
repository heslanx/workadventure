VERDICT: PASS

| id | severity (blocker/major/minor/nit) | file:line | finding | evidence |
|---|---|---|---|---|

Não pude verificar a execução de testes nem avaliar mutantes concretos: este patch só remove declarações e imports, e a solicitação limita a revisão à leitura. As buscas no código não encontraram outros consumidores dos símbolos removidos; as referências remanescentes a `UpgradeFailedData` usam o tipo diretamente e não dependem de `SocketUpgradeFailed`.
