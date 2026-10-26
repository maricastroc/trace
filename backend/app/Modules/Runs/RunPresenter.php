<?php

namespace App\Modules\Runs;

use App\Modules\Recipes\Decisions;

final class RunPresenter
{
    public static function summary(Run $run): array
    {
        return [
            'id' => $run->id,
            'status' => $run->status,
            'recipe_id' => $run->recipe_id,
            'recipe_name' => $run->recipe_snapshot['recipe']['name'] ?? null,
            'recipe_revision' => $run->recipe_revision,
            'result_count' => $run->result_count,
            'tuple_count' => $run->tuple_count,
            'error' => $run->error,
            'queued_at' => $run->queued_at?->toIso8601String(),
            'started_at' => $run->started_at?->toIso8601String(),
            'finished_at' => $run->finished_at?->toIso8601String(),
            'duration_ms' => $run->duration_ms,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $decisions
     * @param  list<array{kind: string, position: int|null, message: string}>  $decisionChanges
     */
    public static function detail(Run $run, array $steps, array $inputs, ?int $currentRevision, array $latestVersions, array $decisions, array $decisionChanges): array
    {
        $recipeDeleted = $run->recipe_id === null && ($run->recipe_snapshot['recipe'] ?? null) !== null;

        return self::summary($run) + [
            'recipe' => $run->recipe_snapshot['recipe'],
            'current_recipe_revision' => $currentRevision,
            'recipe_deleted' => $recipeDeleted,
            'recipe_changed_since' => $recipeDeleted || ($currentRevision !== null && $currentRevision !== $run->recipe_revision),
            'decisions' => $decisions,
            'decisions_key' => Decisions::key($decisions),
            'decision_changes' => $decisionChanges,
            'interpretation' => Interpretation::of($run),
            'inputs' => array_map(fn (array $input) => $input + [
                'latest_version_number' => $latestVersions[$input['dataset_id']] ?? null,
                'newer_version_available' => isset($latestVersions[$input['dataset_id']]) && $latestVersions[$input['dataset_id']] > $input['version_number'],
            ], $inputs),
            'steps' => $steps,
            'output_columns' => $run->output_columns,
            'totals' => $run->totals,
        ];
    }
}
