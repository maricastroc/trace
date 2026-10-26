# Rastreabilidade na Sobreposição

Contrato inicial para a nova interface. A interface Rio foi removida; o motor, a linhagem e os endpoints de investigação permanecem e passam a alimentar as camadas **Entender → Explorar → Auditar** dentro de Perguntas e, depois, de Comparações.

## Dois modos de resposta

| | Prévia | Execução rastreável |
|---|---|---|
| Como é calculada | `Pipeline::execute($snapshot)` sem `LineageWriter` | `RunExecutor`: `Pipeline::execute` seguido de `LineageWriter::write` (fila `ExecuteRun`) |
| Grava linhagem | Não | Sim (`run_tuples`, `run_tuple_sources`, `run_diagnostics`) |
| Pode ser auditada | Não. A interface identifica como prévia e não oferece Explorar nem Auditar | Sim, quando o status é `succeeded` |
| Endpoint | `POST recipes/preview` (rascunho), `POST recipes/{recipe}/preview`, `POST questions/preview` e `POST questions/readings` | `POST recipes/{recipe}/runs`, `POST questions/trace`, `GET runs/{run}` |

As duas usam o mesmo `Pipeline`. A prévia nunca tem regras próprias: ela é a mesma execução, apenas sem gravar a linhagem. As definições formais de contagem de distintos, totais e vigência estão em `docs/motor-de-perguntas.md`.

## Base de uma resposta

Toda resposta carrega a base que a produziu. No frontend ela é o tipo `Basis` em `frontend/src/lib/provenance.ts`:

- receita e revisão (as regras);
- para cada entrada: posição, alias, dataset e **versão** usada, com o total de linhas;
- decisões de junção: passo, relação usada e tipo (`inner` ou `left`);
- decisões registradas (`decisions`): para cada junção, o estado e a política da relação naquele momento (`status`, `policy`, `direction`); para cada vigência, as colunas de início e fim e se o dia do fim conta (`end_inclusive`). `decisions_key` resume essa lista; a prévia devolve a mesma chave em `basis.decisions_key`.

Duas respostas com a mesma base devem ter o mesmo resultado. Os testes de backend comparam prévia e execução sobre os mesmos dados, versões e regras. Em Perguntas, uma execução só é mostrada como a resposta rastreada quando usa as mesmas versões, as mesmas decisões e tem os mesmos totais da prévia atual. Caso contrário, a tela mostra a prévia e um aviso: a execução continua gravada como estava, e o aviso lista o que mudou. O frontend apenas compara identificadores, chaves e totais devolvidos pelo backend; ele não recalcula nada.

Sinais de defasagem no backend:
- `newer_version_available` por entrada;
- `recipe_changed_since` (também verdadeiro quando a receita foi apagada, com `recipe_deleted`);
- `decision_changes`: frases que comparam cada decisão gravada com o estado atual do Mapa (relação reaberta, rejeitada, apagada; vigência alterada ou retirada). Os números da execução nunca mudam por causa delas.

A execução grava também a pergunta que a produziu (`recipe.question` no snapshot), para não depender da receita, que pode ser editada ou apagada.

### Interpretação histórica

Uma execução é um registro histórico: ao reabri-la, o Trace mostra a interpretação gravada, não uma releitura com as regras de hoje.

- O texto em linguagem simples de cada passo (`steps[].plain`), o título e o resumo vêm do snapshot gravado.
- O snapshot guarda `interpretation` (versão 1): os critérios exatos de cada vigência usada (`enters`, `leaves`, `rule`, `undetermined`, colunas e se o dia do fim conta). `GET runs/{run}` devolve `interpretation.recorded = true`.
- Execuções gravadas antes disso devolvem `interpretation.recorded = false`, com os critérios recalculados a partir das regras gravadas; a interface pode avisar que o texto foi gerado depois.
- As explicações de cada linha (por que saiu, por que foi multiplicada) são guardadas como fatos estruturados: código, valores e parâmetros. O texto delas é composto na leitura a partir desses fatos; os fatos não mudam.
- Em Perguntas, quando a última execução não corresponde mais ao estado atual, o aviso permite "Abrir a execução gravada": a resposta passa a mostrar o número, os critérios e as relações daquele momento, com o aviso do que mudou separado, e "Voltar ao cálculo atual" retorna à prévia. Nada é recalculado nem alterado no registro.
- Em Comparações, a execução aberta usa só o que foi gravado (definição, versões, equivalência e leitura, atribuição, resumo e identidades); as decisões que mudaram depois aparecem num aviso separado, e "Comparar com os dados atuais" abre a comparação atual sem tocar no registro.

