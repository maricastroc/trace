<?php

namespace App\Modules\Datasets;

use App\Modules\Workspaces\Workspace;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class DatasetEraser
{
    /**
     * @return array{versions: int, rows: int, files: int, relationships: int, recipes: int, runs: int, comparisons: int, comparison_runs: int}
     */
    public function dependents(Workspace $workspace, Dataset $dataset): array
    {
        $plan = $this->plan($workspace, $dataset);

        return [
            'versions' => $dataset->versions->count(),
            'rows' => (int) $dataset->versions->sum('row_count'),
            'files' => $dataset->versions->filter(fn (DatasetVersion $version) => Storage::disk('local')->exists($version->source_path))->count(),
            'relationships' => $plan['relationships']->count(),
            'recipes' => $plan['recipes']->count(),
            'runs' => $plan['runs']->count(),
            'comparisons' => $plan['comparisons']->count(),
            'comparison_runs' => $plan['comparison_runs']->count(),
        ];
    }

    public function hasHistory(Workspace $workspace, Dataset $dataset): bool
    {
        $dependents = $this->dependents($workspace, $dataset);

        return $dependents['runs'] + $dependents['recipes'] + $dependents['comparisons'] > 0;
    }

    /**
     * @return array{dataset: array{key: string, name: string}, removed: array<string, int>, erased_at: string}
     */
    public function erase(Workspace $workspace, Dataset $dataset): array
    {
        $removed = $this->dependents($workspace, $dataset);
        $plan = $this->plan($workspace, $dataset);
        $paths = $dataset->versions->pluck('source_path')->all();
        $versions = $dataset->versions->sortBy('number')->map(fn (DatasetVersion $version) => [
            'number' => $version->number,
            'row_count' => $version->row_count,
            'size_bytes' => $version->size_bytes,
            'checksum' => $version->checksum,
        ])->values()->all();
        $erasedAt = now();

        DB::transaction(function () use ($workspace, $dataset, $plan, $versions, $removed, $erasedAt): void {
            DB::table('comparisons')->whereIn('id', $plan['comparisons'])->delete();
            DB::table('comparison_runs')->whereIn('id', $plan['comparison_runs'])->delete();
            DB::table('runs')->whereIn('id', $plan['runs'])->delete();
            DB::table('recipes')->whereIn('id', $plan['recipes'])->delete();
            $dataset->delete();

            DB::table('dataset_erasures')->insert([
                'id' => (string) Str::ulid(),
                'workspace_id' => $workspace->id,
                'dataset_key' => $dataset->key,
                'dataset_name' => $dataset->name,
                'versions' => json_encode($versions),
                'removed' => json_encode($removed),
                'erased_at' => $erasedAt,
            ]);
        });

        Storage::disk('local')->delete($paths);
        $directory = "datasets/{$dataset->id}";
        if (Storage::disk('local')->allFiles($directory) === []) {
            Storage::disk('local')->deleteDirectory($directory);
        }

        return [
            'dataset' => ['key' => $dataset->key, 'name' => $dataset->name],
            'removed' => $removed,
            'erased_at' => $erasedAt->toIso8601String(),
        ];
    }

    /**
     * @return array{relationships: Collection<int, string>, recipes: Collection<int, string>, runs: Collection<int, string>, comparisons: Collection<int, string>, comparison_runs: Collection<int, string>}
     */
    private function plan(Workspace $workspace, Dataset $dataset): array
    {
        $relationships = $workspace->relationships()
            ->where(fn ($query) => $query->where('from_dataset_id', $dataset->id)->orWhere('to_dataset_id', $dataset->id))
            ->pluck('id');

        $recipes = $workspace->recipes()->get(['id', 'base_dataset_id', 'steps'])
            ->filter(fn ($recipe) => $recipe->base_dataset_id === $dataset->id
                || $relationships->contains(fn (string $id) => str_contains(json_encode($recipe->steps), $id)))
            ->pluck('id')
            ->values();

        $runs = DB::table('run_inputs')
            ->join('runs', 'runs.id', '=', 'run_inputs.run_id')
            ->where('runs.workspace_id', $workspace->id)
            ->where('run_inputs.dataset_id', $dataset->id)
            ->distinct()
            ->pluck('run_inputs.run_id');

        $comparisonRuns = $workspace->comparisonRuns()
            ->where(fn ($query) => $query
                ->whereIn('run_a_id', $runs)
                ->orWhereIn('run_b_id', $runs)
                ->orWhereRaw("sides->'a'->'dataset'->>'id' = ?", [$dataset->id])
                ->orWhereRaw("sides->'b'->'dataset'->>'id' = ?", [$dataset->id]))
            ->pluck('id');

        $comparisons = $workspace->comparisons()
            ->where(fn ($query) => $query
                ->whereRaw("spec->'a'->>'dataset_id' = ?", [$dataset->id])
                ->orWhereRaw("spec->'b'->>'dataset_id' = ?", [$dataset->id])
                ->orWhereIn('id', DB::table('comparison_runs')->whereIn('id', $comparisonRuns)->select('comparison_id')))
            ->pluck('id');

        return [
            'relationships' => $relationships,
            'recipes' => $recipes,
            'runs' => $runs,
            'comparisons' => $comparisons,
            'comparison_runs' => $comparisonRuns,
        ];
    }
}
