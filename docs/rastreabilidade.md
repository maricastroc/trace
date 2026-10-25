# Rastreabilidade na Sobreposição

Contrato inicial para a nova interface. A interface Rio foi removida; o motor, a linhagem e os endpoints de investigação permanecem e passam a alimentar as camadas **Entender → Explorar → Auditar** dentro de Perguntas e, depois, de Comparações.

## Dois modos de resposta

| | Prévia | Execução rastreável |
|---|---|---|
| Como é calculada | `Pipeline::execute($snapshot)` sem `LineageWriter` | `RunExecutor`: `Pipeline::execute` seguido de `LineageWriter::write` (fila `ExecuteRun`) |
| Grava linhagem | Não | Sim (`run_tuples`, `run_tuple_sources`, `run_diagnostics`) |
| Pode ser auditada | Não. A interface identifica como prévia e não oferece Explorar nem Auditar | Sim, quando o status é `succeeded` |
| Endpoint | A criar na Etapa 3 | `POST recipes/{recipe}/runs`, `GET runs/{run}` |

As duas usam o mesmo `Pipeline`. A prévia nunca tem regras próprias: ela é a mesma execução, apenas sem gravar a linhagem.

## Base de uma resposta

Toda resposta carrega a base que a produziu. No frontend ela é o tipo `Basis` em `frontend/src/lib/provenance.ts`:

- receita e revisão (as regras);
- para cada entrada: posição, alias, dataset e **versão** usada, com o total de linhas;
- decisões de junção: passo, relação usada e tipo (`inner` ou `left`).

Duas respostas com a mesma base devem ter o mesmo resultado. Na Etapa 3, um teste de backend vai provar isso comparando prévia e execução sobre os mesmos dados, versões e regras. O frontend apenas compara identificadores (`sameBasis`); ele não recalcula nada.

Sinais de defasagem já existentes no backend: `newer_version_available` por entrada e `recipe_changed_since` na execução.

## Camadas da investigação e endpoints existentes

| Camada | Pergunta que responde | Endpoints |
|---|---|---|
| Entender | Qual é o resultado e como foi obtido? | `runs/{run}`, `runs/{run}/results`, `runs/{run}/flows` |
| Explorar | De onde vem este número? | `runs/{run}/flow?result=`, `runs/{run}/results/{n}`, `runs/{run}/results/{n}/breakdown` |
| Auditar | Quais linhas exatas entraram, saíram e por quê? | `runs/{run}/results/{n}/contributors`, `runs/{run}/exclusions`, `runs/{run}/diagnostics`, `runs/{run}/rows`, `runs/{run}/rows/{row}/journey`, `dataset-versions/{version}/rows` |

Os hooks correspondentes continuam em `frontend/src/lib/queries.ts`. A Rio não deixou nenhum componente visual: as telas novas consomem esses hooks diretamente.

## Onde a investigação vive na interface

- Não existe rota própria para a Rio. A investigação abre como camada da pergunta ou da comparação que a originou.
- Se for necessário um endereço compartilhável para uma execução, ele usará a experiência nova (por exemplo, dentro de `/perguntas`), nunca a visualização antiga.

## Lacunas conhecidas

- Não há endpoint de prévia (Etapa 3).
- O agregado não tem `count distinct`. A definição formal, incluindo quais linhas contam como contribuintes, será escrita antes da implementação (Etapa 3).
- Leituras de validade (por exemplo, cadastro ativo em uma data) exigem um tipo de condição próprio, com regra formal.
- Comparações ainda não existem no backend. Quando existirem, usarão a mesma noção de base.
