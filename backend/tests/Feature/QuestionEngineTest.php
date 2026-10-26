<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class QuestionEngineTest extends TestCase
{
    use RefreshDatabase;

    private function datasets(string $token): array
    {
        return collect($this->api($token, 'GET', 'datasets')->json('data'))->keyBy('key')->all();
    }

    private function declare(string $token, string $datasetId, bool $inclusive = true): void
    {
        $this->api($token, 'PUT', "datasets/{$datasetId}/validity", [
            'start_column' => 'data_cadastro', 'end_column' => 'data_desligamento', 'end_inclusive' => $inclusive,
        ])->assertOk();
    }

    private function readingRecipe(string $token, string $baseId, string $reading): array
    {
        return $this->createRecipe($token, $baseId, [
            ['type' => 'filter', 'conditions' => [['kind' => 'validity', 'alias' => 'beneficiarios', 'reading' => $reading, 'from' => '2025-01-01', 'to' => '2025-12-31']]],
            ['type' => 'aggregate', 'group_by' => [['alias' => 'beneficiarios', 'column' => 'cozinha_id']], 'measures' => [
                ['function' => 'count', 'name' => 'linhas'],
                ['function' => 'count_distinct', 'alias' => 'beneficiarios', 'column' => 'id', 'name' => 'beneficiarios'],
            ]],
        ], "Beneficiários {$reading}");
    }

    public function test_validity_is_declared_explicitly_and_only_with_date_columns(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $beneficiaries = $this->datasets($token)['beneficiarios'];
        $this->assertNull($beneficiaries['validity']);

        $this->api($token, 'PUT', "datasets/{$beneficiaries['id']}/validity", ['start_column' => 'nome', 'end_inclusive' => true])
            ->assertStatus(422)->assertJsonPath('code', 'dataset.validity_not_date');
        $this->api($token, 'PUT', "datasets/{$beneficiaries['id']}/validity", ['start_column' => 'nao_existe', 'end_inclusive' => true])
            ->assertStatus(422)->assertJsonPath('code', 'dataset.column_unknown');
        $this->api($token, 'PUT', "datasets/{$beneficiaries['id']}/validity", ['start_column' => 'data_cadastro'])->assertStatus(422);

        $this->declare($token, $beneficiaries['id']);
        $this->assertSame(
            ['data_cadastro', 'data_desligamento', true],
            array_values(array_intersect_key($this->datasets($token)['beneficiarios']['validity'], array_flip(['start_column', 'end_column', 'end_inclusive']))),
        );

        $this->api($token, 'DELETE', "datasets/{$beneficiaries['id']}/validity")->assertOk();
        $this->assertNull($this->datasets($token)['beneficiarios']['validity']);
    }

    public function test_a_period_question_waits_for_the_validity_declaration(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $beneficiaries = $this->datasets($token)['beneficiarios'];
        $recipe = $this->readingRecipe($token, $beneficiaries['id'], 'active_any');

        $this->assertFalse($recipe['compiled']['runnable']);
        $this->assertSame('validity.undeclared', $recipe['compiled']['issues'][0]['code']);

        $preview = $this->api($token, 'POST', "recipes/{$recipe['id']}/preview")->assertOk()->json('data');
        $this->assertFalse($preview['computed']);
        $this->assertSame('blocked', $preview['reason']);
        $this->assertSame(['validity.undeclared'], array_column($preview['pending'], 'code'));

        $this->declare($token, $beneficiaries['id']);
        $this->assertTrue($this->api($token, 'GET', "recipes/{$recipe['id']}")->json('data.compiled.runnable'));
        $this->assertEquals(
            ['kind' => 'validity', 'alias' => 'beneficiarios', 'reading' => 'active_any', 'from' => '2025-01-01', 'to' => '2025-12-31'],
            $this->api($token, 'GET', "recipes/{$recipe['id']}")->json('data.definition.steps.0.conditions.0'),
        );
    }

    public function test_each_reading_matches_an_independent_application_of_the_documented_rule(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $beneficiaries = $this->datasets($token)['beneficiarios'];
        $this->declare($token, $beneficiaries['id']);

        $rows = DB::table('source_rows')->where('dataset_version_id', $beneficiaries['latest_version']['id'])->pluck('values')
            ->map(fn (string $json) => json_decode($json, true));
        $rules = [
            'started' => fn (array $r) => $r['data_cadastro'] >= '2025-01-01' && $r['data_cadastro'] <= '2025-12-31',
            'active_any' => fn (array $r) => $r['data_cadastro'] <= '2025-12-31' && ($r['data_desligamento'] === null || $r['data_desligamento'] >= '2025-01-01'),
            'active_at_end' => fn (array $r) => $r['data_cadastro'] <= '2025-12-31' && ($r['data_desligamento'] === null || $r['data_desligamento'] >= '2025-12-31'),
        ];

        $seen = [];
        foreach ($rules as $reading => $rule) {
            $kept = $rows->filter($rule);
            $run = $this->runRecipe($token, $this->readingRecipe($token, $beneficiaries['id'], $reading)['id']);
            $this->assertSame('succeeded', $run['status']);

            $this->assertSame($kept->count(), $run['totals']['values']['linhas'], "{$reading}: rows");
            $this->assertSame($kept->pluck('id')->unique()->count(), $run['totals']['values']['beneficiarios'], "{$reading}: distinct ids");
            $this->assertSame($rows->count() - $kept->count(), $run['steps'][0]['excluded_count']);
            $seen[$reading] = $kept->count();
        }

        $this->assertGreaterThan($seen['active_at_end'], $seen['active_any'], 'some people left during 2025');
        $this->assertNotSame($seen['started'], $seen['active_any']);
    }

    public function test_exclusions_explain_the_reading_and_undetermined_rows_are_never_guessed(): void
    {
        [, $token] = $this->workspace(false);
        $people = $this->upload($token, 'pessoas.csv', implode("\n", [
            'id,grupo,inicio,fim',
            'p1,a,2024-03-01,',
            'p2,a,2024-03-01,2025-12-31',
            'p3,b,2024-03-01,2025-06-30',
            'p4,b,2026-02-01,',
            'p5,b,2023-01-01,2024-12-31',
            'p6,a,,2025-02-01',
            'p7,a,2025-05-10,2025-05-09',
        ])."\n")->json('data');
        $this->api($token, 'PUT', "datasets/{$people['id']}/validity", ['start_column' => 'inicio', 'end_column' => 'fim', 'end_inclusive' => false])->assertOk();

        $recipe = $this->createRecipe($token, $people['id'], [
            ['type' => 'filter', 'conditions' => [['kind' => 'validity', 'alias' => 'pessoas', 'reading' => 'active_at_end', 'from' => '01/01/2025', 'to' => '31/12/2025']]],
        ]);
        $run = $this->runRecipe($token, $recipe['id']);

        $this->assertSame(['validity_out' => 4, 'validity_undetermined' => 2], array_intersect_key($run['steps'][0]['stats']['excluded_by_reason'], array_flip(['validity_out', 'validity_undetermined'])));
        $this->assertSame(['p1'], array_column(array_column($this->api($token, 'GET', "runs/{$run['id']}/results")->json('data'), 'values'), 'pessoas.id'));

        $exclusions = collect($this->api($token, 'GET', "runs/{$run['id']}/exclusions?per_page=50")->json('data'))
            ->mapWithKeys(fn (array $e) => [$e['sources'][0]['row']['values']['id'] => [$e['code'], $e['explanation']]]);
        $this->assertSame('filter.validity_out', $exclusions['p2'][0]);
        $this->assertStringContainsString('terminou durante o período', $exclusions['p2'][1]);
        $this->assertStringContainsString('começou depois de 31/12/2025', $exclusions['p4'][1]);
        $this->assertStringContainsString('terminou até 01/01/2025, e o dia do fim não conta como vigente', $exclusions['p5'][1]);
        $this->assertSame('filter.validity_undetermined', $exclusions['p6'][0]);
        $this->assertStringContainsString('sem data de início', $exclusions['p6'][1]);
        $this->assertStringContainsString('fim é anterior à de início', $exclusions['p7'][1]);
    }

    public function test_distinct_counts_explain_repeated_identities_in_the_lineage(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $beneficiaries = $this->datasets($token)['beneficiarios'];
        $recipe = $this->createRecipe($token, $beneficiaries['id'], [
            ['type' => 'aggregate', 'group_by' => [['alias' => 'beneficiarios', 'column' => 'cozinha_id']], 'measures' => [
                ['function' => 'count', 'name' => 'linhas'],
                ['function' => 'count_distinct', 'alias' => 'beneficiarios', 'column' => 'id', 'name' => 'beneficiarios'],
            ]],
        ]);
        $run = $this->runRecipe($token, $recipe['id']);

        $this->assertEquals(['linhas' => 1248, 'beneficiarios' => 1242], $run['totals']['values']);
        $result = collect($this->api($token, 'GET', "runs/{$run['id']}/results?per_page=200")->json('data'))
            ->first(fn (array $row) => $row['values']['linhas'] !== $row['values']['beneficiarios']);
        $this->assertNotNull($result, 'a kitchen has repeated beneficiary ids');

        $identities = $this->api($token, 'GET', "runs/{$run['id']}/results/{$result['result_no']}/identities?measure=beneficiarios&per_page=5")->assertOk();
        $this->assertSame($result['values']['beneficiarios'], $identities->json('meta.distinct'));
        $this->assertSame($result['values']['linhas'], $identities->json('meta.rows'));
        $this->assertSame(2, $identities->json('data.0.tuples'));
        $repeatedId = $identities->json('data.0.value');

        $value = collect($this->api($token, 'GET', "runs/{$run['id']}/results/{$result['result_no']}")->json('data.values'))->firstWhere('key', 'beneficiarios');
        $this->assertTrue($value['consistent']);
        $this->assertSame($identities->json('meta.repeated'), $value['repeated']);
        $this->assertMatchesRegularExpression('/registros? repete(m)? um valor já contado/', $value['statement']);

        $statuses = collect();
        for ($page = 1; $page <= 10 && $statuses->where('id', $repeatedId)->count() < 2; $page++) {
            $statuses = $statuses->merge(collect($this->api($token, 'GET', "runs/{$run['id']}/results/{$result['result_no']}/contributors?input=0&per_page=200&page={$page}")->json('data'))
                ->map(fn (array $row) => ['id' => $row['values']['id'], 'status' => collect($row['measure_values'])->firstWhere('measure', 'beneficiarios')['status']]));
        }
        $this->assertSame(['counted', 'repeated'], $statuses->where('id', $repeatedId)->pluck('status')->values()->all());

        $this->api($token, 'GET', "runs/{$run['id']}/results/{$result['result_no']}/identities?measure=linhas")->assertStatus(422);
    }

    public function test_the_total_is_calculated_not_summed_when_an_identity_spans_groups(): void
    {
        [, $token] = $this->workspace(false);
        $visits = $this->upload($token, 'visitas.csv', "id,pessoa,unidade,valor\nv1,ana,norte,10\nv2,ana,sul,5\nv3,bia,norte,2\nv4,,sul,1\n")->json('data');
        $recipe = $this->createRecipe($token, $visits['id'], [
            ['type' => 'aggregate', 'group_by' => [['alias' => 'visitas', 'column' => 'unidade']], 'measures' => [
                ['function' => 'count_distinct', 'alias' => 'visitas', 'column' => 'pessoa', 'name' => 'pessoas'],
                ['function' => 'count', 'name' => 'visitas'],
                ['function' => 'sum', 'alias' => 'visitas', 'column' => 'valor', 'name' => 'total'],
            ]],
        ]);
        $run = $this->runRecipe($token, $recipe['id']);

        $this->assertEquals(['pessoas' => 2, 'visitas' => 4, 'total' => '18'], $run['totals']['values']);
        $this->assertEquals(['pessoas' => 3, 'visitas' => 4, 'total' => '18'], $run['totals']['sum_of_groups']);
        $this->assertSame(1, $run['steps'][0]['stats']['ignored_values']['pessoas']['null']);
        $this->assertSame(1, $this->api($token, 'GET', "runs/{$run['id']}/diagnostics?code=aggregate.distinct_null_ignored")->json('meta.total'));
    }
}
