<?php

namespace App\Modules\Runs;

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

    public static function detail(Run $run, array $steps, array $inputs, ?int $currentRevision, array $latestVersions): array
    {
        return self::summary($run) + [
            'recipe' => $run->recipe_snapshot['recipe'],
            'current_recipe_revision' => $currentRevision,
            'recipe_changed_since' => $currentRevision !== null && $currentRevision !== $run->recipe_revision,
            'inputs' => array_map(fn (array $input) => $input + [
                'latest_version_number' => $latestVersions[$input['dataset_id']] ?? null,
                'newer_version_available' => isset($latestVersions[$input['dataset_id']]) && $latestVersions[$input['dataset_id']] > $input['version_number'],
            ], $inputs),
            'steps' => $steps,
            'output_columns' => $run->output_columns,
        ];
    }
}
