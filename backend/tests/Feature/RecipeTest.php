<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RecipeTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_recipe_is_blocked_until_relationship_is_confirmed(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);

        $this->assertFalse($ids['recipe']['compiled']['runnable']);
        $this->api($token, 'POST', "recipes/{$ids['recipe']['id']}/runs")
            ->assertStatus(422)
            ->assertJsonPath('code', 'recipe.not_runnable')
            ->assertJsonPath('details.issues.0.code', 'join.relationship_unconfirmed');

        $this->api($token, 'POST', "relationships/{$ids['relationship']['id']}/confirm");
        $recipe = $this->api($token, 'GET', "recipes/{$ids['recipe']['id']}")->json('data');
        $this->assertTrue($recipe['compiled']['runnable']);
        $this->assertSame(
            ['aggregate.column_not_numeric'],
            array_column($recipe['compiled']['issues'], 'code'),
            'invalid quantities only produce a warning',
        );
    }

    public function test_structural_errors_are_rejected_with_their_location(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);
        $base = $ids['refeicoes']['id'];

        $cases = [
            'ref.column_unknown' => [['type' => 'filter', 'conditions' => [['alias' => 'refeicoes', 'column' => 'nao_existe', 'operator' => 'eq', 'value' => 'x']]]],
            'ref.alias_unknown' => [['type' => 'filter', 'conditions' => [['alias' => 'cozinhas', 'column' => 'status', 'operator' => 'eq', 'value' => 'ativa']]]],
            'filter.operator_invalid' => [['type' => 'filter', 'conditions' => [['alias' => 'refeicoes', 'column' => 'data', 'operator' => 'contains', 'value' => '09', 'value_type' => 'date']]]],
            'filter.value_unconvertible' => [['type' => 'filter', 'conditions' => [['alias' => 'refeicoes', 'column' => 'data', 'operator' => 'gt', 'value' => 'ontem', 'value_type' => 'date']]]],
            'filter.between_inverted' => [['type' => 'filter', 'conditions' => [['alias' => 'refeicoes', 'column' => 'quantidade', 'operator' => 'between', 'value' => ['10', '2'], 'value_type' => 'number']]]],
            'step.after_aggregate' => [
                ['type' => 'aggregate', 'group_by' => [['alias' => 'refeicoes', 'column' => 'data']], 'measures' => [['function' => 'count', 'name' => 'n']]],
                ['type' => 'filter', 'conditions' => [['alias' => 'refeicoes', 'column' => 'data', 'operator' => 'is_not_null']]],
            ],
            'aggregate.name_invalid' => [['type' => 'aggregate', 'group_by' => [['alias' => 'refeicoes', 'column' => 'data']], 'measures' => [['function' => 'count', 'name' => 'Total Geral']]]],
            'join.relationship_missing' => [['type' => 'join', 'relationship_id' => '01aaaaaaaaaaaaaaaaaaaaaaaa']],
            'step.type_invalid' => [['type' => 'sql', 'query' => 'select 1']],
        ];

        foreach ($cases as $code => $steps) {
            $response = $this->api($token, 'POST', 'recipes', ['name' => 'x', 'base_dataset_id' => $base, 'steps' => $steps])
                ->assertStatus(422)
                ->assertJsonPath('code', 'recipe.invalid');
            $this->assertContains($code, array_column($response->json('details.issues'), 'code'), "expected {$code}");
        }
    }

    public function test_draft_validation_returns_summaries_without_saving(): void
    {
        [, $token] = $this->workspace();
        $ids = $this->demoIds($token);

        $draft = $this->api($token, 'POST', 'recipes/validate', [
            'base_dataset_id' => $ids['refeicoes']['id'],
            'steps' => [['type' => 'filter', 'conditions' => [['alias' => 'refeicoes', 'column' => 'quantidade', 'operator' => 'gt', 'value' => '150', 'value_type' => 'number']]]],
        ])->assertOk()->json('data');

        $this->assertSame('Manter registros em que refeicoes.quantidade é maior que 150', $draft['steps'][0]['summary']);
        $this->assertTrue($draft['runnable']);
        $this->assertCount(1, $this->api($token, 'GET', 'recipes')->json('data'));
    }

    public function test_update_increments_revision_only_when_definition_changes(): void
    {
        [, $token] = $this->workspace();
        $recipe = $this->demoIds($token)['recipe'];
        $payload = ['name' => 'Novo nome', 'base_dataset_id' => $recipe['definition']['base_dataset_id'], 'steps' => $recipe['definition']['steps']];

        $this->assertSame(1, $this->api($token, 'PUT', "recipes/{$recipe['id']}", $payload)->assertOk()->json('data.revision'));

        $payload['steps'][0]['conditions'][0]['value'] = ['2026-10-01', '2026-10-31'];
        $this->assertSame(2, $this->api($token, 'PUT', "recipes/{$recipe['id']}", $payload)->assertOk()->json('data.revision'));
    }
}
