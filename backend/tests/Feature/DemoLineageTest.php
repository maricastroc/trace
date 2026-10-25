<?php

namespace Tests\Feature;

use App\Modules\Datasets\Import\ValueParser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DemoLineageTest extends TestCase
{
    use RefreshDatabase;

    private function csv(string $name): array
    {
        $lines = array_map('str_getcsv', file(database_path("demo/{$name}.csv"), FILE_IGNORE_NEW_LINES));
        $header = array_shift($lines);

        return array_map(fn (array $line) => array_combine($header, array_map(fn ($v) => $v === '' ? null : $v, $line)), $lines);
    }

    private function expected(): array
    {
        $kitchens = array_column($this->csv('cozinhas'), null, 'id');
        $groups = [];
        foreach ($this->csv('refeicoes') as $meal) {
            $kitchen = $kitchens[$meal['cozinha_id'] ?? ''] ?? null;
            if ($meal['data'] < '2026-09-01' || $meal['data'] > '2026-09-30' || $kitchen === null || $kitchen['status'] !== 'ativa') {
                continue;
            }
            $group = &$groups[$kitchen['municipio']];
            $group['registros'] = ($group['registros'] ?? 0) + 1;
            $group['meals'][] = $meal['id'];
            $group['kitchens'][$kitchen['id']] = true;
            if (ValueParser::number($meal['quantidade']) !== null) {
                $group['total'] = ($group['total'] ?? 0) + (int) $meal['quantidade'];
            }
            unset($group);
        }

        return $groups;
    }

    public function test_results_match_an_independent_computation_from_the_csv_files(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);

        $this->assertSame('succeeded', $run['status']);
        $results = $this->resultsByKey($token, $run['id'], 'municipio');
        $expected = $this->expected();

        $this->assertEqualsCanonicalizing(array_keys($expected), array_keys($results));
        foreach ($expected as $municipio => $group) {
            $this->assertSame((string) $group['total'], $results[$municipio]['values']['total_refeicoes'], $municipio);
            $this->assertSame($group['registros'], $results[$municipio]['values']['registros'], $municipio);
        }

        $meals = $this->csv('refeicoes');
        $september = count(array_filter($meals, fn ($m) => str_starts_with($m['data'], '2026-09')));
        $steps = array_column($run['steps'], null, 'position');
        $this->assertSame([count($meals), $september, count($meals) - $september], [$steps[1]['input_count'], $steps[1]['output_count'], $steps[1]['excluded_count']]);
        $this->assertSame([$september, $september - 4, 4], [$steps[2]['input_count'], $steps[2]['output_count'], $steps[2]['excluded_count']]);
        $this->assertSame([$september - 4, 44, $september - 4 - 44], [$steps[3]['input_count'], $steps[3]['output_count'], $steps[3]['excluded_count']]);
        $this->assertSame([44, 5], [$steps[4]['input_count'], $steps[4]['output_count']]);
        $this->assertEquals(['alias' => 'refeicoes', 'column' => 'cozinha_id', 'input' => 0], $steps[2]['join']['probe']);
        $this->assertNull($steps[1]['join']);
    }

    public function test_fortaleza_total_traces_back_to_exactly_the_contributing_meals_and_kitchens(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $fortaleza = $this->resultsByKey($token, $run['id'], 'municipio')['Fortaleza'];
        $expected = $this->expected()['Fortaleza'];
        $base = "runs/{$run['id']}/results/{$fortaleza['result_no']}";

        $meals = [];
        $page = 1;
        do {
            $response = $this->api($token, 'GET', "{$base}/contributors?input=0&per_page=10&page={$page}")->assertOk();
            array_push($meals, ...array_column(array_column($response->json('data'), 'values'), 'id'));
            $page++;
        } while ($page <= $response->json('meta.last_page'));

        $this->assertEqualsCanonicalizing($expected['meals'], $meals);

        $kitchens = $this->api($token, 'GET', "{$base}/contributors?input=1")->json('data');
        $this->assertEqualsCanonicalizing(array_keys($expected['kitchens']), array_column(array_column($kitchens, 'values'), 'id'));

        $breakdown = $this->api($token, 'GET', "{$base}/breakdown?by=1")->json('data');
        $partials = array_map(fn ($row) => (int) $row['partials']['total_refeicoes'], $breakdown);
        $this->assertSame($expected['total'], array_sum($partials));

        $first = $breakdown[0];
        $drill = $this->api($token, 'GET', "{$base}/contributors?input=0&via_input=1&via_row={$first['id']}")->json('data');
        $this->assertCount($first['tuples'], $drill);
        $this->assertSame([$first['values']['id']], array_values(array_unique(array_column(array_column($drill, 'values'), 'cozinha_id'))));

        $detail = $this->api($token, 'GET', $base)->assertOk()->json('data');
        $this->assertSame([21, 21, 21, 21], array_column($detail['result']['trace'], 'input_count'));
        $this->assertSame([21, 4], array_column($detail['inputs'], 'contributing_rows'));
    }

    public function test_value_dependency_is_distinct_from_row_provenance(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $fortaleza = $this->resultsByKey($token, $run['id'], 'municipio')['Fortaleza'];
        $detail = $this->api($token, 'GET', "runs/{$run['id']}/results/{$fortaleza['result_no']}")->json('data');

        $sum = collect($detail['values'])->firstWhere('key', 'total_refeicoes');
        $this->assertTrue($sum['consistent']);
        $this->assertSame('3840', $sum['recomputed']);
        $this->assertSame(20, $sum['counted']);
        $this->assertSame(1, $sum['ignored_null']);
        $this->assertSame(21, $fortaleza['contributor_count'], 'the meal with empty quantity contributes to the group but not to the sum');

        $roles = [];
        foreach ($detail['fields'] as $input) {
            foreach ($input['columns'] as $column) {
                $roles["{$input['alias']}.{$column['key']}"] = array_column($column['roles'], 'kind');
            }
        }
        $this->assertSame([
            'refeicoes.id' => [],
            'refeicoes.cozinha_id' => ['join_key'],
            'refeicoes.data' => ['condition'],
            'refeicoes.quantidade' => ['value'],
            'cozinhas.id' => ['join_key'],
            'cozinhas.nome' => [],
            'cozinhas.municipio' => ['group'],
            'cozinhas.status' => ['condition'],
        ], $roles);

        $contributors = $this->api($token, 'GET', "runs/{$run['id']}/results/{$fortaleza['result_no']}/contributors?input=0&per_page=100")->json('data');
        $statuses = array_count_values(array_column(array_merge(...array_column($contributors, 'measure_values')), 'status'));
        $this->assertSame(['counted' => 20, 'ignored_null' => 1], $statuses);
    }

    public function test_journeys_explain_exclusions_and_unmatched_rows(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $journey = fn (string $alias, string $id) => $this->api($token, 'GET', "runs/{$run['id']}/rows/".$this->findRow($token, $run['id'], $alias, 'id', $id).'/journey')->assertOk()->json('data');

        $inactive = $journey('refeicoes', '000035');
        $this->assertSame('0187', $inactive['row']['values']['cozinha_id']);
        $this->assertSame(['passed', 'joined', 'excluded', 'not_reached'], array_column($inactive['paths'][0]['timeline'], 'status'));
        $this->assertSame('filter.condition_false', $inactive['paths'][0]['timeline'][2]['code']);
        $this->assertSame('inativa', $inactive['paths'][0]['timeline'][2]['detail']['actual']);
        $this->assertSame('0187', $inactive['paths'][0]['timeline'][1]['partner']['row']['values']['id']);

        $missing = $journey('refeicoes', '000065');
        $this->assertSame('join.no_match', $missing['paths'][0]['outcome']['code']);
        $this->assertStringContainsString('"0999"', $missing['summary']);

        $nearMiss = $journey('refeicoes', '000077');
        $this->assertSame('leading_zeros', $nearMiss['paths'][0]['timeline'][1]['detail']['near_match']['kind']);

        $august = $journey('refeicoes', '000001');
        $this->assertSame(1, $august['paths'][0]['outcome']['step_position']);

        $included = $journey('refeicoes', '000032');
        $this->assertSame('included', $included['paths'][0]['outcome']['status']);
        $this->assertSame('Fortaleza', $included['paths'][0]['outcome']['result_values']['municipio']);

        $kitchen = $journey('cozinhas', '0187');
        $this->assertCount(4, $kitchen['paths']);
        $this->assertStringContainsString('todas excluídas no passo 3', $kitchen['summary']);
        $this->assertTrue($kitchen['paths'][0]['timeline'][1]['subject_present']);
        $this->assertFalse($kitchen['paths'][0]['timeline'][0]['subject_present']);

        $unreferenced = $journey('cozinhas', '0189');
        $this->assertSame([], $unreferenced['paths']);
        $this->assertSame(0, $unreferenced['references']['referencing_rows']);
        $this->assertSame('join.right_unmatched', $unreferenced['diagnostics'][0]['code']);
    }

    public function test_kitchen_referenced_only_by_meals_filtered_out_earlier_is_explained(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $this->api($token, 'POST', "relationships/{$ids['relationship']['id']}/confirm");

        $steps = $ids['recipe']['definition']['steps'];
        $steps[0]['conditions'][0]['value'] = ['2026-10-01', '2026-10-31'];
        $recipe = $this->createRecipe($token, $ids['refeicoes']['id'], $steps, 'Outubro');
        $run = $this->runRecipe($token, $recipe['id']);

        $octoberKitchens = DB::table('source_rows')
            ->where('dataset_version_id', $ids['refeicoes']['latest_version']['id'])
            ->whereRaw("\"values\"->>'data' LIKE '2026-10-%'")
            ->selectRaw("\"values\"->>'cozinha_id' AS k")->pluck('k')->unique()->all();
        $kitchenWithoutOctober = collect($this->csv('cozinhas'))->pluck('id')
            ->diff($octoberKitchens)->diff(['0189', '0196'])->first();
        $this->assertNotNull($kitchenWithoutOctober, 'the demo data has a kitchen with meals only outside October');

        $rowId = $this->findRow($token, $run['id'], 'cozinhas', 'id', $kitchenWithoutOctober);
        $journey = $this->api($token, 'GET', "runs/{$run['id']}/rows/{$rowId}/journey")->json('data');

        $this->assertGreaterThan(0, $journey['references']['referencing_rows']);
        $this->assertSame(0, $journey['references']['reached_join']);
        $this->assertSame(1, $journey['references']['excluded_before'][0]['step_position']);
        $this->assertStringContainsString('antes da junção', $journey['summary']);
    }

    public function test_related_exclusions_for_a_group_are_reported_without_guessing(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $fortaleza = $this->resultsByKey($token, $run['id'], 'municipio')['Fortaleza'];

        $detail = $this->api($token, 'GET', "runs/{$run['id']}/results/{$fortaleza['result_no']}")->json('data');
        $this->assertSame([['step_position' => 3, 'code' => 'filter.condition_false', 'count' => 4]], array_map(
            fn ($r) => array_intersect_key($r, array_flip(['step_position', 'code', 'count'])),
            $detail['related_exclusions']['matching'],
        ));
        $this->assertSame([57, 4], array_column($detail['related_exclusions']['unattributable'], 'count'));

        $related = $this->api($token, 'GET', "runs/{$run['id']}/exclusions?result={$fortaleza['result_no']}")->json();
        $this->assertSame(4, $related['meta']['total']);
        foreach ($related['data'] as $exclusion) {
            $this->assertSame('0187', $exclusion['sources'][1]['row']['values']['id']);
        }
    }
}
