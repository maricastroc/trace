<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RelationshipDiscoveryTest extends TestCase
{
    use RefreshDatabase;

    private function pairs(array $relationships): array
    {
        return collect($relationships)
            ->map(fn (array $r) => "{$r['from']['dataset_key']}.{$r['from']['column']} → {$r['to']['dataset_key']}.{$r['to']['column']}")
            ->sort()
            ->values()
            ->all();
    }

    public function test_a_target_with_a_few_repeated_ids_is_suggested_and_its_repetition_explained(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $relationships = collect($this->api($token, 'GET', 'relationships')->json('data'))->keyBy(
            fn (array $r) => "{$r['from']['dataset_key']}.{$r['from']['column']} → {$r['to']['dataset_key']}.{$r['to']['column']}",
        );

        $this->assertSame([
            'atendimentos.beneficiario_id → beneficiarios.id',
            'atendimentos.cozinha_id → cozinhas.id',
            'beneficiarios.cozinha_id → cozinhas.id',
        ], $relationships->keys()->sort()->values()->all());

        $repeated = $relationships['atendimentos.beneficiario_id → beneficiarios.id'];
        $this->assertSame('suggested', $repeated['status']);
        $this->assertSame('suggested', $repeated['standing']['key']);
        $this->assertSame('many_to_many', $repeated['cardinality']);
        $this->assertFalse($repeated['evidence']['to']['unique']);
        $this->assertSame(6, $repeated['evidence']['to']['duplicate_values']);
        $this->assertSame(9634, $repeated['evidence']['match']['matched_rows']);

        $effect = $repeated['evidence']['join_effect'];
        $this->assertSame(9756, $effect['source_rows']);
        $this->assertSame($effect['matched_rows'] + $effect['extra_rows'], $effect['inner_rows']);
        $this->assertSame($effect['source_rows'] + $effect['extra_rows'], $effect['left_rows']);
        $this->assertGreaterThan(0, $effect['extra_rows']);
        $this->assertLessThanOrEqual(6, $effect['repeated_keys']);
        $this->assertGreaterThanOrEqual($effect['multiplied_rows'], $effect['extra_rows'], 'each multiplied row adds at least one extra row');
        $this->assertContains('multiplicity', array_column($repeated['evidence']['statements'], 'kind'));
    }

    public function test_discovery_ignores_heavily_repeated_targets_weak_names_and_low_coverage(): void
    {
        [, $token] = $this->workspace(false);
        $ids = range(1, 40);
        $clients = "id,nome\n".implode("\n", array_map(fn (int $i) => sprintf('%03d,Cliente %d', $i, $i), $ids))."\n007,Cliente 7 bis\n";
        $sellers = "id,nome\n".implode("\n", array_map(fn (int $i) => sprintf('%03d,Vendedor %d', $i, $i), $ids))."\n005,Vendedor 5 bis\n";
        $stores = "id,nome\nL1,A\nL1,A2\nL2,B\nL2,B2\nL3,C\nL3,C2\nL4,D\nL4,D2\nL5,E\nL5,E2\n";
        $orders = "id,cliente_id,quantidade,codigo,loja_id,vendedor_id\n".implode("\n", array_map(
            fn (int $i) => sprintf('p%03d,%03d,%d,%03d,L%d,%s', $i, ($i - 1) % 40 + 1, $i % 5 + 1, ($i - 1) % 40 + 1, $i % 5 + 1, $i <= 30 ? sprintf('%03d', $i % 20 + 1) : '9'.$i),
            range(1, 60),
        ))."\n";

        foreach (['clientes.csv' => $clients, 'vendedores.csv' => $sellers, 'lojas.csv' => $stores, 'pedidos.csv' => $orders] as $file => $content) {
            $this->upload($token, $file, $content)->assertCreated();
        }

        $found = $this->api($token, 'POST', 'relationships/discover')->assertOk()->json('data');

        $this->assertSame(['pedidos.cliente_id → clientes.id'], $this->pairs($found));
        $this->assertSame(1, $found[0]['evidence']['join_effect']['repeated_keys']);
        $this->assertSame(2, $found[0]['evidence']['join_effect']['extra_rows'], 'orders 7 and 47 point to the repeated id 007');
    }

    public function test_rediscovery_keeps_the_decisions_already_made(): void
    {
        [, $token] = $this->workspace(true, 'cadastro');
        $find = fn () => collect($this->api($token, 'GET', 'relationships')->json('data'))
            ->first(fn (array $r) => $r['from']['column'] === 'beneficiario_id' && $r['to']['dataset_key'] === 'beneficiarios');

        $id = $find()['id'];
        $this->api($token, 'POST', "relationships/{$id}/reject")->assertOk();
        $this->api($token, 'POST', 'relationships/discover')->assertOk();
        $this->assertSame('rejected', $find()['status']);

        $this->api($token, 'POST', "relationships/{$id}/confirm", ['policy' => 'accept_multiplicity'])->assertOk();
        $this->api($token, 'POST', 'relationships/discover')->assertOk();
        $this->assertSame(['confirmed', 'accept_multiplicity', 'caveat'], [$find()['status'], $find()['policy'], $find()['standing']['key']]);
    }
}
