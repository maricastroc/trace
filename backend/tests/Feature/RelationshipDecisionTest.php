<?php

namespace Tests\Feature;

use App\Modules\Relationships\Relationship;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RelationshipDecisionTest extends TestCase
{
    use RefreshDatabase;

    public function test_evaluate_returns_the_same_evidence_as_creation_without_saving(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $pair = [
            'from_dataset_id' => $ids['refeicoes']['id'], 'from_column' => 'cozinha_id',
            'to_dataset_id' => $ids['cozinhas']['id'], 'to_column' => 'id',
        ];

        $draft = $this->api($token, 'POST', 'relationships/evaluate', $pair)->assertOk()->json('data');

        $this->assertSame(1, Relationship::query()->count());
        $this->assertSame('many_to_one', $draft['cardinality']);
        $this->assertSame('muitos para um', $draft['cardinality_label']);
        $this->assertSame(['id' => $ids['relationship']['id'], 'status' => 'suggested'], $draft['existing']);
        $this->assertEquals($ids['relationship']['evidence'], $draft['evidence']);

        $other = $this->api($token, 'POST', 'relationships/evaluate', ['from_column' => 'id'] + $pair)->assertOk()->json('data');
        $this->assertNull($other['existing']);
        $this->assertSame(0.0, (float) $other['evidence']['match']['match_ratio']);
        $this->assertSame(1, Relationship::query()->count());
    }

    public function test_evaluate_rejects_invalid_pairs(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);

        $this->api($token, 'POST', 'relationships/evaluate', [
            'from_dataset_id' => $ids['cozinhas']['id'], 'from_column' => 'id',
            'to_dataset_id' => $ids['cozinhas']['id'], 'to_column' => 'id',
        ])->assertStatus(422)->assertJsonPath('code', 'relationship.same_dataset');

        $this->api($token, 'POST', 'relationships/evaluate', [
            'from_dataset_id' => $ids['refeicoes']['id'], 'from_column' => 'nao_existe',
            'to_dataset_id' => $ids['cozinhas']['id'], 'to_column' => 'id',
        ])->assertStatus(422)->assertJsonPath('code', 'relationship.column_missing');
    }

    public function test_reopening_a_decision_blocks_recipes_again(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $relationshipId = $ids['relationship']['id'];
        $recipeId = $ids['recipe']['id'];

        $this->api($token, 'POST', "relationships/{$relationshipId}/confirm")->assertOk();
        $this->assertTrue($this->api($token, 'GET', "recipes/{$recipeId}")->json('data.compiled.runnable'));

        $reopened = $this->api($token, 'POST', "relationships/{$relationshipId}/reopen")->assertOk()->json('data');
        $this->assertSame('suggested', $reopened['status']);
        $this->assertNull($reopened['confirmed_at']);
        $this->assertNull($reopened['rejected_at']);

        $recipe = $this->api($token, 'GET', "recipes/{$recipeId}")->json('data');
        $this->assertFalse($recipe['compiled']['runnable']);
        $this->assertContains('join.relationship_unconfirmed', array_column($recipe['compiled']['issues'], 'code'));

        $this->api($token, 'POST', "relationships/{$relationshipId}/reject")->assertOk();
        $this->assertSame('suggested', $this->api($token, 'POST', "relationships/{$relationshipId}/reopen")->json('data.status'));
    }

    public function test_correction_replaces_the_relation_and_rejects_the_original(): void
    {
        [, $token] = $this->workspace(false);
        $orders = $this->upload($token, 'pedidos.csv', "id,cliente,cliente_id\np1,c1,k1\np2,c2,k1\np3,c3,k2\n")->json('data');
        $clients = $this->upload($token, 'clientes.csv', "id,regiao\nk1,norte\nk2,sul\n")->json('data');

        $wrong = $this->api($token, 'POST', 'relationships', [
            'from_dataset_id' => $orders['id'], 'from_column' => 'cliente',
            'to_dataset_id' => $clients['id'], 'to_column' => 'id',
        ])->assertCreated()->json('data');
        $this->api($token, 'POST', "relationships/{$wrong['id']}/confirm")->assertOk();

        $response = $this->api($token, 'POST', "relationships/{$wrong['id']}/correct", [
            'from_column' => 'cliente_id', 'to_dataset_id' => $clients['id'], 'to_column' => 'id',
        ])->assertOk();

        $corrected = $response->json('data');
        $this->assertNotSame($wrong['id'], $corrected['id']);
        $this->assertSame('suggested', $corrected['status']);
        $this->assertSame('manual', $corrected['origin']);
        $this->assertSame(['pedidos', 'cliente_id'], [$corrected['from']['dataset_key'], $corrected['from']['column']]);
        $this->assertSame(1.0, (float) $corrected['evidence']['match']['match_ratio']);
        $this->assertSame('rejected', $response->json('replaced.status'));
        $this->assertSame('rejected', $this->api($token, 'GET', "relationships/{$wrong['id']}")->json('data.status'));
    }

    public function test_correction_must_change_the_columns_and_stays_inside_the_workspace(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $relationshipId = $ids['relationship']['id'];

        $this->api($token, 'POST', "relationships/{$relationshipId}/correct", [
            'from_column' => 'cozinha_id', 'to_dataset_id' => $ids['cozinhas']['id'], 'to_column' => 'id',
        ])->assertStatus(422)->assertJsonPath('code', 'relationship.correction_unchanged');
        $this->assertSame('suggested', $this->api($token, 'GET', "relationships/{$relationshipId}")->json('data.status'));

        [, $other] = $this->workspace();
        $this->api($other, 'POST', "relationships/{$relationshipId}/correct", [
            'from_column' => 'id', 'to_dataset_id' => $ids['cozinhas']['id'], 'to_column' => 'id',
        ])->assertNotFound();
        $this->api($other, 'POST', "relationships/{$relationshipId}/reopen")->assertNotFound();
    }
}
