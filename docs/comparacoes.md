# Comparações

Contrato formal do motor de Comparações (Etapa 5) e da interface que o apresenta (Etapa 6). A interface só mostra o que este motor calcula.

## O que é comparado

Uma comparação confronta duas **populações** de registros, A e B, pela **identidade** de cada registro: o valor de uma coluna identificadora escolhida em cada lado. A unidade da reconciliação é a **identidade distinta**, nunca a linha.

Cada lado é uma de duas coisas:

| Tipo | População | Como é calculada |
|---|---|---|
| `population` | Linhas de uma tabela, numa versão, com um período e um recorte opcionais | Vira uma receita (filtros e ligações gerados como em Perguntas, mais uma agregação pela chave) e roda no mesmo `Pipeline` |
| `run` | Linhas da tabela de partida que chegaram a algum resultado de uma execução rastreada já existente | Lida da linhagem gravada dessa execução; nada é recalculado |

```json
{
  "a": { "kind": "population", "dataset_id": "…", "version_id": "… ou null (a mais recente)", "key": "id",
         "period": null, "dimension": null, "label": "cadastro" },
  "b": { "kind": "run", "run_id": "…", "key": "beneficiario_id", "label": "atendidos" },
  "rules": [],
  "fields": [{ "a": "cozinha_id", "b": "cozinha_id" }],
  "equivalence": { "a": { "dataset_id": "…", "key": "id" }, "b": { "dataset_id": "…", "key": "beneficiario_id" } }
}
```

- `period` segue a pergunta estruturada (data ou vigência; na vigência, a leitura é obrigatória).
- `dimension` segue a pergunta estruturada e exige um valor: um lado é uma população, não um agrupamento.
- A chave é sempre uma coluna da tabela de partida do lado.

## Equivalência dos campos

A reconciliação compara texto com texto. Ela não sabe se as duas colunas identificam a mesma coisa: `beneficiarios.id` e `cozinhas.municipio` produzem uma conta correta e sem sentido. Por isso, cada comparação diz de onde vem a equivalência entre as duas colunas identificadoras (`equivalence` na prévia e na execução rastreada):

| Estado | Quando | Precisa de confirmação |
|---|---|---|
| `same_field` | Os dois lados usam a mesma coluna da mesma tabela (versões, períodos ou recortes de uma tabela). A equivalência vem da própria definição. | Não |
| `map_declared` | No Mapa, a pessoa declarou que as colunas da relação entre exatamente essas duas colunas identificam a mesma entidade (`relationships.identity_declared_at`, "Mesma entidade?" no painel da relação). Vale para todas as comparações desse par, até ser retirada. Não vale para uma relação rejeitada. | Já confirmada, no Mapa |
| `declared` | A pessoa declarou, nesta comparação, que as duas colunas identificam a mesma entidade. | Já confirmada |
| `unconfirmed` | Nenhum dos casos acima. Uma relação apenas sugerida, rejeitada ou em revisão é mostrada como evidência, mas não basta. Uma relação confirmada também não basta, mesmo N:1 com destino único: confirmar autoriza usar a relação para ligar tabelas, não declara que as colunas identificam a mesma entidade. | Sim |
| `relation` | Só em execuções antigas, gravadas antes da declaração de identidade no Mapa: a relação confirmada N:1 bastava. A interface mostra o estado gravado como "relação confirmada no Mapa". | — |

- Nomes de colunas, tipos, valores parecidos ou uma relação entre as tabelas (e não entre essas duas colunas) nunca dispensam a confirmação.
- A declaração vai na definição: `"equivalence": {"a": {"dataset_id": "…", "key": "id"}, "b": {"dataset_id": "…", "key": "municipio"}}`. Ela só vale para as colunas que nomeia; se uma delas mudar, a declaração é ignorada (aviso `comparison.equivalence_stale`) e é preciso confirmar de novo.
- Sem equivalência, a prévia ainda calcula (não grava nada), mas devolve a pendência `comparison.equivalence_unconfirmed`. A interface não mostra o resultado antes da confirmação. A execução rastreada recusa a definição (`comparison.not_runnable`).
- Equivalência de identidade não é autorização de ligação: uma relação usável para ligar tabelas numa receita pode não bastar para comparar identidades, e vice-versa. O Trace separa cinco coisas: a relação existir (`status`), a multiplicidade (`policy`, unicidade do destino), a correspondência dos valores (cobertura, na evidência), a identidade (`identity_declared_at` ou a declaração da comparação) e a autorização de uso (`standing.usable` mais as pendências do compilador).
- Rejeitar uma relação retira a declaração de identidade. Reabrir ("Desfazer decisão") não a retira: ela tem o próprio botão "Retirar a declaração".
- Quando há relações nos dois sentidos entre as mesmas colunas, vale primeiro a que tem identidade declarada, depois a confirmada, depois a sugerida; o empate é resolvido pela mais antiga.
- A execução rastreada grava o estado e a frase da equivalência (`comparison_runs.equivalence`). Uma equivalência declarada fica registrada como declarada pela pessoa, não verificada pelo Trace. A declaração não muda a reconciliação nem as regras de igualdade.

