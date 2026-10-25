<?php

namespace App\Modules\Recipes;

use App\Modules\Runs\Engine\ExecutionFailed;
use App\Modules\Runs\Engine\Pipeline;
use App\Modules\Workspaces\Workspace;

final class RecipePreview
{
    public function __construct(
        private readonly RecipeCompiler $compiler,
        private readonly Pipeline $pipeline,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(Workspace $workspace, mixed $baseDatasetId, mixed $steps, ?Recipe $recipe = null): array
    {
        $compiled = $this->compiler->compile($workspace, $baseDatasetId, $steps);
        $blockers = $compiled->blockers();
        $stopping = array_values(array_filter($blockers, fn (array $issue) => ! $this->allowsPreview($issue)));

        $payload = [
            'kind' => 'preview',
            'traceable' => false,
            'computed' => false,
            'reason' => null,
            'error' => null,
            'basis' => [
                'recipe' => $recipe === null ? null : ['id' => $recipe->id, 'revision' => $recipe->revision],
                'inputs' => array_map(
                    fn (array $input) => array_intersect_key($input, array_flip(['position', 'alias', 'dataset_id', 'dataset_name', 'version_id', 'version_number'])),
                    $compiled->inputs,
                ),
            ],
            'issues' => $compiled->issues,
            'pending' => array_values(array_filter($blockers, fn (array $issue) => $issue['severity'] === 'blocker')),
            'steps' => [],
            'columns' => null,
            'results' => [],
            'totals' => null,
            'tuple_count' => null,
            'computed_at' => now()->toIso8601String(),
        ];

        if ($stopping !== []) {
            return ['reason' => 'blocked'] + $payload;
        }

        if ($compiled->steps === []) {
            return ['reason' => 'empty'] + $payload;
        }

        try {
            $outcome = $this->pipeline->execute($compiled->snapshot($recipe));
        } catch (ExecutionFailed $failure) {
            return ['reason' => 'failed', 'error' => $failure->toArray()] + $payload;
        }

        $compiledSteps = collect($compiled->steps)->keyBy('position');

        return [
            'computed' => true,
            'steps' => array_map(fn (array $step) => [
                'position' => $step['position'],
                'type' => $step['type'],
                'title' => $compiledSteps[$step['position']]['title'] ?? null,
                'plain' => $compiledSteps[$step['position']]['plain'] ?? null,
                'input_count' => $step['input_count'],
                'output_count' => $step['output_count'],
                'excluded_count' => $step['excluded_count'],
                'stats' => $step['stats'],
            ], $outcome->steps),
            'columns' => $outcome->columns,
            'results' => $outcome->results,
            'totals' => $outcome->totals,
            'tuple_count' => $outcome->tuples->count(),
        ] + $payload;
    }

    private function allowsPreview(array $issue): bool
    {
        $details = (array) $issue['details'];

        return $issue['code'] === 'join.relationship_unconfirmed' && ($details['target_unique'] ?? false) === true;
    }
}
