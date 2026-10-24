<?php

namespace Tests\Feature;

use App\Modules\Workspaces\Workspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class WorkspaceLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private const TABLES = [
        'datasets', 'dataset_versions', 'dataset_columns', 'source_rows', 'relationships', 'recipes',
        'runs', 'run_inputs', 'run_steps', 'run_result_rows', 'run_tuples', 'run_tuple_sources', 'run_diagnostics',
    ];

    private function counts(): array
    {
        return collect(self::TABLES)->mapWithKeys(fn (string $t) => [$t => DB::table($t)->count()])->all();
    }

    public function test_workspace_creation_returns_a_token_once_and_installs_the_synthetic_demo(): void
    {
        $response = $this->postJson('/api/v1/workspaces')->assertCreated()->json('data');

        $this->assertMatchesRegularExpression('/^trw_[A-Za-z0-9]{48}$/', $response['token']);
        $this->assertSame(['datasets' => 2, 'relationships' => 1, 'recipes' => 1, 'runs' => 0], $response['counts']);
        $this->assertNotSame($response['token'], Workspace::query()->value('token_hash'));

        $datasets = $this->api($response['token'], 'GET', 'datasets')->json('data');
        $this->assertSame([true, true], array_column($datasets, 'is_synthetic'));
        $this->api($response['token'], 'GET', 'workspace')->assertOk()->assertJsonMissing(['token' => $response['token']]);
    }

    public function test_pruning_removes_inactive_workspaces_with_runs_lineage_and_files(): void
    {
        [$stale, $staleToken] = $this->workspace();
        $this->runDemo($staleToken);
        [$active, $activeToken] = $this->workspace();
        $this->runDemo($activeToken);

        $stalePaths = DB::table('dataset_versions')->join('datasets', 'datasets.id', '=', 'dataset_versions.dataset_id')
            ->where('datasets.workspace_id', $stale->id)->pluck('source_path')->all();
        $this->assertNotEmpty($stalePaths);
        Storage::disk('local')->assertExists($stalePaths);

        $before = $this->counts();
        Workspace::query()->whereKey($stale->id)->update(['last_active_at' => now()->subDays(31)]);
        Workspace::query()->whereKey($active->id)->update(['last_active_at' => now()->subDays(2)]);

        $this->artisan('trace:prune-workspaces')->assertSuccessful();

        $this->assertNull(Workspace::query()->find($stale->id));
        $this->assertNotNull(Workspace::query()->find($active->id));
        Storage::disk('local')->assertMissing($stalePaths);

        $after = $this->counts();
        foreach (self::TABLES as $table) {
            $this->assertSame(intdiv($before[$table], 2), $after[$table], "{$table} should keep only the active workspace rows");
        }
        $this->api($activeToken, 'GET', 'runs')->assertOk()->assertJsonPath('meta.total', 1);
        $this->api($staleToken, 'GET', 'datasets')->assertStatus(401);
    }
}
