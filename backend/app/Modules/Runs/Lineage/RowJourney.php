<?php

namespace App\Modules\Runs\Lineage;

use App\Modules\Datasets\DatasetPresenter;
use App\Modules\Recipes\StepDescriber;
use App\Modules\Runs\Engine\TupleStore;
use App\Modules\Runs\Run;
use App\Modules\Support\DomainError;
use Illuminate\Support\Facades\DB;

final class RowJourney
{
    public function __construct(private readonly RunLineage $lineage)
    {
    }

    public function trace(Run $run, int $sourceRowId): array
    {
        $row = DB::selectOne('SELECT id, dataset_version_id, row_number, line_number, "values" FROM source_rows WHERE id = ?', [$sourceRowId]);
        $input = $row ? $this->inputForVersion($run, $row->dataset_version_id) : null;

        if ($row === null || $input === null) {
            throw $this->notInRun($run, $row);
        }

        $steps = $run->steps();
        $subject = DatasetPresenter::row($row) + [
            'alias' => $input['alias'],
            'input' => $input['position'],
            'dataset_name' => $input['dataset_name'],
            'version_number' => $input['version_number'],
        ];

        $containing = DB::select(
            'SELECT t.tuple_no FROM run_tuple_sources s JOIN run_tuples t ON t.run_id = s.run_id AND t.tuple_no = s.tuple_no
             WHERE s.run_id = ? AND s.source_row_id = ? AND s.input_position = ? ORDER BY t.tuple_no',
            [$run->id, $sourceRowId, $input['position']],
        );
        $tupleNos = array_map(fn (object $t) => (int) $t->tuple_no, $containing);

        $tuples = $this->withAncestors($run, $tupleNos);
        $leaves = array_values(array_filter($tupleNos, fn (int $no) => $tuples[$no]->fate !== TupleStore::EXPANDED));
        $sources = $this->lineage->sourcesFor($run, array_keys($tuples));
        $diagnostics = $this->diagnosticsFor($run, $sourceRowId);
        $results = $this->resultsFor($run, array_filter(array_map(fn (int $no) => $tuples[$no]->result_no, $leaves)));

        $paths = array_map(
            fn (int $leaf) => $this->path($run, $steps, $tuples, $sources, $leaf, $input['position'], $diagnostics, $results),
            $leaves,
        );

        $references = $tupleNos === [] ? $this->references($run, $steps, $input, $subject['values']) : null;

        return [
            'row' => $subject,
            'steps' => array_map(fn (array $s) => ['position' => $s['position'], 'type' => $s['type'], 'title' => $s['title'], 'summary' => $s['summary']], $steps),
            'paths' => $paths,
            'diagnostics' => $diagnostics,
            'references' => $references,
            'summary' => $this->summary($paths, $references, $diagnostics, $input),
        ];
    }

