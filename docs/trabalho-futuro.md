# Trabalho futuro

Melhorias identificadas durante a validação do motor (etapa 4) e deixadas para depois, para preservar o que já foi validado.

## Armazenamento da linhagem

- **Compactar o detalhe das exclusões.** Em uma execução com 50 mil registros, o detalhe JSON das exclusões ocupa cerca de 7,7 MB dos 14 MB da tabela `run_tuples` (média de 219 bytes por exclusão). A maior parte repete a condição (alias, coluna, operador, valor esperado), que já está no snapshot da execução. Guardar apenas o índice da condição e o valor encontrado reduziria esse espaço em cerca de 70%. Requer ajustar o `Explainer` para reconstruir o texto a partir do snapshot.
- **Identificador curto para execuções nas tabelas de linhagem.** `run_id` é um ULID de 26 caracteres repetido em cada linha e em cada índice de `run_tuples`, `run_tuple_sources` e `run_diagnostics`. Uma chave inteira interna reduziria tabelas e índices.
- **Retenção de execuções.** Hoje apenas workspaces inativos expiram (`trace:prune-workspaces`). Execuções antigas de um workspace ativo permanecem; cada execução no limite de linhas ocupa cerca de 35 MB.

## Consultas

- **Paginação por cursor.** As listas de investigação usam `OFFSET`, cujo custo cresce com a profundidade da página. No limite atual a página 1000 das exclusões responde em ~20 ms, mas paginação por cursor (`tuple_no`) evitaria a degradação em volumes maiores.

## Dados

- **Separador decimal configurável.** Números são aceitos apenas com ponto (`12.5`). Valores como `12,5` ou `1.234,56` deixam a coluna como texto, e o perfil da coluna diz o motivo. Uma coluna em que todo ponto tem três casas depois (`1.234`, `12.000`) é ambígua: o Trace não escolhe entre milhar e decimal, deixa a coluna como texto (`decimal_ambiguous`) e recusa somá-la. Declarar o formato na importação resolveria os dois casos.
- **Apagar uma versão ou uma execução isolada.** Hoje a exclusão é por conjunto inteiro, levando o histórico que depende dele (ver `docs/rastreabilidade.md`).
- **Importação em segundo plano.** Arquivos perto do limite são lidos inteiros na memória, dentro da requisição. Ler em fluxo e importar pela fila evitaria o limite de memória e de tempo.
- **Atribuição de exclusões anteriores ao agrupamento.** Registros excluídos antes de as colunas de agrupamento estarem disponíveis aparecem como "não atribuíveis". Atribuí-los exigiria uma junção hipotética, que o motor não faz por decisão de projeto.
