<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ReproducibilityTest extends TestCase
{
    use RefreshDatabase;

    private function fingerprint(string $runId): array
    {
        return [
            'results' => DB::table('run_result_rows')->where('run_id', $runId)->orderBy('result_no')->get(['result_no', 'values', 'contributor_count'])
                ->map(fn ($r) => [$r->result_no, json_decode($r->values, true), $r->contributor_count])->all(),
            'tuples' => DB::table('run_tuples')->where('run_id', $runId)->orderBy('tuple_no')
                ->get(['tuple_no', 'parent_no', 'born_step', 'end_step', 'fate', 'exclusion_code', 'result_no'])
                ->map(fn ($t) => (array) $t)->all(),
            'sources' => DB::table('run_tuple_sources')->where('run_id', $runId)->orderBy('tuple_no')->orderBy('input_position')
                ->get(['tuple_no', 'input_position', 'source_row_id'])->map(fn ($s) => (array) $s)->all(),
            'diagnostics' => DB::table('run_diagnostics')->where('run_id', $runId)->orderBy('id')
                ->get(['step_position', 'code', 'source_row_id', 'tuple_no'])->map(fn ($d) => (array) $d)->all(),
            'steps' => DB::table('run_steps')->where('run_id', $runId)->orderBy('position')
                ->get(['position', 'input_count', 'output_count', 'excluded_count'])->map(fn ($s) => (array) $s)->all(),
        ];
    }

    public function test_running_the_same_recipe_twice_produces_identical_results_and_lineage(): void
    {
        [, $token] = $this->workspace();
        $first = $this->runDemo($token);
        $second = $this->runRecipe($token, $this->demoIds($token)['recipe']['id']);

        $this->assertNotSame($first['id'], $second['id']);
        $this->assertSame($this->fingerprint($first['id']), $this->fingerprint($second['id']));
    }

    public function test_changing_the_recipe_does_not_alter_previous_runs(): void
    {
        [, $token] = $this->workspace();
        $before = $this->runDemo($token);
        $fingerprint = $this->fingerprint($before['id']);
        $recipe = $this->demoIds($token)['recipe'];

        $steps = $recipe['definition']['steps'];
        $steps[0]['conditions'][0]['value'] = ['2026-10-01', '2026-10-31'];
        $this->api($token, 'PUT', "recipes/{$recipe['id']}", [
            'name' => $recipe['name'], 'base_dataset_id' => $recipe['definition']['base_dataset_id'], 'steps' => $steps,
        ])->assertOk()->assertJsonPath('data.revision', 2);

        $after = $this->runRecipe($token, $recipe['id']);
        $old = $this->api($token, 'GET', "runs/{$before['id']}")->json('data');

        $this->assertSame(1, $old['recipe_revision']);
        $this->assertTrue($old['recipe_changed_since']);
        $this->assertStringContainsString('2026-09-01', $old['steps'][0]['summary']);
        $this->assertStringContainsString('01/09/2026', $old['steps'][0]['plain']['headline'], 'the old run keeps the period it was described with');
        $this->assertStringContainsString('01/10/2026', $after['steps'][0]['plain']['headline']);
        $this->assertSame($fingerprint, $this->fingerprint($before['id']));
        $this->assertStringContainsString('2026-10-01', $after['steps'][0]['summary']);
        $this->assertNotSame($fingerprint['results'], $this->fingerprint($after['id'])['results']);
    }

    public function test_new_dataset_version_does_not_alter_previous_runs(): void
    {
        [, $token] = $this->workspace();
        $before = $this->runDemo($token);
        $fingerprint = $this->fingerprint($before['id']);
        $ids = $this->demoIds($token);
        $oldRowId = $this->findRow($token, $before['id'], 'refeicoes', 'id', '000032');

        $csv = file_get_contents(database_path('demo/refeicoes.csv'));
        $csv = preg_replace('/^000032,([^,]+),([^,]+),\d+$/m', '000032,$1,$2,9999', $csv);
        $this->upload($token, 'refeicoes-v2.csv', $csv, $ids['refeicoes']['id'])->assertCreated();

        $after = $this->runRecipe($token, $ids['recipe']['id']);
        $old = $this->api($token, 'GET', "runs/{$before['id']}")->json('data');

        $this->assertSame(1, $old['inputs'][0]['version_number']);
        $this->assertTrue($old['inputs'][0]['newer_version_available']);
        $this->assertSame(2, $after['inputs'][0]['version_number']);
        $this->assertSame($fingerprint, $this->fingerprint($before['id']));

        $oldFortaleza = $this->resultsByKey($token, $before['id'], 'municipio')['Fortaleza']['values']['total_refeicoes'];
        $newFortaleza = $this->resultsByKey($token, $after['id'], 'municipio')['Fortaleza']['values']['total_refeicoes'];
        $this->assertSame('3840', $oldFortaleza);
        $this->assertNotSame($oldFortaleza, $newFortaleza);

        $this->api($token, 'GET', "runs/{$before['id']}/rows/{$oldRowId}/journey")->assertOk()
            ->assertJsonPath('data.row.version_number', 1);

        $newRowId = $this->findRow($token, $after['id'], 'refeicoes', 'id', '000032');
        $this->api($token, 'GET', "runs/{$before['id']}/rows/{$newRowId}/journey")
            ->assertStatus(409)->assertJsonPath('code', 'row.version_mismatch');
    }

    public function test_runs_survive_recipe_deletion(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $recipeId = $this->demoIds($token)['recipe']['id'];

        $before = $this->api($token, 'GET', "runs/{$run['id']}")->assertOk()->json('data');
        $this->api($token, 'DELETE', "recipes/{$recipeId}")->assertNoContent();

        $kept = $this->api($token, 'GET', "runs/{$run['id']}")->assertOk()->json('data');
        $this->assertSame([$before['steps'], $before['decisions'], $before['interpretation'], $before['totals']], [$kept['steps'], $kept['decisions'], $kept['interpretation'], $kept['totals']], 'deleting the recipe changes nothing the run recorded');
        $this->assertNull($kept['recipe_id']);
        $this->assertSame('Refeições de setembro por município', $kept['recipe']['name']);
        $this->assertSame([true, true], [$kept['recipe_deleted'], $kept['recipe_changed_since']], 'a run whose recipe was deleted no longer reads as current');
        $this->api($token, 'GET', "runs/{$run['id']}/results")->assertOk()->assertJsonPath('meta.total', 5);
    }
}
