<?php

namespace App\Modules\Recipes;

final class CompiledRecipe
{
    public function __construct(
        public readonly ?string $baseDatasetId,
        public readonly array $inputs,
        public readonly array $steps,
        public readonly array $issues,
    ) {}

    public function errors(): array
    {
        return array_values(array_filter($this->issues, fn (array $issue) => $issue['severity'] === 'error'));
    }

    public function blockers(): array
    {
        return array_values(array_filter($this->issues, fn (array $issue) => in_array($issue['severity'], ['error', 'blocker'], true)));
    }

    public function isSavable(): bool
    {
        return $this->errors() === [];
    }

    public function isRunnable(): bool
    {
        return $this->blockers() === [];
    }

    public function storableSteps(): array
    {
        return array_map(function (array $step) {
            return match ($step['type']) {
                'filter' => ['id' => $step['id'], 'type' => 'filter', 'conditions' => array_map(
                    fn (array $c) => array_intersect_key($c, array_flip(['alias', 'column', 'operator', 'value', 'value_type'])),
                    $step['conditions'],
                )],
                'join' => ['id' => $step['id'], 'type' => 'join', 'relationship_id' => $step['relationship_id'], 'join_type' => $step['join_type']],
                'aggregate' => ['id' => $step['id'], 'type' => 'aggregate', 'group_by' => array_map(
                    fn (array $g) => ['alias' => $g['alias'], 'column' => $g['column']],
                    $step['group_by'],
                ), 'measures' => array_map(
                    fn (array $m) => array_intersect_key($m, array_flip(['function', 'alias', 'column', 'name'])),
                    $step['measures'],
                )],
                default => $step,
            };
        }, $this->steps);
    }

    public function snapshot(Recipe $recipe): array
    {
        return [
            'recipe' => ['id' => $recipe->id, 'name' => $recipe->name, 'revision' => $recipe->revision],
            'base_dataset_id' => $this->baseDatasetId,
            'inputs' => $this->inputs,
            'steps' => $this->steps,
        ];
    }
}
