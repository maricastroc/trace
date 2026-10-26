<?php

namespace App\Modules\Comparisons;

use App\Modules\Datasets\DatasetPresenter;
use App\Modules\Runs\Lineage\Explainer;
use App\Modules\Support\DomainError;
use App\Modules\Support\Pagination;
use Illuminate\Support\Facades\DB;

final class ComparisonInvestigation
{
    public const STATES = ['selected', 'excluded', 'all'];

    /**
     * @param  array{category?: string, explanation?: string, repeated?: string, changed?: bool, search?: string}  $filters
     */
    public function identities(ComparisonRun $comparison, array $filters, Pagination $page): array
    {
        $this->ready($comparison);
        $query = DB::table('comparison_identities')->where('comparison_run_id', $comparison->id);

        if (isset($filters['category'])) {
            if (! in_array($filters['category'], Reconciler::CATEGORIES, true)) {
                throw new DomainError('comparison.category_unknown', 'Categoria desconhecida. Use shared, shared_by_rule, only_a ou only_b.');
            }
            $query->where('category', $filters['category']);
        }
        if (isset($filters['explanation'])) {
            $query->where('explanation', $filters['explanation']);
        }
        if (($filters['repeated'] ?? null) === 'a') {
            $query->where('a_rows', '>', 1);
        } elseif (($filters['repeated'] ?? null) === 'b') {
            $query->where('b_rows', '>', 1);
        }
        if ($filters['changed'] ?? false) {
            $query->where(fn ($q) => $q->whereRaw('fields @> ?::jsonb', ['[{"status":"different"}]'])->orWhereRaw('fields @> ?::jsonb', ['[{"status":"partial"}]']));
        }
        if (isset($filters['search']) && $filters['search'] !== '') {
            $query->where(fn ($q) => $q->where('a_value', $filters['search'])->orWhere('b_value', $filters['search']));
        }

        $total = (clone $query)->count();
        $rows = $query->orderBy('position')->offset($page->offset())->limit($page->perPage)->get();

        return [
            'data' => $rows->map(fn (object $row) => [
                'identity' => $row->identity,
                'a_value' => $row->a_value,
                'b_value' => $row->b_value,
                'category' => $row->category,
                'explanation' => $row->explanation,
                'detail' => $row->detail === null ? null : $this->describe($row->explanation, json_decode($row->detail, true)),
                'a_rows' => (int) $row->a_rows,
                'b_rows' => (int) $row->b_rows,
                'fields' => $row->fields === null ? [] : json_decode($row->fields, true),
            ])->all(),
            'meta' => $page->meta($total),
        ];
    }

    public function rows(ComparisonRun $comparison, string $side, ?string $identity, bool $empty, string $state, Pagination $page): array
    {
        $this->ready($comparison);
        if (! in_array($side, ['a', 'b'], true)) {
            throw new DomainError('comparison.side_unknown', 'Escolha o lado a ou b.');
        }
        if (! in_array($state, self::STATES, true)) {
            throw new DomainError('comparison.state_unknown', 'Use selected, excluded ou all.');
        }
        if (! $empty && ($identity === null || $identity === '')) {
            throw new DomainError('comparison.identity_missing', 'Informe a identidade ou peça as linhas sem identificador.');
        }

        $basis = $comparison->sides[$side];
        $run = $comparison->sideRun($side) ?? throw new DomainError('comparison.side_missing', 'A execução deste lado não existe mais.', 404);
        $key = $basis['key'];

        $match = $empty
            ? '(sr."values"->>?) IS NULL OR btrim(sr."values"->>?) = \'\''
            : 'sr."values" @> jsonb_build_object(?::text, ?::text)';
        $matchBindings = $empty ? [$key, $key] : [$key, $identity];
        $having = match ($state) {
            'selected' => 'HAVING bool_or(t.result_no IS NOT NULL)',
            'excluded' => 'HAVING NOT bool_or(t.result_no IS NOT NULL)',
            default => '',
        };

        $base = "SELECT sr.id, sr.row_number, sr.line_number, sr.\"values\", bool_or(t.result_no IS NOT NULL) AS selected
            FROM source_rows sr
            JOIN run_tuple_sources s ON s.source_row_id = sr.id AND s.run_id = ? AND s.input_position = 0
            JOIN run_tuples t ON t.run_id = s.run_id AND t.tuple_no = s.tuple_no
            WHERE sr.dataset_version_id = ? AND ({$match})
            GROUP BY sr.id {$having}";
        $bindings = [$run->id, $basis['version']['id'], ...$matchBindings];

        $total = (int) DB::selectOne("SELECT count(*) AS n FROM ({$base}) c", $bindings)->n;
        $rows = DB::select("SELECT * FROM ({$base}) c ORDER BY c.row_number LIMIT ? OFFSET ?", [...$bindings, $page->perPage, $page->offset()]);

        $excludedIds = array_map(fn (object $row) => (int) $row->id, array_filter($rows, fn (object $row) => ! $row->selected));
        $exclusions = [];
        if ($excludedIds !== []) {
            $titles = collect($run->steps())->pluck('title', 'position');
            foreach (DB::select(
                "SELECT DISTINCT ON (s.source_row_id) s.source_row_id, t.end_step, t.exclusion_code, t.exclusion_detail FROM run_tuples t
                 JOIN run_tuple_sources s ON s.run_id = t.run_id AND s.tuple_no = t.tuple_no AND s.input_position = 0
                 WHERE t.run_id = ? AND t.fate = 'excluded' AND s.source_row_id IN (SELECT jsonb_array_elements_text(?::jsonb)::bigint)
                 ORDER BY s.source_row_id, t.tuple_no",
                [$run->id, json_encode(array_values($excludedIds))],
            ) as $row) {
                $detail = json_decode((string) $row->exclusion_detail, true) ?? [];
                $exclusions[(int) $row->source_row_id] = [
                    'step_position' => (int) $row->end_step,
                    'step_title' => $titles[(int) $row->end_step] ?? null,
                    'code' => $row->exclusion_code,
                    'label' => Explainer::codeLabel((string) $row->exclusion_code),
                    'explanation' => Explainer::exclusion($row->exclusion_code, $detail),
                ];
            }
        }

        return [
            'data' => array_map(fn (object $row) => DatasetPresenter::row($row) + [
                'state' => $row->selected ? 'selected' : 'excluded',
                'exclusion' => $row->selected ? null : ($exclusions[(int) $row->id] ?? null),
            ], $rows),
            'meta' => $page->meta($total) + [
                'side' => $side,
                'label' => $basis['label'],
                'dataset' => $basis['dataset'],
                'version' => $basis['version'],
                'key' => $key,
                'identity' => $empty ? null : $identity,
                'run_id' => $run->id,
            ],
        ];
    }

    private function describe(?string $explanation, array $detail): array
    {
        if ($explanation !== 'excluded_in_other') {
            return $detail;
        }

        return ['by' => array_map(fn (array $entry) => $entry + ['label' => Explainer::codeLabel($entry['code'])], $detail['by'] ?? [])];
    }

    private function ready(ComparisonRun $comparison): void
    {
        if ($comparison->status !== ComparisonRun::SUCCEEDED) {
            throw new DomainError('comparison.not_ready', 'Esta comparação ainda não terminou com sucesso.', 409, ['status' => $comparison->status]);
        }
    }
}
