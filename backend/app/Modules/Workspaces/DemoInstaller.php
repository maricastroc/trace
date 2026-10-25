<?php

namespace App\Modules\Workspaces;

use App\Modules\Datasets\DatasetVersion;
use App\Modules\Datasets\Import\CsvImporter;
use App\Modules\Recipes\RecipeCompiler;
use App\Modules\Relationships\Relationship;
use App\Modules\Relationships\RelationshipDiscovery;
use Illuminate\Support\Facades\DB;

final class DemoInstaller
{
    public const RECIPE_NAME = 'Refeições de setembro por município';

    public function __construct(
        private readonly CsvImporter $importer,
        private readonly RelationshipDiscovery $discovery,
        private readonly RecipeCompiler $compiler,
    ) {}

    public function install(Workspace $workspace, string $scenario = DemoScenarios::DEFAULT): void
    {
        DB::transaction(function () use ($workspace, $scenario) {
            $versions = $this->importDatasets($workspace, $scenario);

            if ($scenario === 'refeicoes') {
                $this->installMealsRecipe($workspace, $versions['cozinhas'], $versions['refeicoes']);

                return;
            }

            $this->discovery->discover($workspace);
        });
    }

    /**
     * @return array<string, DatasetVersion>
     */
    private function importDatasets(Workspace $workspace, string $scenario): array
    {
        $path = config('trace.demo_path');
        $versions = [];

        foreach (DemoScenarios::all()[$scenario]['datasets'] as $dataset) {
            $versions[$dataset['key']] = $this->importer->importFile($workspace, "{$path}/{$dataset['file']}", basename($dataset['file']), null, [
                'key' => $dataset['key'],
                'name' => $dataset['name'],
                'origin' => 'demo',
                'is_synthetic' => true,
            ]);
        }

        return $versions;
    }

    private function installMealsRecipe(Workspace $workspace, DatasetVersion $cozinhas, DatasetVersion $refeicoes): void
    {
        $relationship = $this->discovery->discover($workspace)->first(
            fn (Relationship $r) => $r->from_dataset_id === $refeicoes->dataset_id
                && $r->from_column === 'cozinha_id'
                && $r->to_dataset_id === $cozinhas->dataset_id
                && $r->to_column === 'id',
        );

        $steps = [
            ['id' => 'setembro', 'type' => 'filter', 'conditions' => [
                ['alias' => 'refeicoes', 'column' => 'data', 'operator' => 'between', 'value' => ['2026-09-01', '2026-09-30'], 'value_type' => 'date'],
            ]],
            ['id' => 'cozinhas', 'type' => 'join', 'relationship_id' => $relationship?->id, 'join_type' => 'inner'],
            ['id' => 'ativas', 'type' => 'filter', 'conditions' => [
                ['alias' => 'cozinhas', 'column' => 'status', 'operator' => 'eq', 'value' => 'ativa', 'value_type' => 'text'],
            ]],
            ['id' => 'por_municipio', 'type' => 'aggregate', 'group_by' => [
                ['alias' => 'cozinhas', 'column' => 'municipio'],
            ], 'measures' => [
                ['function' => 'sum', 'alias' => 'refeicoes', 'column' => 'quantidade', 'name' => 'total_refeicoes'],
                ['function' => 'count', 'name' => 'registros'],
            ]],
        ];

        $compiled = $this->compiler->compile($workspace, $refeicoes->dataset_id, $steps);

        $workspace->recipes()->create([
            'name' => self::RECIPE_NAME,
            'description' => 'Mantém refeições de setembro, relaciona cada uma à sua cozinha, mantém apenas cozinhas ativas e soma as refeições por município.',
            'base_dataset_id' => $refeicoes->dataset_id,
            'steps' => $compiled->isSavable() ? $compiled->storableSteps() : $steps,
            'revision' => 1,
        ]);
    }
}
