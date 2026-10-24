<?php

namespace Tests\Unit\Engine;

use App\Modules\Runs\Engine\ExecutionContext;
use PHPUnit\Framework\TestCase;

abstract class OperatorTestCase extends TestCase
{
    protected function context(array $orders, array $clients = [], int $maxTuples = 1000): array
    {
        $inputs = [
            ['position' => 0, 'alias' => 'pedidos', 'columns' => [['key' => 'id', 'type' => 'text'], ['key' => 'cliente_id', 'type' => 'text'], ['key' => 'valor', 'type' => 'number']]],
            ['position' => 1, 'alias' => 'clientes', 'columns' => [['key' => 'id', 'type' => 'text'], ['key' => 'regiao', 'type' => 'text']]],
        ];

        $rows = [0 => [], 1 => []];
        $id = 100;
        foreach ($orders as $order) {
            $rows[0][++$id] = array_combine(['id', 'cliente_id', 'valor'], $order);
        }
        $id = 500;
        foreach ($clients as $client) {
            $rows[1][++$id] = array_combine(['id', 'regiao'], $client);
        }

        $context = new ExecutionContext($inputs, $rows, $maxTuples);
        $alive = [];
        foreach (array_keys($rows[0]) as $rowId) {
            $alive[] = $context->tuples->create(null, 0, [0 => $rowId]);
        }

        return [$context, $alive];
    }

    protected function joinStep(string $type = 'inner', int $position = 1): array
    {
        return [
            'position' => $position,
            'type' => 'join',
            'join_type' => $type,
            'probe' => ['alias' => 'pedidos', 'column' => 'cliente_id', 'input' => 0],
            'lookup' => ['alias' => 'clientes', 'column' => 'id', 'input' => 1],
        ];
    }

    protected function aggregateStep(int $position = 2, array $groupBy = [['alias' => 'clientes', 'column' => 'regiao', 'input' => 1]]): array
    {
        return [
            'position' => $position,
            'type' => 'aggregate',
            'group_by' => array_map(fn (array $g) => $g + ['output' => $g['column'], 'type' => 'text'], $groupBy),
            'measures' => [
                ['function' => 'sum', 'alias' => 'pedidos', 'column' => 'valor', 'input' => 0, 'name' => 'total'],
                ['function' => 'count', 'name' => 'registros'],
            ],
        ];
    }

    protected function codes(ExecutionContext $context): array
    {
        $codes = array_count_values(array_column($context->diagnostics, 'code'));
        ksort($codes);

        return $codes;
    }

    protected function orderIdOf(ExecutionContext $context, int $tuple): string
    {
        return $context->rows[0][$context->tuples->source($tuple, 0)]['id'];
    }
}
