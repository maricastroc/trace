<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RelationshipPolicyTest extends TestCase
{
    use RefreshDatabase;

    private const ORDERS = "id,cliente_id,valor\np1,c1,10\np2,c1,20\np3,c2,5\np4,,7\np5,c9,3\np6,c2,4\np7,c2,1\n";

    private const CLIENTS = "id,regiao\nc1,norte\nc1,sul\nc2,norte\nc3,leste\n,oeste\n";

    private function orders(?string $clients = null): array
    {
        [, $token] = $this->workspace(false);
        $orders = $this->upload($token, 'pedidos.csv', self::ORDERS)->json('data');
        $clientsSet = $this->upload($token, 'clientes.csv', $clients ?? self::CLIENTS)->json('data');
        $relationship = $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $orders['id'], 'from_column' => 'cliente_id',
            'to_dataset_id' => $clientsSet['id'], 'to_column' => 'id',
        ])->assertCreated()->json('data');

        return [$token, $orders, $clientsSet, $relationship];
    }

    private function countRecipe(string $token, string $baseId, string $relationshipId, string $joinType): array
    {
        return $this->createRecipe($token, $baseId, [
            ['type' => 'join', 'relationship_id' => $relationshipId, 'join_type' => $joinType],
            ['type' => 'aggregate', 'group_by' => [['alias' => 'clientes', 'column' => 'regiao']], 'measures' => [['function' => 'count', 'name' => 'linhas']]],
        ], "Contagem {$joinType}");
    }

    public function test_a_repeated_target_cannot_be_confirmed_as_n_to_one(): void
    {
        [$token, , , $relationship] = $this->orders();

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm")
            ->assertStatus(422)
            ->assertJsonPath('code', 'relationship.multiplicity_requires_policy')
            ->assertJsonPath('details.duplicate_values', 1)
            ->assertJsonPath('details.extra_rows', 2);
        $this->assertSame('suggested', $this->api($token, 'GET', "relationships/{$relationship['id']}")->json('data.status'));

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'outra'])->assertStatus(422);

        $confirmed = $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk()->json('data');
        $this->assertSame(['confirmed', 'accept_multiplicity', 'caveat', true], [$confirmed['status'], $confirmed['policy'], $confirmed['standing']['key'], $confirmed['standing']['usable']]);

        $reopened = $this->api($token, 'POST', "relationships/{$relationship['id']}/reopen")->json('data');
        $this->assertNull($reopened['policy']);
    }

    public function test_a_unique_target_does_not_take_a_policy(): void
    {
        [$token, , , $relationship] = $this->orders("id,regiao\nc1,norte\nc2,sul\n");

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'relationship.policy_not_needed');
        $this->assertSame('confirmed', $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm")->json('data.standing.key'));
    }

    public function test_join_effect_matches_what_the_engine_produces_for_inner_and_left_joins(): void
    {
        [$token, $orders, , $relationship] = $this->orders();
        $effect = $relationship['evidence']['join_effect'];

        $this->assertSame([
            'source_rows' => 7, 'matched_rows' => 5, 'unmatched_rows' => 1, 'null_key_rows' => 1,
            'inner_rows' => 7, 'left_rows' => 9, 'extra_rows' => 2, 'multiplied_rows' => 2, 'repeated_keys' => 1,
        ], array_diff_key($effect, ['samples' => true]));
        $this->assertSame([['value' => 'c1', 'target_rows' => 2, 'source_rows' => 2, 'extra_rows' => 2]], $effect['samples']);

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();

        foreach (['inner' => $effect['inner_rows'], 'left' => $effect['left_rows']] as $type => $expected) {
            $run = $this->runRecipe($token, $this->countRecipe($token, $orders['id'], $relationship['id'], $type)['id']);
            $this->assertSame('succeeded', $run['status']);
            $produced = collect($this->api($token, 'GET', "runs/{$run['id']}/results?per_page=200")->json('data'))->sum(fn (array $row) => (int) $row['values']['linhas']);
            $this->assertSame($expected, $produced, "{$type} join rows");
            $this->assertSame($effect['extra_rows'], $run['steps'][0]['stats']['created_tuples'] - $run['steps'][0]['stats']['matched_tuples']);
        }

        $diagnostics = $this->api($token, 'GET', "runs/{$run['id']}/diagnostics?code=join.multiple_matches")->assertOk();
        $this->assertSame($effect['multiplied_rows'], $diagnostics->json('meta.total'));
        $this->assertEqualsCanonicalizing(['c1', 'c1'], array_column(array_column($diagnostics->json('data'), 'detail'), 'key'));
    }

    public function test_the_compiler_records_the_policy_and_warns_about_accepted_multiplicity(): void
    {
        [$token, $orders, , $relationship] = $this->orders();
        $recipe = $this->countRecipe($token, $orders['id'], $relationship['id'], 'inner');
        $this->assertContains('join.relationship_unconfirmed', array_column($recipe['compiled']['issues'], 'code'));

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $compiled = $this->api($token, 'GET', "recipes/{$recipe['id']}")->json('data.compiled');

        $this->assertTrue($compiled['runnable']);
        $this->assertContains('join.multiplicity_accepted', array_column($compiled['issues'], 'code'));
        $this->assertSame(['accept_multiplicity', 'forward'], [$compiled['steps'][0]['relationship_policy'], $compiled['steps'][0]['direction']]);
    }

    public function test_a_confirmation_made_before_duplicates_appeared_must_be_reviewed(): void
    {
        [$token, $orders, $clients, $relationship] = $this->orders("id,regiao\nc1,norte\nc2,sul\n");
        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm")->assertOk();
        $recipe = $this->countRecipe($token, $orders['id'], $relationship['id'], 'inner');
        $this->assertTrue($recipe['compiled']['runnable']);

        $this->upload($token, 'clientes.csv', self::CLIENTS, $clients['id'])->assertCreated();

        $standing = $this->api($token, 'GET', "relationships/{$relationship['id']}")->json('data.standing');
        $this->assertSame(['review', false], [$standing['key'], $standing['usable']]);
        $this->assertStringContainsString('valores repetidos', $standing['reason']);

        $compiled = $this->api($token, 'GET', "recipes/{$recipe['id']}")->json('data.compiled');
        $this->assertFalse($compiled['runnable']);
        $this->assertContains('join.relationship_needs_review', array_column($compiled['issues'], 'code'));
        $this->api($token, 'POST', "recipes/{$recipe['id']}/runs")->assertStatus(422);

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm")->assertStatus(422);
        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $this->assertTrue($this->api($token, 'GET', "recipes/{$recipe['id']}")->json('data.compiled.runnable'));
    }

    public function test_an_accepted_multiplicity_is_reviewed_when_the_data_changes(): void
    {
        [$token, $orders, , $relationship] = $this->orders();
        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $recipe = $this->countRecipe($token, $orders['id'], $relationship['id'], 'inner');

        $this->upload($token, 'pedidos.csv', self::ORDERS."p8,c1,2\n", $orders['id'])->assertCreated();

        $relation = $this->api($token, 'GET', "relationships/{$relationship['id']}")->json('data');
        $this->assertSame(['confirmed', 'review'], [$relation['status'], $relation['standing']['key']]);
        $this->assertStringContainsString('versões anteriores', $relation['standing']['reason']);
        $this->assertSame(3, $relation['evidence']['join_effect']['extra_rows'], 'the new order adds one more multiplied row');
        $this->assertFalse($this->api($token, 'GET', "recipes/{$recipe['id']}")->json('data.compiled.runnable'));

        $this->api($token, 'POST', "relationships/{$relationship['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $this->assertSame('caveat', $this->api($token, 'GET', "relationships/{$relationship['id']}")->json('data.standing.key'));
    }

    public function test_the_cadastro_join_effect_matches_the_engine_on_real_scenario_data(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $relation = collect($this->api($token, 'GET', 'relationships')->json('data'))
            ->first(fn (array $r) => $r['from']['column'] === 'beneficiario_id' && $r['to']['dataset_key'] === 'beneficiarios');
        $this->api($token, 'POST', "relationships/{$relation['id']}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();

        $recipe = $this->createRecipe($token, $relation['from']['dataset_id'], [
            ['type' => 'join', 'relationship_id' => $relation['id'], 'join_type' => 'left'],
            ['type' => 'aggregate', 'group_by' => [['alias' => 'beneficiarios', 'column' => 'cozinha_id']], 'measures' => [['function' => 'count', 'name' => 'linhas']]],
        ]);
        $run = $this->runRecipe($token, $recipe['id']);

        $produced = collect($this->api($token, 'GET', "runs/{$run['id']}/results?per_page=200")->json('data'))->sum(fn (array $row) => (int) $row['values']['linhas']);
        $this->assertSame($relation['evidence']['join_effect']['left_rows'], $produced);
        $this->assertSame(
            $relation['evidence']['join_effect']['multiplied_rows'],
            $this->api($token, 'GET', "runs/{$run['id']}/diagnostics?code=join.multiple_matches")->json('meta.total'),
        );
    }
}
