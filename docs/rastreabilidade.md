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
- Em Perguntas, a investigação tem três abas: passos e registros (só depois de rastrear), critérios e relações, e a pergunta estruturada com a receita gerada.
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

## Lacunas conhecidas

- Perguntas não reabre uma execução antiga como foi gravada: quando ela não corresponde mais ao estado atual, a tela mostra o aviso com o que mudou, mas o número exibido é a prévia atual.
- O texto em linguagem simples dos passos é gerado de novo a cada leitura; uma mudança de redação no código muda o texto de execuções antigas, nunca os números.
- Prévias e descoberta de relações rodam dentro da requisição, sem limite de tempo próprio.