## O que cada lado representa

Junto com a equivalência, o motor devolve uma leitura (`equivalence.reading`) que diz o que cada lado representa, só a partir de evidências estruturadas:

| Leitura | Quando | O que a interface diz |
|---|---|---|
| `registry_references` | A equivalência foi declarada (no Mapa ou na comparação) sobre um par que tem uma relação confirmada N:1 com destino único na versão comparada. `registry` indica o lado da chave referenciada (o cadastro); o outro lado reúne os identificadores referenciados. | Identificadores cadastrados × identificadores referenciados, com a seleção de cada lado. Uma identidade só no cadastro "não aparece como referência nesta seleção"; uma só nas referências é "referenciada sem correspondência no cadastro selecionado". Nenhuma das duas é tratada como inatividade ou erro. |
| `same_field` | Os dois lados usam a mesma coluna da mesma tabela. | Duas seleções da mesma tabela, pela mesma coluna; se a atribuição isola o critério ou a versão, a interface diz isso. |
| `unknown` | Qualquer outro caso, inclusive uma equivalência declarada sem relação confirmada. | Texto neutro sobre identidades, sem inventar o que cada lado é. |

- A leitura nunca vem de nomes de tabelas ou colunas. O nome da tabela só aparece como rótulo.
- A interface fala em identificadores e identidades distintas, nunca em pessoas, refeições ou entidades contadas por linha.
- A execução rastreada grava a leitura com a equivalência. Ao abrir uma execução antiga, a interface usa a leitura gravada, mesmo que o Mapa tenha mudado depois; execuções gravadas antes desta leitura aparecem com o texto neutro.
- Se a declaração de identidade usada por uma execução for retirada depois, a execução continua com a equivalência gravada e `changes.equivalence` diz que a declaração foi retirada.

## Igualdade

- Duas identidades são iguais quando o texto é **exatamente igual**. `0187` e `187` são diferentes; `Ana` e `ana` também.
- Valor vazio (sem valor no arquivo ou só espaços) não é identidade: a linha é contada como **linha sem identificador** do lado dela.
- Normalizações só valem quando aceitas explicitamente em `rules`:
  - `leading_zeros`: ignora zeros à esquerda (`0187` ≡ `187`; `000` ≡ `0`).
  - `case_and_spacing`: ignora maiúsculas, espaços nas pontas e espaços repetidos.
- Uma regra aceita só forma par quando o candidato é **único nos dois sentidos**. Os pares feitos pela regra ficam marcados como tal; o texto de cada lado é preservado.

## Classificação (exclusiva e em ordem)

Cada identidade distinta de A e de B recebe exatamente uma categoria:

1. **`shared`**: o mesmo texto aparece nos dois lados.
2. **`shared_by_rule`**: sem par exato, mas pareada por uma regra aceita (1 para 1).
3. **`only_a`** / **`only_b`**: sem par.

Uma identidade exclusiva recebe uma explicação, a primeira que os dados sustentarem:

1. **`excluded_in_other`**: o mesmo texto existe na tabela de origem do outro lado, mas todas as suas linhas saíram da seleção do outro lado. A explicação diz em que passo e por qual motivo (vindos da linhagem).
2. **`outside_other_period`**: a tabela deste lado tem vigência declarada, o outro lado tem um período, e nenhuma linha desta identidade estava vigente nesse período.
3. **`possible_match`**: existe um candidato único do outro lado por uma normalização **não aceita**. É hipótese e não conta como par.
4. **`ambiguous_match`**: a normalização encontra mais de um candidato entre as identidades sem par; nenhum par é feito.
5. **`variant_of_matched`**: por normalização, equivale a uma identidade do outro lado que já tem par exato (por exemplo, `187` quando `0187` existe nos dois lados). Não vira par, porque formaria um par 2 para 1.
6. **`absent`**: nenhum texto igual, nem candidato por normalização.

As explicações não mudam a conta: só dizem por que uma identidade está sem par.

## Reconciliação

Para cada lado: linhas selecionadas, linhas sem identificador, identidades distintas, identidades repetidas e linhas repetidas.

Identidades verificadas a cada cálculo. Se uma falhar, o motor recusa o resultado em vez de mostrá-lo.

