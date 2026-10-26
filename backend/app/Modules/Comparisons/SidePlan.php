<?php

namespace App\Modules\Comparisons;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetVersion;
use App\Modules\Recipes\CompiledRecipe;
use App\Modules\Recipes\Decisions;
use App\Modules\Runs\Run;

final class SidePlan
{
    /**
     * @param  array<string, mixed>  $definition  normalized side definition
     * @param  array{start_column: string, end_column: string|null, end_inclusive: bool}|null  $validity
     * @param  list<string>  $fields
     */
    public function __construct(
        public readonly string $side,
        public readonly array $definition,
        public readonly Dataset $dataset,
        public readonly DatasetVersion $version,
        public readonly string $versionId,
        public readonly string $key,
        public readonly ?string $keyType,
        public readonly ?CompiledRecipe $compiled,
        public readonly ?Run $run,
        public readonly ?array $validity,
        public readonly array $fields,
    ) {}

    public function source(?string $sideRunId = null): SideSource
    {
        return new SideSource($this->versionId, $this->key, $this->validity, $this->fields, $this->basis($sideRunId));
    }

    public function kind(): string
    {
        return $this->definition['kind'];
    }

    public function period(): ?array
    {
        $period = $this->definition['period'] ?? null;

        return $period === null ? null : [$period['from'], $period['to']];
    }

    /**
     * @return array<string, mixed>
     */
    public function basis(?string $sideRunId = null): array
    {
        $steps = $this->compiled !== null
            ? array_map(fn (array $s) => ['position' => $s['position'], 'type' => $s['type'], 'summary' => $s['summary']], $this->compiled->steps)
            : array_map(fn (array $s) => ['position' => $s['position'], 'type' => $s['type'], 'summary' => $s['summary']], $this->run?->steps() ?? []);

        return [
            'kind' => $this->kind(),
            'label' => $this->definition['label'],
            'dataset' => ['id' => $this->dataset->id, 'key' => $this->dataset->key, 'name' => $this->dataset->name],
            'version' => ['id' => $this->version->id, 'number' => $this->version->number, 'rows' => $this->version->row_count],
            'key' => $this->key,
            'key_type' => $this->keyType,
            'run_id' => $this->run?->id ?? $sideRunId,
            'period' => $this->definition['period'] ?? null,
            'dimension' => $this->definition['dimension'] ?? null,
            'steps' => $steps,
            'decisions' => $decisions = $this->decisions(),
            'decisions_key' => Decisions::key($decisions),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function decisions(): array
    {
        $decisions = $this->compiled !== null
            ? Decisions::of($this->compiled->steps, $this->compiled->inputs)
            : Decisions::of($this->run?->steps() ?? [], $this->run?->inputs() ?? []);
        $decisions[] = Decisions::validity(null, $this->dataset->key, $this->dataset->id, $this->validity ?? []);

        return $decisions;
    }
}
