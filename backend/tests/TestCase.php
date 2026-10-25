<?php

namespace Tests;

use App\Modules\Workspaces\DemoScenarios;
use App\Modules\Workspaces\Http\ResolveWorkspace;
use App\Modules\Workspaces\Workspace;
use App\Modules\Workspaces\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function workspace(bool $withDemo = true, string $scenario = DemoScenarios::DEFAULT): array
    {
        [$workspace, $token] = app(WorkspaceProvisioner::class)->create($withDemo, $scenario);

        return [$workspace, $token];
    }

    protected function api(string $token, string $method, string $uri, array $data = []): TestResponse
    {
        return $this->withHeaders([ResolveWorkspace::HEADER => $token, 'Accept' => 'application/json'])
            ->json($method, '/api/v1/'.ltrim($uri, '/'), $data);
    }

    protected function upload(string $token, string $filename, string $content, ?string $datasetId = null, array $extra = []): TestResponse
    {
        $file = UploadedFile::fake()->createWithContent($filename, $content);
        $uri = $datasetId === null ? '/api/v1/datasets' : "/api/v1/datasets/{$datasetId}/versions";

        return $this->withHeaders([ResolveWorkspace::HEADER => $token, 'Accept' => 'application/json'])
            ->post($uri, ['file' => $file] + $extra);
    }

    protected function demoIds(string $token): array
    {
        $datasets = collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key');
        $relationship = $this->api($token, 'GET', 'relationships')->json('data.0');
        $recipe = $this->api($token, 'GET', 'recipes')->json('data.0');

        return [
            'cozinhas' => $datasets['cozinhas'],
            'refeicoes' => $datasets['refeicoes'],
            'relationship' => $relationship,
            'recipe' => $recipe,
        ];
    }

    protected function runDemo(string $token): array
    {
        $ids = $this->demoIds($token);
        $this->api($token, 'POST', "relationships/{$ids['relationship']['id']}/confirm")->assertOk();

        return $this->runRecipe($token, $ids['recipe']['id']);
    }

    protected function runRecipe(string $token, string $recipeId): array
    {
        $created = $this->api($token, 'POST', "recipes/{$recipeId}/runs")->assertStatus(202)->json('data');

        return $this->api($token, 'GET', "runs/{$created['id']}")->assertOk()->json('data');
    }

    protected function createRecipe(string $token, string $baseDatasetId, array $steps, string $name = 'Receita de teste'): array
    {
        return $this->api($token, 'POST', 'recipes', [
            'name' => $name,
            'base_dataset_id' => $baseDatasetId,
            'steps' => $steps,
        ])->assertCreated()->json('data');
    }

    protected function findRow(string $token, string $runId, string $alias, string $column, string $value): int
    {
        return (int) $this->api($token, 'GET', "runs/{$runId}/rows?alias={$alias}&column={$column}&value=".urlencode($value))
            ->assertOk()
            ->json('data.0.id');
    }

    protected function resultsByKey(string $token, string $runId, string $key): array
    {
        return collect($this->api($token, 'GET', "runs/{$runId}/results?per_page=200")->assertOk()->json('data'))
            ->keyBy(fn (array $row) => $row['values'][$key] ?? '∅')
            ->all();
    }

    protected function workspaceModel(string $token): Workspace
    {
        return Workspace::query()->where('token_hash', Workspace::hashToken($token))->firstOrFail();
    }
}