| Nome | Identidade |
|---|---|
| distintos de A | `distintos_A = shared + shared_by_rule + only_a` |
| distintos de B | `distintos_B = shared + shared_by_rule + only_b` |
| linhas de A | `linhas_A = linhas_com_identificador_A + linhas_sem_identificador_A` |
| linhas com identificador de A | `linhas_com_identificador_A = distintos_A + linhas_repetidas_A` |
| (o mesmo para B) | |
| diferença líquida | `distintos_A − distintos_B = only_a − only_b` |

A **diferença líquida** (`distintos_A − distintos_B`) não é a quantidade de divergências. As identidades sem par são `only_a + only_b`; as de um lado compensam parte das do outro no total, mas são identidades diferentes.

## Campos comparados

Para cada identidade em comum (exata ou por regra) e cada par de campos em `fields`, o motor compara o **conjunto de valores** do campo nas linhas de cada lado:

- `same`: os conjuntos são iguais;
- `different`: não têm nenhum valor em comum;
- `partial`: têm valores em comum, mas não são iguais.

Comparar conjuntos dispensa escolher uma linha quando há repetições: nenhuma linha é pareada por posição.

## Versões de um arquivo

Dois lados `population` da mesma tabela, com versões diferentes e a mesma chave, comparam versões. `only_a` são as identidades que desapareceram, `only_b` as que surgiram, `shared` as preservadas. A mudança de ocorrências aparece em cada identidade (linhas em A e em B), e os campos em `fields` mostram mudanças de valor.

A correspondência é sempre pela chave. A posição da linha no arquivo nunca é usada. Sem uma chave, não há comparação individual.

## Atribuição

O motor compara as definições dos dois lados e diz o que muda entre elas:

| Diferença entre os lados | Atribuição |
|---|---|
| Nenhuma | `identical`: não deveria haver diferença |
| Só a versão | `versions`: toda diferença vem da mudança de dados |
| Só o período ou o recorte | `criteria`: toda diferença vem do critério |
| Só o caminho das relações | `relations` |
| Mais de uma das anteriores | `mixed`: não é possível isolar uma causa |
| Tabelas diferentes | `sources`: populações de origens diferentes; sem causa única |

A atribuição vem da comparação das definições, com todo o resto igual. Quando várias coisas mudam ao mesmo tempo, o motor não decompõe a causa e diz isso.

## Problemas e ressalvas

- **Impedem a comparação:** lado sem tabela, versão inexistente, chave ausente, execução que não terminou com sucesso, definição inválida, relação pendente que muda o cálculo, vigência não declarada.
- **Só exigem ressalva:** identidades repetidas, linhas sem identificador, tipos diferentes nas chaves, candidatos por normalização não aceita, linhas copiadas por ligação com ids repetidos no destino.

## Prévia e execução rastreada

- **Prévia** (`POST comparisons/preview`): calcula os dois lados em memória (ou lê a linhagem de lados `run`), classifica e reconcilia. Não grava nada. Devolve o resumo, as pendências, até 10 amostras de cada categoria (`samples`) e até 10 de cada explicação de cada lado (`explained_samples`).
- **Execução rastreada** (`POST comparisons/trace`):
  - grava a comparação e uma execução de comparação;
  - cria uma execução do motor para cada lado `population` (com versões fixadas no pedido);
  - grava cada identidade classificada.
  - A investigação é paginada: identidades por categoria, linhas de origem de cada identidade em cada lado, linhas sem identificador.
- Com os mesmos dados, versões e regras, as duas dão o mesmo resultado. Uma execução antiga continua apontando para as versões que usou.

## Endpoints

| Método | Caminho | Para quê |
|---|---|---|
| `POST` | `comparisons/preview` | Prévia: resumo, reconciliação, atribuição, pendências e amostras de cada categoria e de cada explicação |
| `POST` | `comparisons/trace` | Grava e executa a comparação (fila); exige a equivalência dos campos; devolve a execução de comparação |
| `GET` | `comparisons` | Comparações gravadas, com a última execução |
| `GET` | `comparison-runs` | Histórico: execuções de comparação gravadas, da mais recente para a mais antiga, com lados, versões, chaves, regras e números; filtro `comparison_id` |
| `GET` | `comparison-runs/{id}` | Execução de comparação: definição, versões de cada lado, equivalência registrada, resumo, atribuição e ressalvas |
| `GET` | `comparison-runs/{id}/identities` | Identidades paginadas; filtros `category`, `explanation`, `repeated=a\|b`, `changed=1`, `search` |
| `GET` | `comparison-runs/{id}/rows` | Linhas de origem de uma identidade num lado (`side`, `identity` ou `empty=1`, `state=selected\|excluded\|all`), com o motivo de saída quando a linha saiu |

Cada lado `population` de uma execução rastreada é uma execução do motor (`runs`). Por isso, a investigação existente (passos, exclusões, percurso de um registro) também vale para cada lado.

## Interface (Etapa 6)

