<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RelationshipTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_suggestion_evidence_matches_the_data(): void
    {
        [, $token] = $this->workspace();
        $relationships = $this->api($token, 'GET', 'relationships')->assertOk()->json('data');

        $this->assertCount(1, $relationships);
        $r = $relationships[0];
        $this->assertSame('suggested', $r['status']);
        $this->assertSame(['refeicoes', 'cozinha_id'], [$r['from']['dataset_key'], $r['from']['column']]);
        $this->assertSame(['cozinhas', 'id'], [$r['to']['dataset_key'], $r['to']['column']]);
        $this->assertSame('many_to_one', $r['cardinality']);

        $m = $r['evidence']['match'];
        $this->assertSame([114, 3, 1, 0.9744], [$m['matched_rows'], $m['unmatched_rows'], $m['null_rows'], $m['match_ratio']]);
        $this->assertEqualsCanonicalizing(['0999', '187'], array_column($m['unmatched_samples'], 'value'));
        $this->assertEqualsCanonicalizing(['0189', '0196'], $r['evidence']['unreferenced']['samples']);
        $this->assertEquals([['value' => '187', 'candidate' => '0187', 'kind' => 'leading_zeros']], $r['evidence']['near_matches']);
        $this->assertTrue($r['evidence']['to']['unique']);
    }

    public function test_examine_lists_unmatched_rows_on_both_sides(): void
    {
        [, $token] = $this->workspace();
        $id = $this->api($token, 'GET', 'relationships')->json('data.0.id');

        $from = $this->api($token, 'GET', "relationships/{$id}/unmatched?side=from")->assertOk();
        $this->assertSame(3, $from->json('meta.total'));
        $this->assertEqualsCanonicalizing(['0999', '0999', '187'], array_column(array_column($from->json('data'), 'values'), 'cozinha_id'));

        $this->assertSame(1, $this->api($token, 'GET', "relationships/{$id}/unmatched?side=from_null")->json('meta.total'));

        $to = $this->api($token, 'GET', "relationships/{$id}/unmatched?side=to")->json('data');
        $this->assertEqualsCanonicalizing(['0189', '0196'], array_column(array_column($to, 'values'), 'id'));

        $this->api($token, 'GET', "relationships/{$id}/unmatched?side=x")->assertStatus(422);
    }

    public function test_confirm_reject_and_rediscovery_preserves_user_decisions(): void
    {
        [, $token] = $this->workspace();
        $id = $this->api($token, 'GET', 'relationships')->json('data.0.id');

        $this->api($token, 'POST', "relationships/{$id}/reject")->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->api($token, 'POST', 'relationships/discover')->assertOk();
        $this->assertSame('rejected', $this->api($token, 'GET', "relationships/{$id}")->json('data.status'));

        $confirmed = $this->api($token, 'POST', "relationships/{$id}/confirm")->assertOk()->json('data');
        $this->assertSame('confirmed', $confirmed['status']);
        $this->assertNotNull($confirmed['confirmed_at']);
    }

    public function test_duplicate_keys_are_never_suggested_but_can_be_evaluated_manually(): void
    {
        [, $token] = $this->workspace(false);
        $orders = $this->upload($token, 'pedidos.csv', "id,cliente_id,valor\np1,c1,10\np2,c1,20\np3,c2,5\n")->json('data');
        $clients = $this->upload($token, 'clientes.csv', "id,regiao\nc1,norte\nc1,sul\nc2,norte\n")->json('data');

        $this->assertSame([], $this->api($token, 'POST', 'relationships/discover')->json('data'));

        $manual = $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $orders['id'], 'from_column' => 'cliente_id',
            'to_dataset_id' => $clients['id'], 'to_column' => 'id',
        ])->assertCreated()->json('data');

        $this->assertSame('suggested', $manual['status']);
        $this->assertSame('many_to_many', $manual['cardinality']);
        $this->assertFalse($manual['evidence']['to']['unique']);
        $this->assertStringContainsString('multiplicar', collect($manual['evidence']['statements'])->firstWhere('kind', 'uniqueness')['text']);

        $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $orders['id'], 'from_column' => 'inexistente',
            'to_dataset_id' => $clients['id'], 'to_column' => 'id',
        ])->assertStatus(422)->assertJsonPath('code', 'relationship.column_missing');
    }
}
