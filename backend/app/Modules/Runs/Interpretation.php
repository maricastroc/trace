<?php

namespace App\Modules\Runs;

use App\Modules\Questions\ValidityCriteria;

final class Interpretation
{
    public const VERSION = 1;

    /**
     * @param  list<array<string, mixed>>  $steps  compiled steps
     * @return array{version: int, recorded_at: string, criteria: list<array<string, mixed>>}
     */
    public static function record(array $steps): array
    {
        return [
            'version' => self::VERSION,
            'recorded_at' => now()->toIso8601String(),
            'criteria' => self::criteria($steps),
        ];
    }

    /**
     * @return array{recorded: bool, version: int|null, recorded_at: string|null, criteria: list<array<string, mixed>>}
     */
    public static function of(Run $run): array
    {
        $stored = $run->recipe_snapshot['interpretation'] ?? null;

        if (is_array($stored)) {
            return ['recorded' => true, 'version' => $stored['version'] ?? null, 'recorded_at' => $stored['recorded_at'] ?? null, 'criteria' => $stored['criteria'] ?? []];
        }

        return ['recorded' => false, 'version' => null, 'recorded_at' => null, 'criteria' => self::criteria($run->steps())];
    }

    /**
     * @param  list<array<string, mixed>>  $steps
     * @return list<array<string, mixed>>
     */
    private static function criteria(array $steps): array
    {
        $criteria = [];

        foreach ($steps as $step) {
            if ($step['type'] !== 'filter') {
                continue;
            }

            foreach ($step['conditions'] as $condition) {
                if (($condition['kind'] ?? null) !== 'validity' || ! isset($condition['start_column'])) {
                    continue;
                }

                $criteria[] = [
                    'position' => $step['position'],
                    'alias' => $condition['alias'],
                    'reading' => $condition['reading'],
                    'from' => $condition['from'],
                    'to' => $condition['to'],
                    'start_column' => $condition['start_column'],
                    'end_column' => $condition['end_column'] ?? null,
                    'end_inclusive' => $condition['end_inclusive'] ?? true,
                ] + ValidityCriteria::describe($condition['reading'], $condition['from'], $condition['to'], [
                    'start_column' => $condition['start_column'],
                    'end_column' => $condition['end_column'] ?? null,
                    'end_inclusive' => $condition['end_inclusive'] ?? true,
                ]);
            }
        }

        return $criteria;
    }
}
