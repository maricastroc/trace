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

## Pergunta estruturada

A frase editável de Perguntas é só a forma de ler e editar uma pergunta estruturada. É ela que o backend valida (`QuestionTranslator`) e converte em receita. O frontend não calcula nada.

```json
{
  "base_dataset_id": "tabela cujas linhas são contadas",
  "measure": { "function": "count | count_distinct | sum", "column": "coluna da tabela, ou null para count" },
  "period": null
    | { "kind": "date", "column": "coluna de data da tabela", "from": "AAAA-MM-DD", "to": "AAAA-MM-DD" }
    | { "kind": "validity", "reading": "started | active_any | active_at_end | null", "from": "…", "to": "…" },
  "dimension": null
    | { "relationships": ["ids das relações, da tabela até o recorte"], "column": "coluna da última tabela", "label_column": "rótulo ou null", "value": "valor ou null" }
}
```

### Validação

- A medida usa uma coluna da própria tabela. A soma recusa colunas de data e aceita colunas com textos; valores que não são números ficam fora da soma, com diagnóstico.
- O período por data exige uma coluna do tipo data. O período por vigência usa a declaração da tabela e não aceita outra regra.
- O caminho até o recorte tem no máximo 3 relações. Cada relação sai da tabela alcançada pela anterior (sentido N:1) e não volta a uma tabela já visitada.
- O rótulo só é aceito quando a coluna do recorte não repete valores. Assim, agrupar pelo rótulo nunca divide um mesmo valor em dois grupos.

### Conversão em receita

1. Período por data: filtro `coluna entre de e até`. Período por vigência: filtro de vigência com a leitura escolhida.
2. Uma junção por relação do caminho. Para agrupar, a junção mantém quem não encontra par (`left`), que vira um grupo próprio e continua no total. Para um valor só, a junção exige o par (`inner`), e quem não encontra par sai com o motivo.
3. Recorte por um valor: filtro `coluna = valor`, comparado como texto exato.
4. Agregação final: medida `resposta`. Com agrupamento, agrupa pela coluna e pelo rótulo; sem agrupamento, calcula sobre todos os registros. Se a medida não é contagem de linhas, a agregação também conta as linhas (`registros`), para mostrar a diferença entre linhas e valores diferentes.

### Leitura pendente

Com o período por vigência e a leitura ainda vazia, a pergunta não é convertida. O endpoint `questions/readings` calcula uma prévia para cada leitura e devolve o critério exato de cada uma: quem entra, quem fica de fora, a regra sobre as colunas declaradas e o que é indeterminado. Sem declaração de vigência, nenhuma leitura é calculada.

### Rastrear

`questions/trace` compila a receita, recusa se houver decisões pendentes e grava a receita com a pergunta e uma chave (hash da pergunta normalizada). A mesma pergunta reaproveita a mesma receita e ganha uma nova execução; uma pergunta diferente ganha outra receita. Editar os passos de uma receita pela API de receitas desfaz o vínculo com a pergunta.
