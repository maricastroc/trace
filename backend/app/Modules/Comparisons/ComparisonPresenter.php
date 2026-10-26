<?php

namespace App\Modules\Comparisons;

final class ComparisonPresenter
{
    /**
     * @param  array{a: list<array<string, mixed>>, b: list<array<string, mixed>>, equivalence: string|null}|null  $changes
     */
    public static function run(ComparisonRun $run, ?array $changes = null): array
    {
        $sides = [];
        foreach (['a', 'b'] as $side) {
            $sides[$side] = array_diff_key($run->sides[$side], array_flip(['validity', 'fields']));
        }

        return [
            'id' => $run->id,
            'kind' => 'run',
            'traceable' => true,
            'comparison_id' => $run->comparison_id,
            'status' => $run->status,
            'spec' => $run->spec,
            'sides' => $sides,
            'attribution' => $run->attribution,
            'equivalence' => $run->equivalence,
            'issues' => $run->issues,
            'changes' => $changes,
            'summary' => $run->summary,
            'error' => $run->error,
            'duration_ms' => $run->duration_ms,
            'queued_at' => $run->queued_at?->toIso8601String(),
            'started_at' => $run->started_at?->toIso8601String(),
            'finished_at' => $run->finished_at?->toIso8601String(),
        ];
    }

    public static function brief(ComparisonRun $run): array
    {
        $sides = [];
        foreach (['a', 'b'] as $side) {
            $basis = $run->sides[$side];
            $sides[$side] = [
                'label' => $basis['label'],
                'kind' => $basis['kind'],
                'dataset' => $basis['dataset'],
                'version' => $basis['version'],
                'key' => $basis['key'],
                'decisions_key' => $basis['decisions_key'] ?? null,
            ];
        }

        return [
            'id' => $run->id,
            'status' => $run->status,
            'rules' => $run->spec['rules'] ?? [],
            'equivalence' => $run->equivalence === null ? null : ['status' => $run->equivalence['status'], 'statement' => $run->equivalence['statement'], 'reading' => $run->equivalence['reading']['kind'] ?? null],
            'sides' => $sides,
            'summary' => $run->summary === null ? null : array_intersect_key($run->summary, array_flip(['a', 'b', 'shared', 'shared_by_rule', 'only_a', 'only_b', 'net_difference', 'unmatched'])),
            'queued_at' => $run->queued_at?->toIso8601String(),
            'finished_at' => $run->finished_at?->toIso8601String(),
        ];
    }

    public static function comparison(Comparison $comparison): array
    {
        $last = $comparison->runs()->first();

        return [
            'id' => $comparison->id,
            'name' => $comparison->name,
            'spec' => $comparison->spec,
            'spec_key' => $comparison->spec_key,
            'last_run' => $last === null ? null : self::brief($last),
            'runs' => $comparison->runs()->count(),
            'created_at' => $comparison->created_at?->toIso8601String(),
        ];
    }
}
