# Motor de perguntas

Definições formais da Etapa 3. Elas valem para a prévia e para a execução rastreável, que usam o mesmo compilador e o mesmo `Pipeline`.

## Contagem de valores distintos

Medida `count_distinct`, com uma coluna de identidade (`alias.coluna`).

- **Identidade:** o valor da coluna, comparado como texto exato. `187` e `0187` são identidades diferentes, assim como `Ana` e `ana`. Nada é normalizado.
- **Vazios:** linhas com a identidade vazia não contam. Ficam registradas como ignoradas.
- **Repetições:** dentro de um grupo, cada identidade conta uma vez, não importa quantas linhas tenha.
- **Contribuintes:** todas as linhas do grupo com identidade preenchida. A primeira linha de cada identidade (a de menor número de ordem na execução) é a **contada**; as outras são **repetidas** e contribuem com zero.
- **Linhagem:** para cada resultado, o Trace mostra os distintos, as linhas, as repetidas e as vazias; o status de cada linha de origem (contada, repetida ou vazia); e a lista de identidades com quantas linhas cada uma tem. Assim, 150 linhas que representam 120 pessoas nunca aparecem como 150 pessoas.

## Total ao agrupar

O total de uma agregação é calculado sobre todas as linhas que chegaram a ela, e não somando os grupos.

- Soma e contagem de linhas: o total é igual à soma dos grupos.
- Contagem de distintos: uma identidade presente em dois grupos conta uma vez no total. Por isso o total pode ser menor que a soma dos grupos, e o Trace mostra os dois números.

## Vigência

### Declaração

A vigência é declarada explicitamente para uma tabela. O Trace não a infere sozinho.

- **Coluna de início:** obrigatória, do tipo data.
- **Coluna de fim:** opcional, do tipo data. Fim vazio significa vigência em aberto.
- **O dia do fim conta como vigente?** Escolha obrigatória. Se sim, quem tem fim em 31/12 estava vigente em 31/12; se não, deixou de estar nesse dia.

### Intervalo de cada linha

De início até fim (incluído ou não, conforme a declaração), ou em aberto quando o fim está vazio.

### Leituras de um período `de`–`até` (datas incluídas)

| Leitura | Regra |
|---|---|
| Começou no período | `de ≤ início ≤ até` |
| Ativo em algum momento do período | `início ≤ até` e (fim vazio ou fim ≥ `de`, se o dia do fim conta; fim > `de`, se não conta) |
| Ativo no último dia do período | `início ≤ até` e (fim vazio ou fim ≥ `até`, se o dia do fim conta; fim > `até`, se não conta) |

### Linhas que não podem ser classificadas

Não entram no resultado e aparecem como indeterminadas, com o motivo: início vazio, início ou fim que não é uma data, ou fim antes do início.

### Motivos de saída

Começou antes do período, começou depois, terminou antes ou terminou durante o período.

## Prévia e execução rastreável

- **Prévia:** compila a receita (salva ou rascunho), executa o mesmo `Pipeline` em memória e devolve resultados, totais e contagens por passo. Não grava execução nem linhagem, e se identifica como prévia.
- **Decisões pendentes:**
  - A prévia calcula quando a pendência não muda o cálculo: uma relação sugerida com destino único.
  - Ela se recusa a calcular, e diz qual decisão falta, quando a pendência muda o resultado: relação rejeitada, relação para reavaliar, destino com ids repetidos sem política ou vigência não declarada.
- **Execução rastreável:** grava versões, regras, decisões, resultados, totais e linhagem.
- **Equivalência:** com as mesmas versões, regras e decisões, prévia e execução produzem os mesmos resultados e totais. Versões diferentes podem produzir resultados diferentes; uma execução antiga continua apontando para as versões que usou.