Ao julgar uma relação, o compilador usa as versões efetivamente ligadas: uma multiplicidade aceita só vale para as versões em que foi aceita, mesmo quando uma comparação fixa uma versão anterior; uma relação N:1 é bloqueada se o destino tiver valores repetidos na versão ligada. Uma ligação no sentido inverso (de um cadastro para as referências) é avisada (`join.reverse_multiplies`), porque multiplica linhas.

## Camadas da investigação e endpoints existentes

| Camada | Pergunta que responde | Endpoints |
|---|---|---|
| Entender | Qual é o resultado e como foi obtido? | `runs/{run}`, `runs/{run}/results`, `runs/{run}/flows` |
| Explorar | De onde vem este número? | `runs/{run}/flow?result=`, `runs/{run}/results/{n}`, `runs/{run}/results/{n}/breakdown` |
| Auditar | Quais linhas exatas entraram, saíram e por quê? | `runs/{run}/results/{n}/contributors`, `runs/{run}/results/{n}/identities`, `runs/{run}/exclusions`, `runs/{run}/diagnostics`, `runs/{run}/rows`, `runs/{run}/rows/{row}/journey`, `dataset-versions/{version}/rows` |

Os hooks correspondentes continuam em `frontend/src/lib/queries.ts`. A Rio não deixou nenhum componente visual: as telas novas consomem esses hooks diretamente.

## Onde a investigação vive na interface

- Não existe rota própria para a Rio. A investigação abre como camada da pergunta ou da comparação que a originou.
- Em Perguntas, a investigação tem três abas: passos e linhas (só depois de rastrear), critérios e relações, e a pergunta estruturada com a receita gerada.
- Se for necessário um endereço compartilhável para uma execução, ele usará a experiência nova (por exemplo, dentro de `/perguntas`), nunca a visualização antiga.

## Comparações

O motor de Comparações (`docs/comparacoes.md`) segue a mesma separação entre prévia e execução rastreada. Cada lado de uma comparação rastreada é uma execução do motor, com versões fixadas. As identidades classificadas ficam gravadas e são investigadas por `comparison-runs/{id}/identities` e `comparison-runs/{id}/rows`.

- Cada lado grava suas decisões (`sides.{a,b}.decisions` e `decisions_key`). A prévia só "confere" com a última execução quando versões, decisões, equivalência e números coincidem; senão, a tela diz por quê.
- `GET comparison-runs/{id}` devolve `changes`: as decisões de cada lado que mudaram depois, e se a declaração de identidade usada foi retirada.
- Um lado do tipo execução avisa (`comparison.run_decisions_changed`) quando a execução escolhida foi calculada com decisões que mudaram depois.
- Uma prévia que depende de relação ainda sugerida aparece como provisória e não pode ser rastreada até a decisão.

## Privacidade

- Buscas por valor (linhas de uma versão, identidades e linhas de uma comparação, linhas de uma execução) também aceitam `POST …/search` com o valor no corpo; a interface usa só essa forma, para que valores não fiquem em endereços nem em registros de acesso.
- Erros inesperados da API respondem com uma mensagem genérica (`server_error`), sem a mensagem interna. Mensagens de erro de banco são gravadas sem os valores (`mask_bindings_in_exception_messages`), e os rastros de pilha não guardam argumentos.
- Os testes não escrevem no registro de desenvolvimento (`LOG_CHANNEL=null`).

- Perguntas e Comparações guardam a definição aberta no armazenamento local do navegador; o endereço leva só uma chave curta (`?q=` e `?c=`), para que valores de recorte não fiquem no histórico nem nos registros de acesso. Endereços antigos com a definição inteira continuam abrindo.

## Ciclo de vida e exclusão de dados

Onde os dados de um conjunto ficam:

| Onde | O que guarda | Some quando |
|---|---|---|
| `storage/app/private/datasets/{id}/` | o CSV importado | o conjunto é apagado ou o espaço é limpo |
| `dataset_versions`, `dataset_columns` | versões; perfil das colunas com até 5 exemplos e mínimo/máximo | apagados com o conjunto |
| `source_rows` | todas as linhas | apagadas com o conjunto (bloqueado enquanto uma execução aponta para elas) |
| `relationships.evidence` | exemplos de valores | a relação some com o conjunto |
| `recipes` | a pergunta, que pode ter um valor de recorte | apagadas junto, quando partem do conjunto ou usam suas relações |
| `runs` e linhagem (`run_tuple_sources`, `run_diagnostics`, `run_result_rows`) | ligação às linhas de origem, valores em diagnósticos e resultados | apagadas junto, quando usaram o conjunto |
| `comparisons`, `comparison_runs`, `comparison_identities` | identificadores comparados | apagadas junto, quando usaram o conjunto |
| `storage/logs/laravel.log` | erros; desde a Etapa 7, sem valores de SQL | fora do alcance da exclusão |

Política:

- Um conjunto sem histórico é removido com o arquivo e a pasta.
- Um conjunto com histórico (execuções, perguntas ou comparações) só é apagado com confirmação explícita: a interface mostra o que será apagado e pede o nome da tabela digitado (`DELETE datasets/{id}` com `with_history` e `confirm`). `GET datasets/{id}/dependents` diz o que depende dele.
- Quando apagar os dados pessoais entra em conflito com preservar a execução, apagar vence: a execução é apagada inteira, nunca pela metade. Uma execução sem as linhas de origem deixaria de ser auditável e não seria mais o que diz ser.
- Fica um registro de auditoria sem dados das linhas (`dataset_erasures`, `GET dataset-erasures`): nome da tabela, versões, quantidade de linhas, tamanho, impressão digital (SHA-256) do arquivo, o que foi apagado e quando.
- A exclusão não alcança cópias feitas fora do Trace (backups do banco, arquivos baixados, registros antigos do servidor), e a interface diz isso.
- Espaços sem uso por 30 dias continuam sendo limpos por inteiro (`WorkspacePruner`), agora removendo também as pastas vazias.

## Limites de processamento

Prévias e buscas rodam dentro da requisição, com limites que falham de forma explicada:

| Limite | Valor padrão | Ao estourar |
|---|---|---|
| Tempo de uma prévia (`TRACE_PREVIEW_SECONDS`) | 20 s, somado entre as três leituras de vigência | `limit.preview_time`, sem número parcial |
| Linhas intermediárias da prévia (`TRACE_MAX_PREVIEW_TUPLES`) | 200.000 (o rastreio na fila aceita 500.000) | `limit.preview_tuples`, sugerindo rastrear ou reduzir o recorte |
| Resultados devolvidos pela prévia (`TRACE_PREVIEW_RESULTS`) | 1.000 linhas; `results_total` e `results_truncated` dizem o resto | a tela avisa que mostra parte dos grupos; o total considera todos |
| Tempo de cada consulta ao banco nas requisições (`TRACE_STATEMENT_SECONDS`) | 30 s; a fila não tem esse limite | 503 `request.timeout` com mensagem em português |
| Busca de relações (`TRACE_DISCOVERY_SECONDS`) | 20 s; depois de importar, só os pares com a tabela nova | `meta.complete = false`, com quantos pares foram avaliados |
| Memória das prévias e da importação | pelo menos 512 MB durante a operação | — |

Medido numa máquina de desenvolvimento (Apple Silicon, PostgreSQL em Docker), com dados gerados:

- importação de 50.000 linhas × 8 colunas: 1,8 s;
- prévia de pergunta agrupada (50.000 linhas, 2.000 grupos): 0,3 s, 238 KB de resposta;
- prévia de comparação 2.000 × 50.000: 0,3 s;
- junção que gera 200.000 linhas intermediárias: 0,4 s e cerca de 280 MB de memória;
- busca de relações com 2 tabelas: 0,3 s; com 10 tabelas de 5.000 linhas × 12 colunas: 4,9 s, crescendo com o quadrado do número de tabelas.

Não foram medidos: servidores de produção, vários usuários ao mesmo tempo, arquivos acima de 50.000 linhas.

## Lacunas conhecidas

- O texto das explicações de cada linha é composto na leitura a partir dos fatos gravados; uma mudança de redação no código muda o texto, nunca os fatos nem os números.
- Perguntas reabre a última execução de cada pergunta; execuções anteriores da mesma pergunta continuam gravadas, mas não aparecem na lista.