    private function withAncestors(Run $run, array $tupleNos): array
    {
        if ($tupleNos === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($tupleNos), '?'));
        $rows = DB::select(
            "WITH RECURSIVE chain AS (
                SELECT * FROM run_tuples WHERE run_id = ? AND tuple_no IN ({$placeholders})
                UNION
                SELECT p.* FROM run_tuples p JOIN chain c ON p.tuple_no = c.parent_no WHERE p.run_id = ?
            ) SELECT tuple_no, parent_no, born_step, end_step, fate, exclusion_code, exclusion_detail, result_no FROM chain",
            [$run->id, ...$tupleNos, $run->id],
        );

        $byNo = [];
        foreach ($rows as $row) {
            $byNo[(int) $row->tuple_no] = $row;
        }

        return $byNo;
    }

    private function path(Run $run, array $steps, array $tuples, array $sources, int $leaf, int $subjectInput, array $diagnostics, array $results): array
    {
        $chain = [];
        for ($no = $leaf; $no !== null; $no = $tuples[$no]->parent_no === null ? null : (int) $tuples[$no]->parent_no) {
            array_unshift($chain, $tuples[$no]);
        }

        $timeline = [];
        $outcome = null;
        $subjectJoinedAt = null;

        foreach ($steps as $step) {
            $p = $step['position'];
            $current = null;
            $next = null;

            foreach ($chain as $i => $tuple) {
                $end = $tuple->end_step === null ? PHP_INT_MAX : (int) $tuple->end_step;
                if ((int) $tuple->born_step < $p && $end >= $p) {
                    $current = $tuple;
                    $next = $chain[$i + 1] ?? null;
                    break;
                }
            }

            $present = $this->hasInput($sources, $current, $subjectInput);
            $entry = ['position' => $p, 'type' => $step['type'], 'title' => $step['title'], 'subject_present' => $present];

            if ($current === null) {
                $timeline[] = $entry + ['status' => 'not_reached'];

                continue;
            }

            $end = $current->end_step === null ? null : (int) $current->end_step;

            if ($end === $p && $current->fate === TupleStore::EXCLUDED) {
                $detail = json_decode($current->exclusion_detail, true) ?? [];
                $timeline[] = $entry + [
                    'status' => 'excluded',
                    'code' => $current->exclusion_code,
                    'label' => Explainer::codeLabel($current->exclusion_code),
                    'explanation' => Explainer::exclusion($current->exclusion_code, $detail),
                    'detail' => $detail,
                ];
                $outcome = [
                    'status' => 'excluded',
                    'step_position' => $p,
                    'step_title' => $step['title'],
                    'code' => $current->exclusion_code,
                    'explanation' => Explainer::exclusion($current->exclusion_code, $detail),
                ];

                continue;
            }

            if ($end === $p && $current->fate === TupleStore::EXPANDED && $next !== null) {
                $subjectIsLookup = $step['lookup']['input'] === $subjectInput;
                $partnerInput = $subjectIsLookup ? $step['probe']['input'] : $step['lookup']['input'];
                if ($subjectIsLookup) {
                    $subjectJoinedAt = $p;
                }
                $timeline[] = $entry + [
                    'subject_present' => true,
                    'status' => 'joined',
                    'explanation' => "Relacionado por {$step['probe']['alias']}.{$step['probe']['column']} = {$step['lookup']['alias']}.{$step['lookup']['column']}.",
                    'partner' => $this->sourceAt($sources, (int) $next->tuple_no, $partnerInput),
                ];

                continue;
            }

            $entry += match ($step['type']) {
                'filter' => ['status' => 'passed', 'explanation' => 'Atende: '.implode(' e ', array_map(fn ($c) => StepDescriber::condition($c), $step['conditions'])).'.'],
                'join' => $this->keptUnmatched($diagnostics, $p),
                'aggregate' => ['status' => 'aggregated', 'result_no' => $current->result_no === null ? null : (int) $current->result_no],
                default => ['status' => 'passed'],
            };
            $timeline[] = $entry;
        }

        $leafTuple = $tuples[$leaf];
        if ($outcome === null && $leafTuple->fate === TupleStore::INCLUDED) {
            $resultNo = (int) $leafTuple->result_no;
            $outcome = [
                'status' => 'included',
                'result_no' => $resultNo,
                'result_values' => $results[$resultNo] ?? null,
                'explanation' => 'O registro chegou ao resultado e contribuiu para a linha '.$resultNo.'.',
            ];
        }

        return [
            'tuple_no' => $leaf,
            'subject_joined_at' => $subjectJoinedAt,
            'combined_with' => array_values(array_filter(
                $sources[$leaf] ?? [],
                fn (array $source) => $source['input'] !== $subjectInput,
            )),
            'timeline' => $timeline,
            'outcome' => $outcome,
        ];
    }

    private function keptUnmatched(array $diagnostics, int $position): array
    {
        foreach ($diagnostics as $diagnostic) {
            if ($diagnostic['step_position'] === $position && in_array($diagnostic['code'], ['join.left_unmatched', 'join.null_key'], true)) {
                return ['status' => 'kept_unmatched', 'explanation' => $diagnostic['explanation'].' A junção mantém registros sem correspondência.'];
            }
        }

        return ['status' => 'kept_unmatched', 'explanation' => 'Sem correspondência nesta junção; a junção mantém registros sem correspondência.'];
    }

    private function references(Run $run, array $steps, array $input, array $values): ?array
    {
        foreach ($steps as $step) {
            if ($step['type'] !== 'join' || $step['lookup']['input'] !== $input['position']) {
                continue;
            }

            $key = $values[$step['lookup']['column']] ?? null;
            $probeInput = $run->inputs()[$step['probe']['input']];
            if ($key === null) {
                return [
                    'step_position' => $step['position'],
                    'key' => null,
                    'referencing_rows' => 0,
                    'reached_join' => 0,
                    'excluded_before' => [],
                    'explanation' => "{$input['alias']}.{$step['lookup']['column']} está vazio; nenhum registro pode se relacionar com ele.",
                ];
            }

            $referencing = DB::select(
                'SELECT id FROM source_rows WHERE dataset_version_id = ? AND "values" @> jsonb_build_object(?::text, ?::text)',
                [$probeInput['version_id'], $step['probe']['column'], $key],
            );
            $ids = array_map(fn (object $r) => (int) $r->id, $referencing);

            $excludedBefore = [];
            $reached = 0;
            if ($ids !== []) {
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $fates = DB::select(
                    "SELECT t.end_step, t.exclusion_code, t.fate, t.born_step, count(*) AS n FROM run_tuple_sources s
                     JOIN run_tuples t ON t.run_id = s.run_id AND t.tuple_no = s.tuple_no
                     WHERE s.run_id = ? AND s.input_position = ? AND s.source_row_id IN ({$placeholders})
                     GROUP BY t.end_step, t.exclusion_code, t.fate, t.born_step",
                    [$run->id, $step['probe']['input'], ...$ids],
                );
                $titles = collect($steps)->pluck('title', 'position');
                foreach ($fates as $fate) {
                    $end = $fate->end_step === null ? PHP_INT_MAX : (int) $fate->end_step;
                    if ($fate->fate === TupleStore::EXCLUDED && $end < $step['position']) {
                        $excludedBefore[] = [
                            'step_position' => $end,
                            'step_title' => $titles[$end] ?? null,
                            'code' => $fate->exclusion_code,
                            'label' => Explainer::codeLabel($fate->exclusion_code),
                            'count' => (int) $fate->n,
                        ];
                    } elseif ((int) $fate->born_step < $step['position'] && $end >= $step['position']) {
                        $reached += (int) $fate->n;
                    }
                }
            }

            $count = count($ids);
            $explanation = $count === 0
                ? "Nenhum registro de {$probeInput['alias']} tem {$step['probe']['column']} = \"{$key}\"."
                : ($reached === 0
                    ? "{$count} ".($count === 1 ? 'registro' : 'registros')." de {$probeInput['alias']} ".($count === 1 ? 'referencia' : 'referenciam')." este registro, mas ".($count === 1 ? 'foi excluído' : 'todos foram excluídos').' antes da junção.'
                    : "{$count} registros de {$probeInput['alias']} referenciam este registro.");

            return [
                'step_position' => $step['position'],
                'key' => $key,
                'probe' => ['alias' => $probeInput['alias'], 'column' => $step['probe']['column']],
                'referencing_rows' => $count,
                'reached_join' => $reached,
                'excluded_before' => $excludedBefore,
                'explanation' => $explanation,
            ];
        }

        return null;
    }

    private function diagnosticsFor(Run $run, int $sourceRowId): array
    {
        $titles = collect($run->steps())->pluck('title', 'position');

        return array_map(function (object $row) use ($titles) {
            $detail = json_decode($row->detail, true);

            return [
                'step_position' => (int) $row->step_position,
                'step_title' => $titles[(int) $row->step_position] ?? null,
                'code' => $row->code,
                'label' => Explainer::codeLabel($row->code),
                'severity' => $row->severity,
                'tuple_no' => $row->tuple_no === null ? null : (int) $row->tuple_no,
                'explanation' => Explainer::diagnostic($row->code, $detail),
                'detail' => $detail,
            ];
        }, DB::select(
            'SELECT step_position, code, severity, tuple_no, detail FROM run_diagnostics WHERE run_id = ? AND source_row_id = ? ORDER BY step_position, id',
            [$run->id, $sourceRowId],
        ));
    }

    private function resultsFor(Run $run, array $resultNos): array
    {
        $resultNos = array_values(array_unique($resultNos));
        if ($resultNos === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($resultNos), '?'));

        return collect(DB::select(
            "SELECT result_no, \"values\" FROM run_result_rows WHERE run_id = ? AND result_no IN ({$placeholders})",
            [$run->id, ...$resultNos],
        ))->mapWithKeys(fn (object $row) => [(int) $row->result_no => json_decode($row->values, true)])->all();
    }

    private function summary(array $paths, ?array $references, array $diagnostics, array $input): string
    {
        if ($paths === []) {
            $notJoined = collect($diagnostics)->firstWhere('code', 'join.right_unmatched')
                ?? collect($diagnostics)->firstWhere('code', 'join.lookup_null_key');

            if ($references !== null) {
                return "Este registro de {$input['alias']} não foi relacionado na junção (passo {$references['step_position']}). {$references['explanation']}";
            }

            return $notJoined['explanation'] ?? 'Este registro não participou desta execução.';
        }

        $included = array_filter($paths, fn (array $path) => ($path['outcome']['status'] ?? null) === 'included');
        $excluded = array_filter($paths, fn (array $path) => ($path['outcome']['status'] ?? null) === 'excluded');

        if (count($paths) === 1) {
            $outcome = $paths[0]['outcome'];

            return $outcome['status'] === 'included'
                ? "Contribuiu para a linha {$outcome['result_no']} do resultado."
                : "Excluído no passo {$outcome['step_position']} ({$outcome['step_title']}). {$outcome['explanation']}";
        }

        return 'Este registro aparece em '.count($paths).' combinações: '.count($included).' chegaram ao resultado e '.count($excluded).' foram excluídas.';
    }

    private function hasInput(array $sources, ?object $tuple, int $input): bool
    {
        if ($tuple === null) {
            return false;
        }

        foreach ($sources[(int) $tuple->tuple_no] ?? [] as $source) {
            if ($source['input'] === $input) {
                return true;
            }
        }

        return false;
    }

    private function sourceAt(array $sources, int $tupleNo, int $input): ?array
    {
        foreach ($sources[$tupleNo] ?? [] as $source) {
            if ($source['input'] === $input) {
                return $source;
            }
        }

        return null;
    }

    private function inputForVersion(Run $run, string $versionId): ?array
    {
        foreach ($run->inputs() as $input) {
            if ($input['version_id'] === $versionId) {
                return $input;
            }
        }

        return null;
    }

    private function notInRun(Run $run, ?object $row): DomainError
    {
        if ($row === null) {
            return new DomainError('row.not_found', 'Registro não encontrado.', 404);
        }

        $datasetId = DB::table('dataset_versions')->where('id', $row->dataset_version_id)->value('dataset_id');
        foreach ($run->inputs() as $input) {
            if ($input['dataset_id'] === $datasetId) {
                return new DomainError('row.version_mismatch', "Este registro pertence a outra versão de {$input['alias']}. A execução usou a versão {$input['version_number']}.", 409, [
                    'run_version_id' => $input['version_id'],
                ]);
            }
        }

        return new DomainError('row.not_in_run', 'Este registro pertence a um conjunto que não participa desta execução.', 404);
    }
}
