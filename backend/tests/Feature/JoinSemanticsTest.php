<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class JoinSemanticsTest extends TestCase
{
    use RefreshDatabase;

    private const ORDERS = "id,cliente_id,valor\np1,c1,10\np2,c1,20\np3,c2,5\np4,,7\np5,c9,3\np6,c2,n/d\np7,c2,\n";

    private const CLIENTS = "id,regiao\nc1,norte\nc1,sul\nc2,norte\nc3,leste\n,oeste\n";

    private function setUpJoin(string $joinType): array
    {
        [, $token] = $this->workspace(false);
        $orders = $this->upload($token, 'pedidos.csv', self::ORDERS)->json('data');
        $clients = $this->upload($token, 'clientes.csv', self::CLIENTS)->json('data');

        $relationship = $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $orders['id'], 'from_column' => 'cliente_id',
            'to_dataset_id' => $clients['id'], 'to_column' => 'id',
        ])->json('data');
        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm")->assertOk();

        $recipe = $this->createRecipe($token, $orders['id'], [
            ['type' => 'join', 'relationship_id' => $relationship['id'], 'join_type' => $joinType],
            ['type' => 'aggregate', 'group_by' => [['alias' => 'clientes', 'column' => 'regiao']], 'measures' => [
                ['function' => 'sum', 'alias' => 'pedidos', 'column' => 'valor', 'name' => 'total'],
                ['function' => 'count', 'name' => 'registros'],
            ]],
        ]);

        return [$token, $this->runRecipe($token, $recipe['id'])];
    }

    public function test_inner_join_with_duplicate_keys_multiplies_rows_and_lineage_proves_it(): void
    {
        [$token, $run] = $this->setUpJoin('inner');
        $this->assertSame('succeeded', $run['status']);

        $results = $this->resultsByKey($token, $run['id'], 'regiao');
        $this->assertSame(['norte', 'sul'], array_keys($results));
        $this->assertSame(['total' => '35', 'registros' => 5], array_intersect_key($results['norte']['values'], ['total' => 1, 'registros' => 1]));
        $this->assertSame(['total' => '30', 'registros' => 2], array_intersect_key($results['sul']['values'], ['total' => 1, 'registros' => 1]));

        $join = $run['steps'][0];
        $this->assertSame([7, 7, 2], [$join['input_count'], $join['output_count'], $join['excluded_count']]);
        $this->assertSame(2, $join['stats']['multiplied_tuples']);

        $diagnostics = $this->api($token, 'GET', "runs/{$run['id']}/diagnostics?per_page=100")->json('meta.summary');
        $counts = array_column($diagnostics, 'count', 'code');
        ksort($counts);
        $this->assertSame([
            'aggregate.null_ignored' => 1,
            'aggregate.unconvertible_ignored' => 1,
            'join.left_unmatched' => 1,
            'join.lookup_null_key' => 1,
            'join.multiple_matches' => 2,
            'join.null_key' => 1,
            'join.right_unmatched' => 1,
        ], $counts);

        $p1 = $this->api($token, 'GET', "runs/{$run['id']}/rows/".$this->findRow($token, $run['id'], 'pedidos', 'id', 'p1').'/journey')->json('data');
        $this->assertCount(2, $p1['paths']);
        $this->assertEqualsCanonicalizing(['norte', 'sul'], array_map(fn ($p) => $p['outcome']['result_values']['regiao'], $p1['paths']));
        $this->assertSame('join.multiple_matches', $p1['diagnostics'][0]['code']);
        $this->assertStringContainsString('multiplicado por 2', $p1['diagnostics'][0]['explanation']);

        $norteOrders = $this->api($token, 'GET', "runs/{$run['id']}/results/{$results['norte']['result_no']}/contributors?input=0")->json('data');
        $this->assertEqualsCanonicalizing(['p1', 'p2', 'p3', 'p6', 'p7'], array_column(array_column($norteOrders, 'values'), 'id'));

        $detail = $this->api($token, 'GET', "runs/{$run['id']}/results/{$results['norte']['result_no']}")->json('data');
        $sum = collect($detail['values'])->firstWhere('key', 'total');
        $this->assertTrue($sum['consistent']);
        $this->assertSame([3, 1, 1], [$sum['counted'], $sum['ignored_null'], $sum['ignored_unconvertible']]);
    }

    public function test_left_join_keeps_unmatched_and_null_keys_in_a_null_group(): void
    {
        [$token, $run] = $this->setUpJoin('left');

        $results = $this->api($token, 'GET', "runs/{$run['id']}/results")->json('data');
        $last = end($results);
        $this->assertNull($last['values']['regiao']);
        $this->assertSame('10', $last['values']['total']);
        $this->assertSame(2, $last['values']['registros']);
        $this->assertSame(0, $run['steps'][0]['excluded_count']);

        $p5 = $this->api($token, 'GET', "runs/{$run['id']}/rows/".$this->findRow($token, $run['id'], 'pedidos', 'id', 'p5').'/journey')->json('data');
        $this->assertSame('kept_unmatched', $p5['paths'][0]['timeline'][0]['status']);
        $this->assertSame('included', $p5['paths'][0]['outcome']['status']);

        $breakdown = $this->api($token, 'GET', "runs/{$run['id']}/results/{$last['result_no']}/breakdown?by=1")->json();
        $this->assertSame([], $breakdown['data']);
        $this->assertSame(2, $breakdown['meta']['tuples_without_input']);
    }

    public function test_lookup_row_with_null_key_is_reported_as_unreachable(): void
    {
        [$token, $run] = $this->setUpJoin('inner');
        $rows = $this->api($token, 'GET', "runs/{$run['id']}/diagnostics?code=join.lookup_null_key")->json('data');

        $this->assertSame('oeste', $rows[0]['row']['values']['regiao']);
        $journey = $this->api($token, 'GET', "runs/{$run['id']}/rows/{$rows[0]['row']['id']}/journey")->json('data');
        $this->assertSame([], $journey['paths']);
        $this->assertNull($journey['references']['key']);
    }
}
