<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PreviewTest extends TestCase
{
    use RefreshDatabase;

    private function datasets(string $token): array
    {
        return collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key')->all();
    }

    private function relation(string $token, string $from, string $to): array
    {
        return collect($this->api($token, 'GET', 'relationships')->json('data'))
            ->first(fn (array $r) => "{$r['from']['dataset_key']}.{$r['from']['column']}" === $from && "{$r['to']['dataset_key']}.{$r['to']['column']}" === $to);
    }

    private function runResults(string $token, array $run): array
    {
        return collect($this->api($token, 'GET', "runs/{$run['id']}/results?per_page=200")->json('data'))
            ->map(fn (array $row) => ['result_no' => $row['result_no'], 'values' => $row['values'], 'contributor_count' => $row['contributor_count']])
            ->all();
    }

    private function assertPreviewMatchesRun(string $token, array $recipe): array
    {
        $before = [DB::table('runs')->count(), DB::table('run_tuples')->count(), DB::table('run_diagnostics')->count()];
        $preview = $this->api($token, 'POST', "recipes/{$recipe['id']}/preview")->assertOk()->json('data');
        $this->assertSame($before, [DB::table('runs')->count(), DB::table('run_tuples')->count(), DB::table('run_diagnostics')->count()], 'a preview persists nothing');

        $this->assertTrue($preview['computed']);
        $this->assertSame(['preview', false], [$preview['kind'], $preview['traceable']]);
        $this->assertSame(['id' => $recipe['id'], 'revision' => $recipe['revision']], $preview['basis']['recipe']);

        $run = $this->runRecipe($token, $recipe['id']);
        $this->assertSame('succeeded', $run['status']);
        $this->assertEquals($this->runResults($token, $run), $preview['results']);
        $this->assertEquals($run['output_columns'], $preview['columns']);
        $this->assertEquals($run['totals'], $preview['totals']);
        $this->assertSame($run['tuple_count'], $preview['tuple_count']);
        $this->assertSame(array_column($run['inputs'], 'version_id'), array_column($preview['basis']['inputs'], 'version_id'));
        $this->assertSame(array_column($run['steps'], 'output_count'), array_column($preview['steps'], 'output_count'));

        return [$preview, $run];
    }

    public function test_preview_and_run_agree_on_the_meals_recipe(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $this->api($token, 'POST', "relationships/{$ids['relationship']['id']}/confirm")->assertOk();

        $this->assertPreviewMatchesRun($token, $this->api($token, 'GET', "recipes/{$ids['recipe']['id']}")->json('data'));
    }

    public function test_preview_and_run_agree_on_a_period_question_with_distinct_counts_and_an_accepted_multiplicity(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $datasets = $this->datasets($token);
        $this->api($token, 'PUT', "datasets/{$datasets['beneficiarios']['id']}/validity", [
            'start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => true,
        ])->assertOk();
        $link = $this->relation($token, 'atendimentos.beneficiario_id', 'beneficiarios.id');
        $this->api($token, 'POST', "relationships/{$link['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();

        $recipe = $this->createRecipe($token, $datasets['atendimentos']['id'], [
            ['type' => 'join', 'relationship_id' => $link['id'], 'join_type' => 'inner'],
            ['type' => 'filter', 'conditions' => [['kind' => 'validity', 'alias' => 'beneficiarios', 'reading' => 'active_at_end', 'from' => '2025-01-01', 'to' => '2025-12-31']]],
            ['type' => 'aggregate', 'group_by' => [['alias' => 'atendimentos', 'column' => 'cozinha_id']], 'measures' => [
                ['function' => 'count', 'name' => 'atendimentos'],
                ['function' => 'count_distinct', 'alias' => 'atendimentos', 'column' => 'beneficiario_id', 'name' => 'beneficiarios'],
                ['function' => 'sum', 'alias' => 'atendimentos', 'column' => 'refeicoes', 'name' => 'refeicoes'],
            ]],
        ]);

        [$preview] = $this->assertPreviewMatchesRun($token, $recipe);
        $this->assertLessThan($preview['totals']['sum_of_groups']['beneficiarios'], $preview['totals']['values']['beneficiarios'], 'people served by more than one kitchen count once in the total');
        $this->assertContains('join.multiplicity_accepted', array_column($preview['issues'], 'code'));
    }

    public function test_a_draft_can_be_previewed_without_being_saved(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $recipes = DB::table('recipes')->count();

        $preview = $this->api($token, 'POST', 'recipes/preview', [
            'base_dataset_id' => $ids['refeicoes']['id'],
            'steps' => [['type' => 'aggregate', 'group_by' => [['alias' => 'refeicoes', 'column' => 'cozinha_id']], 'measures' => [['function' => 'count_distinct', 'alias' => 'refeicoes', 'column' => 'data', 'name' => 'dias']]]],
        ])->assertOk()->json('data');

        $this->assertTrue($preview['computed']);
        $this->assertNull($preview['basis']['recipe']);
        $this->assertSame(118, $preview['steps'][0]['input_count']);
        $this->assertSame($recipes, DB::table('recipes')->count());
    }

    public function test_pending_decisions_are_listed_and_only_block_the_preview_when_they_change_the_result(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);

        $pending = $this->api($token, 'POST', "recipes/{$ids['recipe']['id']}/preview")->json('data');
        $this->assertTrue($pending['computed'], 'an unconfirmed relation with a unique target does not change the calculation');
        $this->assertSame(['join.relationship_unconfirmed'], array_column($pending['pending'], 'code'));
        $this->api($token, 'POST', "recipes/{$ids['recipe']['id']}/runs")->assertStatus(422);

        $this->api($token, 'POST', "relationships/{$ids['relationship']['id']}/reject")->assertOk();
        $rejected = $this->api($token, 'POST', "recipes/{$ids['recipe']['id']}/preview")->json('data');
        $this->assertSame([false, 'blocked'], [$rejected['computed'], $rejected['reason']]);

        [, $cadastro] = $this->workspace(true, 'cadastro');
        $datasets = $this->datasets($cadastro);
        $link = $this->relation($cadastro, 'atendimentos.beneficiario_id', 'beneficiarios.id');
        $draft = $this->api($cadastro, 'POST', 'recipes/preview', [
            'base_dataset_id' => $datasets['atendimentos']['id'],
            'steps' => [['type' => 'join', 'relationship_id' => $link['id']]],
        ])->json('data');
        $this->assertSame([false, 'blocked'], [$draft['computed'], $draft['reason']]);
        $this->assertFalse($draft['pending'][0]['details']['target_unique']);
    }

    public function test_new_versions_change_previews_while_old_runs_keep_their_versions(): void
    {
        [, $token] = $this->workspace(false);
        $sales = $this->upload($token, 'vendas.csv', "id,loja,valor\nv1,a,10\nv2,b,5\n")->json('data');
        $recipe = $this->createRecipe($token, $sales['id'], [
            ['type' => 'aggregate', 'group_by' => [['alias' => 'vendas', 'column' => 'loja']], 'measures' => [['function' => 'sum', 'alias' => 'vendas', 'column' => 'valor', 'name' => 'total']]],
        ]);
        $first = $this->runRecipe($token, $recipe['id']);

        $this->upload($token, 'vendas.csv', "id,loja,valor\nv1,a,10\nv2,b,5\nv3,a,7\n", $sales['id'])->assertCreated();
        $preview = $this->api($token, 'POST', "recipes/{$recipe['id']}/preview")->json('data');

        $this->assertEquals(['total' => '22'], $preview['totals']['values']);
        $this->assertSame(2, $preview['basis']['inputs'][0]['version_number']);
        $old = $this->api($token, 'GET', "runs/{$first['id']}")->json('data');
        $this->assertEquals(['total' => '15'], $old['totals']['values']);
        $this->assertSame(1, $old['inputs'][0]['version_number']);
        $this->assertTrue($old['inputs'][0]['newer_version_available']);

        $this->assertPreviewMatchesRun($token, $recipe);
    }
}
