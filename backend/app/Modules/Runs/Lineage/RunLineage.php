<?php

namespace App\Modules\Runs\Lineage;

use App\Modules\Datasets\DatasetPresenter;
use App\Modules\Datasets\Import\ValueParser;
use App\Modules\Recipes\PlainLanguage;
use App\Modules\Recipes\StepDescriber;
use App\Modules\Runs\Run;
use App\Modules\Support\DomainError;
use App\Modules\Support\Pagination;
use Illuminate\Support\Facades\DB;

final class RunLineage
{
    public const NUMBER_PATTERN = '^[+-]?\d+(\.\d+)?$';

    public function steps(Run $run): array
    {
        $stored = collect(DB::select('SELECT * FROM run_steps WHERE run_id = ? ORDER BY position', [$run->id]))->keyBy('position');
        $plain = PlainLanguage::describe($run->steps(), $run->inputs());

        return array_map(function (array $step) use ($stored, $plain) {
            $row = $stored->get($step['position']);

            return [
                'position' => $step['position'],
                'id' => $step['id'],
                'type' => $step['type'],
                'title' => $step['title'],
                'summary' => $step['summary'],
                'input_count' => $row ? (int) $row->input_count : null,
                'output_count' => $row ? (int) $row->output_count : null,
                'excluded_count' => $row ? (int) $row->excluded_count : null,
                'duration_ms' => $row ? (int) $row->duration_ms : null,
                'stats' => $row ? json_decode($row->stats, true) : null,
                'join' => $step['type'] === 'join' ? [
                    'relationship_id' => $step['relationship_id'],
                    'relationship_status' => $step['relationship_status'] ?? null,
                    'relationship_policy' => $step['relationship_policy'] ?? null,
                    'direction' => $step['direction'] ?? null,
                    'join_type' => $step['join_type'],
                    'probe' => $step['probe'],
                    'lookup' => $step['lookup'],
                ] : null,
                'plain' => $plain[$step['position']],
            ];
        }, $run->steps());
    }

    public function inputs(Run $run): array
    {
        $versions = DB::table('dataset_versions')
            ->whereIn('id', array_column($run->inputs(), 'version_id'))
            ->pluck('row_count', 'id');

        return array_map(fn (array $input) => [
            'position' => $input['position'],
            'alias' => $input['alias'],
            'dataset_id' => $input['dataset_id'],
            'dataset_name' => $input['dataset_name'],
            'version_id' => $input['version_id'],
            'version_number' => $input['version_number'],
            'row_count' => (int) ($versions[$input['version_id']] ?? 0),
            'columns' => $input['columns'],
        ], $run->inputs());
    }

    public function result(Run $run, int $resultNo): array
    {
        $row = DB::selectOne('SELECT result_no, "values", contributor_count FROM run_result_rows WHERE run_id = ? AND result_no = ?', [$run->id, $resultNo]);

        if ($row === null) {
            throw new DomainError('result.not_found', 'Resultado não encontrado nesta execução.', 404);
        }

        return [
            'result_no' => (int) $row->result_no,
            'values' => json_decode($row->values, true),
            'contributor_count' => (int) $row->contributor_count,
        ];
    }

    public function results(Run $run, Pagination $page): array
    {
        $rows = DB::select(
            'SELECT result_no, "values", contributor_count FROM run_result_rows WHERE run_id = ? ORDER BY result_no LIMIT ? OFFSET ?',
            [$run->id, $page->perPage, $page->offset()],
        );

        return [
            'data' => array_map(fn (object $row) => [
                'result_no' => (int) $row->result_no,
                'values' => json_decode($row->values, true),
                'contributor_count' => (int) $row->contributor_count,
            ], $rows),
            'meta' => $page->meta((int) $run->result_count),
        ];
    }

    public function flow(Run $run, ?int $resultNo): array
    {
        $steps = $this->steps($run);
        $inputs = $this->inputs($run);

        if ($resultNo === null) {
            return ['inputs' => $inputs, 'steps' => $steps, 'result' => null];
        }

        $result = $this->result($run, $resultNo);
        $groups = DB::select(
            'WITH RECURSIVE anc AS (
                SELECT tuple_no, parent_no, born_step, end_step, fate FROM run_tuples WHERE run_id = ? AND result_no = ?
                UNION
                SELECT p.tuple_no, p.parent_no, p.born_step, p.end_step, p.fate FROM run_tuples p JOIN anc a ON p.tuple_no = a.parent_no WHERE p.run_id = ?
            )
            SELECT born_step, end_step, fate, count(*) AS n FROM anc GROUP BY born_step, end_step, fate',
            [$run->id, $resultNo, $run->id],
        );

        $count = function (callable $predicate) use ($groups): int {
            $total = 0;
            foreach ($groups as $group) {
                $born = (int) $group->born_step;
                $end = $group->end_step === null ? PHP_INT_MAX : (int) $group->end_step;
                if ($predicate($born, $end)) {
                    $total += (int) $group->n;
                }
            }

            return $total;
        };

        $trace = [];
        foreach ($steps as $step) {
            $p = $step['position'];
            $trace[] = [
                'position' => $p,
                'input_count' => $count(fn (int $born, int $end) => $born < $p && $end >= $p),
                'output_count' => $step['type'] === 'aggregate' ? 1 : $count(fn (int $born, int $end) => $born <= $p && $end > $p),
            ];
        }

