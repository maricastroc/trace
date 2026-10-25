<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WorkspaceScenarioTest extends TestCase
{
    use RefreshDatabase;

    public function test_cadastro_scenario_installs_cozinhas_beneficiarios_and_atendimentos_without_a_recipe(): void
    {
        $response = $this->postJson('/api/v1/workspaces', ['scenario' => 'cadastro'])->assertCreated()->json('data');

        $this->assertSame(['key' => 'cadastro', 'label' => 'Cadastro e atendimentos'], $response['scenario']);
        $this->assertSame(3, $response['counts']['datasets']);
        $this->assertSame(0, $response['counts']['recipes']);

        $datasets = collect($this->api($response['token'], 'GET', 'datasets')->assertOk()->json('data'))->keyBy('key');
        $this->assertSame(
            ['atendimentos' => 9756, 'beneficiarios' => 1248, 'cozinhas' => 12],
            $datasets->map(fn (array $dataset) => $dataset['latest_version']['row_count'])->sortKeys()->all(),
        );
        $this->assertSame([true, true, true], $datasets->pluck('is_synthetic')->values()->all());

        $beneficiarios = $this->api($response['token'], 'GET', "datasets/{$datasets['beneficiarios']['id']}")->assertOk()->json('data.columns');
        $idProfile = collect($beneficiarios)->firstWhere('key', 'id')['profile'];
        $this->assertSame(1248, $idProfile['non_null']);
        $this->assertSame(1242, $idProfile['distinct']);
        $this->assertFalse($idProfile['unique']);
    }

    public function test_workspace_created_without_a_scenario_installs_the_unchanged_meals_scenario(): void
    {
        $response = $this->postJson('/api/v1/workspaces')->assertCreated()->json('data');

        $this->assertSame('refeicoes', $response['scenario']['key']);

        $datasets = collect($this->api($response['token'], 'GET', 'datasets')->json('data'))->keyBy('key');
        $this->assertSame(
            ['cozinhas' => 15, 'refeicoes' => 118],
            $datasets->map(fn (array $dataset) => $dataset['latest_version']['row_count'])->sortKeys()->all(),
        );
        $this->api($response['token'], 'GET', 'recipes')->assertOk()->assertJsonPath('data.0.name', 'Refeições de setembro por município');
    }

    public function test_scenarios_keep_their_identifiers_in_separate_workspaces(): void
    {
        [, $mealsToken] = $this->workspace();
        [, $cadastroToken] = $this->workspace(true, 'cadastro');

        $mealsKitchens = $this->kitchenIds($mealsToken);
        $cadastroKitchens = $this->kitchenIds($cadastroToken);

        $this->assertContains('0183', $mealsKitchens);
        $this->assertContains('0101', $cadastroKitchens);
        $this->assertSame([], array_values(array_intersect($mealsKitchens, $cadastroKitchens)));

        $mealsDataset = collect($this->api($mealsToken, 'GET', 'datasets')->json('data'))->firstWhere('key', 'refeicoes');
        $this->api($cadastroToken, 'GET', "datasets/{$mealsDataset['id']}")->assertNotFound();
    }

    public function test_unknown_scenario_returns_422_without_creating_a_workspace(): void
    {
        $this->postJson('/api/v1/workspaces', ['scenario' => 'rede'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['scenario' => 'Cenário de demonstração desconhecido.']);

        $this->assertDatabaseCount('workspaces', 0);
    }

    public function test_meta_lists_the_selectable_scenarios(): void
    {
        $meta = $this->getJson('/api/v1/meta')->assertOk()->json('data');

        $this->assertSame('refeicoes', $meta['default_scenario']);
        $this->assertSame(['refeicoes', 'cadastro'], array_column($meta['scenarios'], 'key'));
    }

    /**
     * @return list<string>
     */
    private function kitchenIds(string $token): array
    {
        $kitchens = collect($this->api($token, 'GET', 'datasets')->json('data'))->firstWhere('key', 'cozinhas');
        $rows = $this->api($token, 'GET', "dataset-versions/{$kitchens['latest_version']['id']}/rows?per_page=100")->assertOk()->json('data');

        return array_map(fn (array $row) => $row['values']['id'], $rows);
    }
}