A tela de Comparações segue quatro movimentos: escolher os conjuntos, ver a diferença, explorar as explicações e investigar os registros.

- **Escolher os conjuntos:** cada lado é uma tabela (com versão, período e recorte) ou uma execução rastreada. Ficam sempre visíveis a fonte, a tabela ou execução e a coluna identificadora; versão, período e recorte ficam em "Ajustar critérios", com um resumo sempre visível dos critérios ativos. A coluna identificadora é escolhida pela pessoa; a tela só sugere colunas a partir de uma relação do Mapa e diz qual.
- **Nomes dos lados:** cada lado tem um nome legível, sugerido a partir dos metadados (tabela, período, recorte, versão ou nome da execução) e editável. O nome aparece no título, na legenda, nas causas, na conta, na investigação e no histórico; tabela, coluna e versão continuam nos detalhes de origem. O nome fica gravado com a execução rastreada; renomear depois cria outra definição e não altera execuções antigas.
- **Confirmar a equivalência:** quando a equivalência está `unconfirmed`, a tela pede a confirmação antes de comparar, mostra as evidências disponíveis (relação do Mapa, se houver, e o perfil das duas colunas) e só libera "Comparar" depois dela. Um link antigo sem declaração abre a mesma confirmação antes do resultado.
- **Ver a diferença:** a resposta separa a diferença líquida (`distintos_A − distintos_B`) das identidades sem par (`only_a + only_b`), com uma frase curta que usa a leitura do que cada lado representa e o detalhe de linhas e identidades num bloco recolhido. A sobreposição desenha um quadrado por identidade (ou um bloco de tamanho fixo, com as contagens exatas nos textos, quando os conjuntos passam de 1.250 identidades), sempre nas proporções do resumo. O número de linhas da grade e a largura do desenho acompanham o tamanho dos conjuntos; quando nada está nos dois lados, uma linha tracejada marca o vazio.
- **Passos:** Fontes (linhas → identidades de cada lado), Alinhar (nos dois, só em A, só em B), Classificar (uma bandeja por explicação, com as hipóteses separadas das causas comprovadas) e Fechar a conta (`distintos_A − only_a + only_b = distintos_B`, com as verificações do motor). Categorias e painéis mostram quantidades sem sinal; só a conta de Fechar a conta usa − e +.
- **Hipóteses:** antes de aceitar uma regra, a tela pede uma segunda prévia com a regra e mostra quantos pares ela faz, a decomposição antes e depois, exemplos e o que continua sem par (ambíguas e variantes). Aceitar muda só as `rules` da definição; o motor recalcula. A diferença líquida não muda.
- **Investigar:** identidades paginadas por categoria e explicação, com busca; para cada identidade, as linhas de origem de cada lado (versão, linha do arquivo, valores completos, situação e motivo de saída). Para uma identidade possível, ambígua ou parecida com uma já pareada, o outro lado mostra as linhas de cada candidato. Na prévia, a tela mostra as amostras e pede para rastrear antes de abrir as linhas.
- **Prévia e execução rastreada:** a tela diz qual das duas está aberta. Uma prévia não substitui uma execução rastreada: quando as versões ou os números diferem, a tela avisa e mantém a execução como foi gravada.
- **Histórico:** as execuções gravadas abrem como foram feitas, sem recalcular, com a equivalência registrada.

## Serviços

- `ComparisonPlanner`: valida o contrato e converte cada lado em receita (usa `QuestionTranslator` e `RecipeCompiler`, com versão fixada).
- `SideCollector`: monta as identidades de um lado a partir da execução em memória (prévia) ou da linhagem gravada (execução rastreada), com a mesma regra.
- `Reconciler`: classificação, explicações, campos comparados e verificação das identidades. Não acessa o banco.
- `Attribution`: compara as definições dos dois lados.
- `ComparisonPreview`, `ComparisonLauncher`, `ComparisonExecutor` e o job `ExecuteComparison`: prévia, gravação e execução.
- `ComparisonInvestigation`: consultas paginadas no PostgreSQL. A resposta principal nunca traz todas as linhas.

## Escala

O limite de importação continua sendo de 50 mil linhas por arquivo. O caso maior do protótipo (24.000 e 21.780 identidades distintas) é testado com conjuntos gerados dentro desse limite. Cada lado carrega só o identificador (e os campos pedidos) das linhas da versão, e as identidades ficam gravadas uma por linha, com paginação.

## Fora desta etapa

- Comparar valores agregados de duas execuções (por exemplo, a soma por cozinha antes e depois) sem descer às identidades.
- A explicação `outside_other_period` só vale quando o outro lado é uma `population` com período. A execução rastreada guarda a declaração de vigência do momento do pedido; a prévia usa a declaração atual.
- Chaves compostas, por mais de uma coluna.
- Chaves de uma tabela ligada, em vez da tabela de partida.