        $contributing = collect(DB::select(
            'SELECT s.input_position, count(DISTINCT s.source_row_id) AS n FROM run_tuples t
             JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no
             WHERE t.run_id = ? AND t.result_no = ? GROUP BY s.input_position',
            [$run->id, $resultNo],
        ))->pluck('n', 'input_position');

        return [
            'inputs' => array_map(fn (array $input) => $input + ['contributing_rows' => (int) ($contributing[$input['position']] ?? 0)], $inputs),
            'steps' => $steps,
            'result' => $result + [
                'base_tuples' => $count(fn (int $born) => $born === 0),
                'trace' => $trace,
            ],
        ];
    }

    public function flows(Run $run, int $limit): array
    {
        $steps = $run->steps();
        $results = DB::select('SELECT result_no, "values", contributor_count FROM run_result_rows WHERE run_id = ? ORDER BY contributor_count DESC, result_no', [$run->id]);

        $groups = DB::select(
            'WITH RECURSIVE anc AS (
                SELECT tuple_no, parent_no, born_step, end_step, result_no AS r FROM run_tuples WHERE run_id = ? AND result_no IS NOT NULL
                UNION
                SELECT p.tuple_no, p.parent_no, p.born_step, p.end_step, a.r FROM run_tuples p JOIN anc a ON p.tuple_no = a.parent_no WHERE p.run_id = ?
            )
            SELECT r, born_step, end_step, count(*) AS n FROM anc GROUP BY r, born_step, end_step',
            [$run->id, $run->id],
        );
        $byResult = [];
        foreach ($groups as $group) {
            $byResult[(int) $group->r][] = $group;
        }

        $contributing = [];
        foreach (DB::select(
            'SELECT t.result_no, s.input_position, count(DISTINCT s.source_row_id) AS n FROM run_tuples t
             JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no
             WHERE t.run_id = ? AND t.result_no IS NOT NULL GROUP BY t.result_no, s.input_position',
            [$run->id],
        ) as $row) {
            $contributing[(int) $row->result_no][(int) $row->input_position] = (int) $row->n;
        }

        $related = $this->relatedExclusionsByResult($run);

        $items = array_map(function (object $row) use ($steps, $byResult, $contributing, $related) {
            $resultNo = (int) $row->result_no;
            $counts = $this->traceCounts($steps, $byResult[$resultNo] ?? []);

            return [
                'result_no' => $resultNo,
                'values' => json_decode($row->values, true),
                'contributor_count' => (int) $row->contributor_count,
                'base_tuples' => $counts['base'],
                'trace' => $counts['trace'],
                'contributing_rows' => (object) ($contributing[$resultNo] ?? []),
                'related_exclusions' => $related[$resultNo] ?? [],
            ];
        }, $results);

        $shown = array_slice($items, 0, max(1, $limit));
        $rest = array_slice($items, max(1, $limit));

        $baseContributors = (int) DB::selectOne(
            'SELECT count(DISTINCT s.source_row_id) AS n FROM run_tuples t
             JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = 0
             WHERE t.run_id = ? AND t.result_no IS NOT NULL',
            [$run->id],
        )->n;

        return [
            'total_results' => count($items),
            'base_contributors' => $baseContributors,
            'results' => $shown,
            'others' => $rest === [] ? null : $this->mergeFlows($rest, $steps),
        ];
    }

    private function traceCounts(array $steps, array $groups): array
    {
        $count = function (callable $predicate) use ($groups): int {
            $total = 0;
            foreach ($groups as $group) {
                $born = (int) $group->born_step;
                $end = $group->end_step === null ? PHP_INT_MAX : (int) $group->end_step;
                if ($predicate($born, $end)) {
                    $total += (int) $group->n;
                }
            }

            return $total;
        };

        $trace = [];
        foreach ($steps as $step) {
            $p = $step['position'];
            $trace[] = [
                'position' => $p,
                'input_count' => $count(fn (int $born, int $end) => $born < $p && $end >= $p),
                'output_count' => $step['type'] === 'aggregate' ? 1 : $count(fn (int $born, int $end) => $born <= $p && $end > $p),
            ];
        }

        return ['base' => $count(fn (int $born) => $born === 0), 'trace' => $trace];
    }

    private function mergeFlows(array $items, array $steps): array
    {
        $trace = array_map(fn (array $step) => ['position' => $step['position'], 'input_count' => 0, 'output_count' => 0], $steps);
        $related = [];
        foreach ($items as $item) {
            foreach ($item['trace'] as $i => $point) {
                $trace[$i]['input_count'] += $point['input_count'];
                $trace[$i]['output_count'] += $point['output_count'];
            }
            foreach ($item['related_exclusions'] as $entry) {
                $key = "{$entry['step_position']}|{$entry['code']}";
                $related[$key] = ['step_position' => $entry['step_position'], 'code' => $entry['code'], 'count' => ($related[$key]['count'] ?? 0) + $entry['count']];
            }
        }

        return [
            'result_nos' => array_column($items, 'result_no'),
            'contributor_count' => array_sum(array_column($items, 'contributor_count')),
            'base_tuples' => array_sum(array_column($items, 'base_tuples')),
            'trace' => $trace,
            'related_exclusions' => array_values($related),
        ];
    }

    private function relatedExclusionsByResult(Run $run): array
    {
        $aggregate = $this->aggregateStep($run);
        if ($aggregate === null) {
            return [];
        }

        $joins = [];
        $joinBindings = [];
        $conditions = [];
        $conditionBindings = [];
        foreach ($aggregate['group_by'] as $i => $group) {
            $joins[] = "JOIN run_tuple_sources gs{$i} ON gs{$i}.run_id = t.run_id AND gs{$i}.tuple_no = t.tuple_no AND gs{$i}.input_position = ?
                JOIN source_rows gr{$i} ON gr{$i}.id = gs{$i}.source_row_id";
            $joinBindings[] = $group['input'];
            $conditions[] = "(rr.\"values\"->>?) IS NOT DISTINCT FROM (gr{$i}.\"values\"->>?)";
            array_push($conditionBindings, $group['output'], $group['column']);
        }

        $rows = DB::select(
            'SELECT rr.result_no, t.end_step, t.exclusion_code, count(*) AS n FROM run_tuples t '.implode(' ', $joins).
            ' JOIN run_result_rows rr ON rr.run_id = t.run_id'.($conditions === [] ? '' : ' AND '.implode(' AND ', $conditions)).
            " WHERE t.run_id = ? AND t.fate = 'excluded' GROUP BY rr.result_no, t.end_step, t.exclusion_code ORDER BY t.end_step",
            [...$joinBindings, ...$conditionBindings, $run->id],
        );

        $byResult = [];
        foreach ($rows as $row) {
            $byResult[(int) $row->result_no][] = ['step_position' => (int) $row->end_step, 'code' => $row->exclusion_code, 'count' => (int) $row->n];
        }

        return $byResult;
    }

    public function resultDetail(Run $run, int $resultNo): array
    {
        $flow = $this->flow($run, $resultNo);

        return [
            'result' => $flow['result'],
            'columns' => $run->output_columns,
            'inputs' => $flow['inputs'],
            'steps' => $flow['steps'],
            'values' => $this->valueDependencies($run, $resultNo, $flow['result']),
            'fields' => $this->fieldRoles($run),
            'related_exclusions' => $this->relatedExclusionSummary($run, $flow['result']),
        ];
    }

    private function valueDependencies(Run $run, int $resultNo, array $result): array
    {
        $dependencies = [];

        foreach ($run->output_columns as $column) {
            $stored = $result['values'][$column['key']] ?? null;
            $source = $column['source'] ?? null;

            if ($column['role'] === 'measure' && $column['function'] === 'count') {
                $dependencies[] = [
                    'key' => $column['key'],
                    'role' => 'measure',
                    'function' => 'count',
                    'stored' => $stored,
                    'recomputed' => $result['contributor_count'],
                    'consistent' => (int) $stored === $result['contributor_count'],
                    'statement' => "Contagem dos {$result['contributor_count']} registros que chegaram a este grupo. Nenhum campo determina o valor; apenas a quantidade de registros.",
                ];

                continue;
            }

            if ($column['role'] === 'measure' && $column['function'] === 'count_distinct') {
                $check = $this->distinctCheck($run, $resultNo, $source);
                $repeated = $check['rows'] - $check['distinct'];
                $statement = 'Valores diferentes de '."{$source['alias']}.{$source['column']}: ".self::count($check['distinct'], 'valor', 'valores').' em '.self::count($check['rows'], 'registro', 'registros');
                if ($repeated > 0) {
                    $statement .= '; '.self::count($repeated, 'registro repete', 'registros repetem').' um valor já contado';
                }
                if ($check['nulls'] > 0) {
                    $statement .= '; '.self::count($check['nulls'], 'vazio foi ignorado', 'vazios foram ignorados');
                }

                $dependencies[] = [
                    'key' => $column['key'],
                    'role' => 'measure',
                    'function' => 'count_distinct',
                    'source' => $source,
                    'stored' => $stored,
                    'recomputed' => $check['distinct'],
                    'counted' => $check['distinct'],
                    'rows' => $check['rows'],
                    'repeated' => $repeated,
                    'ignored_null' => $check['nulls'],
                    'consistent' => (int) $stored === $check['distinct'],
                    'statement' => $statement.'. Recalculado no banco a partir dos registros originais.',
                ];

                continue;
            }

            if ($column['role'] === 'measure') {
                $check = DB::selectOne(
                    'SELECT
                        count(*) FILTER (WHERE x.v IS NULL) AS nulls,
                        count(*) FILTER (WHERE x.v IS NOT NULL AND x.v !~ ?) AS unconvertible,
                        count(*) FILTER (WHERE x.v ~ ?) AS counted,
                        sum(CASE WHEN x.v ~ ? THEN x.v::numeric END)::text AS total
                     FROM (
                        SELECT r."values"->>? AS v FROM run_tuples t
                        LEFT JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?
                        LEFT JOIN source_rows r ON r.id = s.source_row_id
                        WHERE t.run_id = ? AND t.result_no = ?
                     ) x',
                    [self::NUMBER_PATTERN, self::NUMBER_PATTERN, self::NUMBER_PATTERN, $source['column'], $source['input'], $run->id, $resultNo],
                );

                $recomputed = $check->total === null ? null : ValueParser::number($check->total);
                $ignored = (int) $check->nulls + (int) $check->unconvertible;
                $statement = "Soma de {$source['alias']}.{$source['column']} em ".self::count((int) $check->counted, 'registro', 'registros');
                if ($ignored > 0) {
                    $parts = array_filter([
                        (int) $check->nulls > 0 ? self::count((int) $check->nulls, 'vazio', 'vazios') : null,
                        (int) $check->unconvertible > 0 ? self::count((int) $check->unconvertible, 'não numérico', 'não numéricos') : null,
                    ]);
                    $statement .= '; '.implode(' e ', $parts).' '.($ignored === 1 ? 'foi ignorado' : 'foram ignorados');
                }

                $dependencies[] = [
                    'key' => $column['key'],
                    'role' => 'measure',
                    'function' => 'sum',
                    'source' => $source,
                    'stored' => $stored,
                    'recomputed' => $recomputed,
                    'counted' => (int) $check->counted,
                    'ignored_null' => (int) $check->nulls,
                    'ignored_unconvertible' => (int) $check->unconvertible,
                    'consistent' => $stored === $recomputed,
                    'statement' => $statement.'. Recalculado no banco a partir dos registros originais.',
                ];

                continue;
            }

            $dependencies[] = [
                'key' => $column['key'],
                'role' => $column['role'],
                'source' => $source,
                'stored' => $stored,
                'statement' => $column['role'] === 'group_key'
                    ? "Valor copiado de {$source['alias']}.{$source['column']}: todos os registros deste grupo têm esse valor."
                    : "Valor copiado de {$source['alias']}.{$source['column']}.",
            ];
        }

        return $dependencies;
    }

    /**
     * @return array{distinct: int, rows: int, nulls: int}
     */
    private function distinctCheck(Run $run, int $resultNo, array $source): array
    {
        $check = DB::selectOne(
            'SELECT count(DISTINCT x.v) AS distinct_values, count(x.v) AS rows, count(*) FILTER (WHERE x.v IS NULL) AS nulls
             FROM (
                SELECT r."values"->>? AS v FROM run_tuples t
                LEFT JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?
                LEFT JOIN source_rows r ON r.id = s.source_row_id
                WHERE t.run_id = ? AND t.result_no = ?
             ) x',
            [$source['column'], $source['input'], $run->id, $resultNo],
        );

        return ['distinct' => (int) $check->distinct_values, 'rows' => (int) $check->rows, 'nulls' => (int) $check->nulls];
    }

    public function identities(Run $run, int $resultNo, string $measureKey, Pagination $page): array
    {
        $this->result($run, $resultNo);
        $measure = collect($run->output_columns ?? [])->first(fn (array $c) => $c['key'] === $measureKey && ($c['function'] ?? null) === 'count_distinct');
        if ($measure === null) {
            throw new DomainError('run.measure_not_distinct', "A medida {$measureKey} não é uma contagem de valores diferentes.");
        }

        $source = $measure['source'];
        $base = 'SELECT r."values"->>? AS v, count(*) AS tuples, count(DISTINCT s.source_row_id) AS source_rows, min(t.tuple_no) AS first_tuple
            FROM run_tuples t
            JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?
            JOIN source_rows r ON r.id = s.source_row_id
            WHERE t.run_id = ? AND t.result_no = ? AND (r."values"->>?) IS NOT NULL
            GROUP BY 1';
        $bindings = [$source['column'], $source['input'], $run->id, $resultNo, $source['column']];

        $total = (int) DB::selectOne("SELECT count(*) AS n FROM ({$base}) c", $bindings)->n;
        $rows = DB::select("SELECT * FROM ({$base}) c ORDER BY c.tuples DESC, c.v LIMIT ? OFFSET ?", [...$bindings, $page->perPage, $page->offset()]);
        $check = $this->distinctCheck($run, $resultNo, $source);

        return [
            'data' => array_map(fn (object $row) => [
                'value' => $row->v,
                'tuples' => (int) $row->tuples,
                'source_rows' => (int) $row->source_rows,
                'repeated' => (int) $row->tuples - 1,
            ], $rows),
            'meta' => $page->meta($total) + [
                'measure' => $measureKey,
                'source' => $source,
                'distinct' => $check['distinct'],
                'rows' => $check['rows'],
                'repeated' => $check['rows'] - $check['distinct'],
                'ignored_null' => $check['nulls'],
            ],
        ];
    }

    public function fieldRoles(Run $run): array
    {
        $roles = [];

        foreach ($run->steps() as $step) {
            if ($step['type'] === 'filter') {
                foreach ($step['conditions'] as $condition) {
                    if (($condition['kind'] ?? null) === 'validity') {
                        foreach (array_filter([$condition['start_column'], $condition['end_column']]) as $column) {
                            $roles[$condition['input']][$column][] = [
                                'kind' => 'condition',
                                'step_position' => $step['position'],
                                'description' => 'Define a vigência usada na leitura: '.StepDescriber::condition($condition),
                            ];
                        }

                        continue;
                    }
                    $roles[$condition['input']][$condition['column']][] = [
                        'kind' => 'condition',
                        'step_position' => $step['position'],
                        'description' => 'Decide se o registro continua: '.StepDescriber::condition($condition),
                    ];
                }
            }

            if ($step['type'] === 'join') {
                foreach (['probe', 'lookup'] as $side) {
                    $roles[$step[$side]['input']][$step[$side]['column']][] = [
                        'kind' => 'join_key',
                        'step_position' => $step['position'],
                        'description' => 'Chave usada para relacionar os conjuntos.',
                    ];
                }
            }

            if ($step['type'] === 'aggregate') {
                foreach ($step['group_by'] as $group) {
                    $roles[$group['input']][$group['column']][] = [
                        'kind' => 'group',
                        'step_position' => $step['position'],
                        'description' => 'Define a qual grupo o registro pertence.',
                    ];
                }
                foreach ($step['measures'] as $measure) {
                    if ($measure['function'] !== 'count') {
                        $roles[$measure['input']][$measure['column']][] = [
                            'kind' => 'value',
                            'step_position' => $step['position'],
                            'description' => $measure['function'] === 'sum'
                                ? "Valor somado em {$measure['name']}."
                                : "Identidade contada uma vez por valor em {$measure['name']}.",
                        ];
                    }
                }
            }
        }

        $hasAggregate = collect($run->steps())->contains(fn (array $step) => $step['type'] === 'aggregate');

        return array_map(fn (array $input) => [
            'input' => $input['position'],
            'alias' => $input['alias'],
            'columns' => array_map(function (array $column) use ($roles, $input, $hasAggregate) {
                $columnRoles = $roles[$input['position']][$column['key']] ?? [];
                if (! $hasAggregate) {
                    $columnRoles[] = ['kind' => 'value', 'step_position' => null, 'description' => 'Copiado para o resultado.'];
                }

                return [
                    'key' => $column['key'],
                    'label' => $column['label'],
                    'roles' => $columnRoles,
                    'participates' => $columnRoles !== [],
                ];
            }, $input['columns']),
        ], $run->inputs());
    }

    private function relatedExclusionSummary(Run $run, array $result): ?array
    {
        $aggregate = $this->aggregateStep($run);
        if ($aggregate === null) {
            return null;
        }

        [$where, $bindings] = $this->groupMatchClause($aggregate, $result['values']);
        $matching = DB::select(
            "SELECT t.end_step, t.exclusion_code, count(*) AS n FROM run_tuples t
             WHERE t.run_id = ? AND t.fate = 'excluded' AND {$where}
             GROUP BY t.end_step, t.exclusion_code ORDER BY t.end_step",
            [$run->id, ...$bindings],
        );

        $inputs = array_values(array_unique(array_column($aggregate['group_by'], 'input')));
        $missing = implode(' OR ', array_fill(0, count($inputs), 'NOT EXISTS (SELECT 1 FROM run_tuple_sources s WHERE s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?)'));
        $unattributable = $inputs === [] ? [] : DB::select(
            "SELECT t.end_step, count(*) AS n FROM run_tuples t
             WHERE t.run_id = ? AND t.fate = 'excluded' AND ({$missing})
             GROUP BY t.end_step ORDER BY t.end_step",
            [$run->id, ...$inputs],
        );

        $titles = collect($run->steps())->pluck('title', 'position');
        $groupLabel = implode(', ', array_map(
            fn (array $g) => "{$g['alias']}.{$g['column']} = ".StepDescriber::value($result['values'][$g['output']] ?? null, 'text'),
            $aggregate['group_by'],
        ));

        return [
            'group' => $groupLabel === '' ? 'todos os registros' : $groupLabel,
            'matching' => array_map(fn (object $row) => [
                'step_position' => (int) $row->end_step,
                'step_title' => $titles[(int) $row->end_step] ?? null,
                'code' => $row->exclusion_code,
                'label' => Explainer::codeLabel($row->exclusion_code),
                'count' => (int) $row->n,
            ], $matching),
            'unattributable' => array_map(fn (object $row) => [
                'step_position' => (int) $row->end_step,
                'step_title' => $titles[(int) $row->end_step] ?? null,
                'count' => (int) $row->n,
            ], $unattributable),
            'note' => 'Registros excluídos antes de as colunas de agrupamento estarem disponíveis não podem ser atribuídos a um grupo sem uma suposição que o motor não fez.',
        ];
    }

    private function groupMatchClause(array $aggregate, array $values): array
    {
        $clauses = [];
        $bindings = [];

        foreach ($aggregate['group_by'] as $group) {
            $clauses[] = 'EXISTS (SELECT 1 FROM run_tuple_sources s JOIN source_rows r ON r.id = s.source_row_id
                WHERE s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ? AND (r."values"->>?) IS NOT DISTINCT FROM ?::text)';
            $bindings[] = $group['input'];
            $bindings[] = $group['column'];
            $bindings[] = $values[$group['output']] ?? null;
        }

        return [$clauses === [] ? 'TRUE' : implode(' AND ', $clauses), $bindings];
    }

    private function aggregateStep(Run $run): ?array
    {
        foreach ($run->steps() as $step) {
            if ($step['type'] === 'aggregate') {
                return $step;
            }
        }

        return null;
    }

    public function contributors(Run $run, int $resultNo, int $input, Pagination $page, ?int $viaInput = null, ?int $viaRow = null): array
    {
        $this->assertInput($run, $input);
        $this->result($run, $resultNo);

        $via = '';
        $bindings = [$input];
        if ($viaInput !== null && $viaRow !== null) {
            $this->assertInput($run, $viaInput);
            $via = 'JOIN run_tuple_sources v ON v.run_id = t.run_id AND v.tuple_no = t.tuple_no AND v.input_position = ? AND v.source_row_id = ?';
            $bindings[] = $viaInput;
            $bindings[] = $viaRow;
        }
        $bindings[] = $run->id;
        $bindings[] = $resultNo;

        $base = "SELECT s.source_row_id, count(*) AS tuples FROM run_tuples t
            JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?
            {$via}
            WHERE t.run_id = ? AND t.result_no = ?
            GROUP BY s.source_row_id";

        $total = (int) DB::selectOne("SELECT count(*) AS n FROM ({$base}) c", $bindings)->n;
        $rows = DB::select(
            "SELECT c.source_row_id AS id, c.tuples, r.row_number, r.line_number, r.\"values\" FROM ({$base}) c
             JOIN source_rows r ON r.id = c.source_row_id ORDER BY r.row_number LIMIT ? OFFSET ?",
            [...$bindings, $page->perPage, $page->offset()],
        );

        $measures = array_values(array_filter(
            $run->output_columns ?? [],
            fn (array $column) => in_array($column['function'] ?? null, ['sum', 'count_distinct'], true) && $column['source']['input'] === $input,
        ));
        $firstRows = $this->firstRowsByIdentity($run, $resultNo, $measures, $rows);

        return [
            'data' => array_map(function (object $row) use ($measures, $firstRows) {
                $presented = DatasetPresenter::row($row) + ['tuples' => (int) $row->tuples];
                $presented['measure_values'] = array_map(function (array $measure) use ($presented, $firstRows) {
                    $raw = $presented['values'][$measure['source']['column']] ?? null;
                    $status = match (true) {
                        $raw === null => 'ignored_null',
                        $measure['function'] === 'count_distinct' => ($firstRows[$measure['key']][$raw] ?? null) === $presented['id'] ? 'counted' : 'repeated',
                        ValueParser::number($raw) === null => 'ignored_unconvertible',
                        default => 'counted',
                    };

                    return [
                        'measure' => $measure['key'],
                        'column' => $measure['source']['column'],
                        'raw' => $raw,
                        'status' => $status,
                    ];
                }, $measures);

                return $presented;
            }, $rows),
            'meta' => $page->meta($total) + ['input' => $input, 'alias' => $run->inputs()[$input]['alias']],
        ];
    }

    /**
     * @return array<string, array<string, int>>
     */
    private function firstRowsByIdentity(Run $run, int $resultNo, array $measures, array $rows): array
    {
        $first = [];

        foreach ($measures as $measure) {
            if ($measure['function'] !== 'count_distinct') {
                continue;
            }

            $values = array_values(array_unique(array_filter(array_map(
                fn (object $row) => json_decode($row->values, true)[$measure['source']['column']] ?? null,
                $rows,
            ), fn ($v) => $v !== null)));

            if ($values === []) {
                continue;
            }

            $found = DB::select(
                'SELECT DISTINCT ON (x.v) x.v, x.source_row_id FROM (
                    SELECT r."values"->>? AS v, s.source_row_id, t.tuple_no
                    FROM run_tuples t
                    JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?
                    JOIN source_rows r ON r.id = s.source_row_id
                    WHERE t.run_id = ? AND t.result_no = ?
                 ) x
                 WHERE x.v IN (SELECT jsonb_array_elements_text(?::jsonb))
                 ORDER BY x.v, x.tuple_no',
                [$measure['source']['column'], $measure['source']['input'], $run->id, $resultNo, json_encode($values, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)],
            );

            foreach ($found as $row) {
                $first[$measure['key']][$row->v] = (int) $row->source_row_id;
            }
        }

        return $first;
    }

    public function breakdown(Run $run, int $resultNo, int $byInput, Pagination $page): array
    {
        $this->assertInput($run, $byInput);
        $this->result($run, $resultNo);

        $sums = array_values(array_filter($run->output_columns ?? [], fn (array $c) => ($c['function'] ?? null) === 'sum'));
        $selects = [];
        $joins = [];
        $selectBindings = [];
        $joinBindings = [];

        foreach ($sums as $i => $measure) {
            $joins[] = "LEFT JOIN run_tuple_sources m{$i} ON m{$i}.run_id = t.run_id AND m{$i}.tuple_no = t.tuple_no AND m{$i}.input_position = ?
                LEFT JOIN source_rows mr{$i} ON mr{$i}.id = m{$i}.source_row_id";
            $joinBindings[] = $measure['source']['input'];
            $selects[] = "sum(CASE WHEN (mr{$i}.\"values\"->>?) ~ ? THEN (mr{$i}.\"values\"->>?)::numeric END)::text AS sum_{$i}";
            array_push($selectBindings, $measure['source']['column'], self::NUMBER_PATTERN, $measure['source']['column']);
        }

        $selectSql = $selects === [] ? '' : ', '.implode(', ', $selects);
        $joinSql = implode(' ', $joins);
        $base = "SELECT b.source_row_id, count(*) AS tuples{$selectSql}
            FROM run_tuples t
            JOIN run_tuple_sources b ON b.run_id = t.run_id AND b.tuple_no = t.tuple_no AND b.input_position = ?
            {$joinSql}
            WHERE t.run_id = ? AND t.result_no = ?
            GROUP BY b.source_row_id";
        $bindings = [...$selectBindings, $byInput, ...$joinBindings, $run->id, $resultNo];

        $total = (int) DB::selectOne("SELECT count(*) AS n FROM ({$base}) c", $bindings)->n;
        $order = $sums === [] ? 'c.tuples DESC' : 'c.sum_0::numeric DESC NULLS LAST';
        $rows = DB::select(
            "SELECT c.*, r.id, r.row_number, r.line_number, r.\"values\" FROM ({$base}) c
             JOIN source_rows r ON r.id = c.source_row_id ORDER BY {$order}, r.row_number LIMIT ? OFFSET ?",
            [...$bindings, $page->perPage, $page->offset()],
        );

        $without = $this->tuplesWithoutInput($run, $resultNo, $byInput);

        return [
            'data' => array_map(function (object $row) use ($sums) {
                $partials = [];
                foreach ($sums as $i => $measure) {
                    $value = $row->{"sum_{$i}"};
                    $partials[$measure['key']] = $value === null ? null : ValueParser::number($value);
                }

                return DatasetPresenter::row($row) + ['tuples' => (int) $row->tuples, 'partials' => $partials];
            }, $rows),
            'meta' => $page->meta($total) + [
                'input' => $byInput,
                'alias' => $run->inputs()[$byInput]['alias'],
                'tuples_without_input' => $without,
            ],
        ];
    }

    private function tuplesWithoutInput(Run $run, int $resultNo, int $input): int
    {
        return (int) DB::selectOne(
            'SELECT count(*) AS n FROM run_tuples t WHERE t.run_id = ? AND t.result_no = ?
             AND NOT EXISTS (SELECT 1 FROM run_tuple_sources s WHERE s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = ?)',
            [$run->id, $resultNo, $input],
        )->n;
    }

    public function exclusions(Run $run, array $filters, Pagination $page): array
    {
        $where = ['t.run_id = ?', "t.fate = 'excluded'"];
        $bindings = [$run->id];

        if (isset($filters['step'])) {
            $where[] = 't.end_step = ?';
            $bindings[] = (int) $filters['step'];
        }

        if (isset($filters['code'])) {
            $where[] = 't.exclusion_code = ?';
            $bindings[] = (string) $filters['code'];
        }

        if (isset($filters['result'])) {
            $aggregate = $this->aggregateStep($run);
            if ($aggregate !== null) {
                $result = $this->result($run, (int) $filters['result']);
                [$clause, $groupBindings] = $this->groupMatchClause($aggregate, $result['values']);
                $where[] = $clause;
                array_push($bindings, ...$groupBindings);
            }
        }

        $whereSql = implode(' AND ', $where);
        $total = (int) DB::selectOne("SELECT count(*) AS n FROM run_tuples t WHERE {$whereSql}", $bindings)->n;
        $tuples = DB::select(
            "SELECT t.tuple_no, t.end_step, t.exclusion_code, t.exclusion_detail FROM run_tuples t WHERE {$whereSql}
             ORDER BY t.end_step, t.tuple_no LIMIT ? OFFSET ?",
            [...$bindings, $page->perPage, $page->offset()],
        );

        $sources = $this->sourcesFor($run, array_map(fn (object $t) => (int) $t->tuple_no, $tuples));
        $titles = collect($run->steps())->pluck('title', 'position');

        $summary = DB::select(
            "SELECT t.end_step, t.exclusion_code, count(*) AS n FROM run_tuples t WHERE t.run_id = ? AND t.fate = 'excluded'
             GROUP BY t.end_step, t.exclusion_code ORDER BY t.end_step, t.exclusion_code",
            [$run->id],
        );

        return [
            'data' => array_map(function (object $tuple) use ($sources, $titles) {
                $detail = json_decode($tuple->exclusion_detail, true) ?? [];

                return [
                    'tuple_no' => (int) $tuple->tuple_no,
                    'step_position' => (int) $tuple->end_step,
                    'step_title' => $titles[(int) $tuple->end_step] ?? null,
                    'code' => $tuple->exclusion_code,
                    'label' => Explainer::codeLabel($tuple->exclusion_code),
                    'explanation' => Explainer::exclusion($tuple->exclusion_code, $detail),
                    'detail' => $detail,
                    'sources' => $sources[(int) $tuple->tuple_no] ?? [],
                ];
            }, $tuples),
            'meta' => $page->meta($total) + [
                'summary' => array_map(fn (object $row) => [
                    'step_position' => (int) $row->end_step,
                    'step_title' => $titles[(int) $row->end_step] ?? null,
                    'code' => $row->exclusion_code,
                    'label' => Explainer::codeLabel($row->exclusion_code),
                    'count' => (int) $row->n,
                ], $summary),
            ],
        ];
    }

    public function diagnostics(Run $run, array $filters, Pagination $page): array
    {
        $where = ['d.run_id = ?'];
        $bindings = [$run->id];

        foreach (['code' => 'd.code', 'severity' => 'd.severity'] as $key => $column) {
            if (isset($filters[$key])) {
                $codes = array_filter(explode(',', (string) $filters[$key]));
                $where[] = "{$column} IN (".implode(',', array_fill(0, count($codes), '?')).')';
                array_push($bindings, ...$codes);
            }
        }

        if (isset($filters['step'])) {
            $where[] = 'd.step_position = ?';
            $bindings[] = (int) $filters['step'];
        }

        $whereSql = implode(' AND ', $where);
        $total = (int) DB::selectOne("SELECT count(*) AS n FROM run_diagnostics d WHERE {$whereSql}", $bindings)->n;
        $rows = DB::select(
            "SELECT d.id, d.step_position, d.code, d.severity, d.tuple_no, d.detail, r.id AS row_id, r.dataset_version_id, r.row_number, r.line_number, r.\"values\"
             FROM run_diagnostics d LEFT JOIN source_rows r ON r.id = d.source_row_id
             WHERE {$whereSql} ORDER BY d.step_position, d.code, d.id LIMIT ? OFFSET ?",
            [...$bindings, $page->perPage, $page->offset()],
        );

        $aliasByVersion = collect($run->inputs())->pluck('alias', 'version_id');
        $titles = collect($run->steps())->pluck('title', 'position');
        $summary = DB::select(
            'SELECT d.step_position, d.code, d.severity, count(*) AS n FROM run_diagnostics d WHERE d.run_id = ?
             GROUP BY d.step_position, d.code, d.severity ORDER BY d.step_position, d.code',
            [$run->id],
        );

        return [
            'data' => array_map(function (object $row) use ($aliasByVersion, $titles) {
                $detail = json_decode($row->detail, true);

                return [
                    'id' => (int) $row->id,
                    'step_position' => (int) $row->step_position,
                    'step_title' => $titles[(int) $row->step_position] ?? null,
                    'code' => $row->code,
                    'label' => Explainer::codeLabel($row->code),
                    'severity' => $row->severity,
                    'tuple_no' => $row->tuple_no === null ? null : (int) $row->tuple_no,
                    'explanation' => Explainer::diagnostic($row->code, $detail),
                    'detail' => $detail,
                    'row' => $row->row_id === null ? null : [
                        'alias' => $aliasByVersion[$row->dataset_version_id] ?? null,
                        'id' => (int) $row->row_id,
                        'row_number' => (int) $row->row_number,
                        'line_number' => (int) $row->line_number,
                        'values' => json_decode($row->values, true),
                    ],
                ];
            }, $rows),
            'meta' => $page->meta($total) + [
                'summary' => array_map(fn (object $row) => [
                    'step_position' => (int) $row->step_position,
                    'step_title' => $titles[(int) $row->step_position] ?? null,
                    'code' => $row->code,
                    'label' => Explainer::codeLabel($row->code),
                    'severity' => $row->severity,
                    'count' => (int) $row->n,
                ], $summary),
            ],
        ];
    }

    public function sourcesFor(Run $run, array $tupleNos): array
    {
        if ($tupleNos === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($tupleNos), '?'));
        $rows = DB::select(
            "SELECT s.tuple_no, s.input_position, r.id, r.row_number, r.line_number, r.\"values\"
             FROM run_tuple_sources s JOIN source_rows r ON r.id = s.source_row_id
             WHERE s.run_id = ? AND s.tuple_no IN ({$placeholders}) ORDER BY s.tuple_no, s.input_position",
            [$run->id, ...$tupleNos],
        );

        $inputs = $run->inputs();
        $grouped = [];
        foreach ($rows as $row) {
            $grouped[(int) $row->tuple_no][] = [
                'input' => (int) $row->input_position,
                'alias' => $inputs[(int) $row->input_position]['alias'],
                'row' => DatasetPresenter::row($row),
            ];
        }

        return $grouped;
    }

    public function findRows(Run $run, string $alias, ?string $column, ?string $value, ?int $rowNumber): array
    {
        $input = $run->inputByAlias($alias) ?? throw new DomainError('run.alias_unknown', "O conjunto {$alias} não participa desta execução.", 404);
        $query = DB::table('source_rows')->where('dataset_version_id', $input['version_id']);

        if ($rowNumber !== null) {
            $query->where('row_number', $rowNumber);
        } elseif ($column !== null && $value !== null) {
            if (! in_array($column, array_column($input['columns'], 'key'), true)) {
                throw new DomainError('run.column_unknown', "A coluna {$column} não existe em {$alias}.", 422);
            }
            $query->whereRaw('"values" @> jsonb_build_object(?::text, ?::text)', [$column, $value]);
        } else {
            throw new DomainError('run.search_invalid', 'Informe a coluna e o valor, ou o número do registro.', 422);
        }

        return array_map(
            fn (object $row) => DatasetPresenter::row($row) + ['alias' => $alias, 'input' => $input['position']],
            $query->orderBy('row_number')->limit(20)->get(['id', 'row_number', 'line_number', 'values'])->all(),
        );
    }

    private static function count(int $count, string $singular, string $plural): string
    {
        return $count === 1 ? "1 {$singular}" : "{$count} {$plural}";
    }

    private function assertInput(Run $run, int $input): void
    {
        if (! isset($run->inputs()[$input])) {
            throw new DomainError('run.input_unknown', 'Entrada inexistente nesta execução.', 404);
        }
    }
}
