<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FlowsTest extends TestCase
{
    use RefreshDatabase;

    public function test_aggregated_flows_match_the_per_result_endpoints(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $flows = $this->api($token, 'GET', "runs/{$run['id']}/flows")->assertOk()->json('data');

        $this->assertSame(5, $flows['total_results']);
        $this->assertNull($flows['others']);
        $this->assertSame(44, $flows['base_contributors']);
        $this->assertSame(array_column($flows['results'], 'contributor_count'), collect(array_column($flows['results'], 'contributor_count'))->sortDesc()->values()->all());

        foreach ($flows['results'] as $item) {
            $flow = $this->api($token, 'GET', "runs/{$run['id']}/flow?result={$item['result_no']}")->json('data');
            $this->assertSame($flow['result']['base_tuples'], $item['base_tuples']);
            $this->assertSame($flow['result']['trace'], $item['trace']);
            foreach ($flow['inputs'] as $input) {
                $this->assertSame($input['contributing_rows'], $item['contributing_rows'][(string) $input['position']] ?? 0);
            }

            $detail = $this->api($token, 'GET', "runs/{$run['id']}/results/{$item['result_no']}")->json('data');
            $expected = array_map(fn ($m) => ['step_position' => $m['step_position'], 'code' => $m['code'], 'count' => $m['count']], $detail['related_exclusions']['matching']);
            $this->assertEquals($expected, $item['related_exclusions']);
        }
    }

    public function test_limit_merges_the_remaining_results_into_others(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $all = $this->api($token, 'GET', "runs/{$run['id']}/flows")->json('data.results');
        $flows = $this->api($token, 'GET', "runs/{$run['id']}/flows?limit=2")->json('data');

        $this->assertCount(2, $flows['results']);
        $rest = array_slice($all, 2);
        $this->assertEqualsCanonicalizing(array_column($rest, 'result_no'), $flows['others']['result_nos']);
        $this->assertSame(array_sum(array_column($rest, 'contributor_count')), $flows['others']['contributor_count']);
        foreach ($flows['others']['trace'] as $i => $point) {
            $this->assertSame(array_sum(array_map(fn ($r) => $r['trace'][$i]['output_count'], $rest)), $point['output_count']);
        }
    }

    public function test_steps_carry_plain_language_derived_from_the_snapshot(): void
    {
        [, $token] = $this->workspace();
        $run = $this->runDemo($token);
        $plain = array_column(array_column($run['steps'], 'plain'), 'headline');

        $this->assertSame([
            'Mantém refeições com data de 01/09/2026 a 30/09/2026',
            'Liga refeições a cozinhas por cozinha_id = id; quem não encontra par sai',
            'Mantém refeições de cozinhas com status “ativa”',
            'Soma quantidade por municipio e conta os registros',
        ], $plain);
        $this->assertSame('data fora de 01/09/2026 a 30/09/2026', $run['steps'][0]['plain']['drops']['condition_false']);
        $this->assertSame('sem par em cozinhas', $run['steps'][1]['plain']['drops']['no_match']);
        $this->assertSame('registros de refeições ligados a cozinhas', $run['steps'][1]['plain']['unit']);
        $this->assertSame('registros de refeições', $run['steps'][0]['plain']['input_unit']);

        $recipe = $this->demoIds($token)['recipe'];
        $this->assertSame($plain[0], $recipe['compiled']['steps'][0]['plain']['headline']);
    }

    public function test_flows_report_distinct_base_records_when_a_join_multiplies(): void
    {
        [, $token] = $this->workspace(false);
        $orders = $this->upload($token, 'pedidos.csv', "id,cliente_id,valor\np1,c1,10\np2,c2,5\n")->json('data');
        $clients = $this->upload($token, 'clientes.csv', "id,regiao\nc1,norte\nc1,sul\nc2,norte\n")->json('data');
        $relationship = $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $orders['id'], 'from_column' => 'cliente_id', 'to_dataset_id' => $clients['id'], 'to_column' => 'id',
        ])->json('data');
        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $recipe = $this->createRecipe($token, $orders['id'], [
            ['type' => 'join', 'relationship_id' => $relationship['id']],
            ['type' => 'aggregate', 'group_by' => [['alias' => 'clientes', 'column' => 'regiao']], 'measures' => [['function' => 'count', 'name' => 'n']]],
        ]);
        $run = $this->runRecipe($token, $recipe['id']);

        $flows = $this->api($token, 'GET', "runs/{$run['id']}/flows")->json('data');
        $this->assertSame(2, $flows['base_contributors']);
        $this->assertSame(3, array_sum(array_column($flows['results'], 'base_tuples')));
        $this->assertSame(1, $run['steps'][0]['stats']['multiplied_tuples']);
    }
}
