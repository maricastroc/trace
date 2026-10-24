<?php

namespace Tests\Unit\Engine;

use App\Modules\Runs\Engine\FilterOperator;
use App\Modules\Runs\Engine\TupleStore;

class FilterOperatorTest extends OperatorTestCase
{
    private function condition(string $operator, mixed $value, string $type, string $column = 'valor'): array
    {
        return ['alias' => 'pedidos', 'column' => $column, 'input' => 0, 'operator' => $operator, 'value' => $value, 'value_type' => $type];
    }

    private function apply(array $orders, array $conditions): array
    {
        [$context, $alive] = $this->context($orders);
        [$kept, $stats] = (new FilterOperator)->apply($context, ['position' => 1, 'type' => 'filter', 'conditions' => $conditions], $alive);

        return [$context, $kept, $stats];
    }

    public function test_number_comparison_records_why_each_row_was_excluded(): void
    {
        [$context, $kept, $stats] = $this->apply([
            ['p1', 'c1', '150'],
            ['p2', 'c1', '90'],
            ['p3', 'c1', null],
            ['p4', 'c1', 'n/d'],
            ['p5', 'c1', '0100.0'],
        ], [$this->condition('gte', '100', 'number')]);

        $this->assertSame(['p1', 'p5'], array_map(fn (int $t) => $this->orderIdOf($context, $t), $kept));
        $this->assertSame(['condition_false' => 1, 'null_value' => 1, 'unconvertible' => 1], $stats['excluded_by_reason']);

        $byOrder = [];
        foreach ($context->tuples->fate as $tuple => $fate) {
            if ($fate === TupleStore::EXCLUDED) {
                $byOrder[$this->orderIdOf($context, $tuple)] = [$context->tuples->exclusionCode[$tuple], $context->tuples->exclusionDetail[$tuple]['actual']];
            }
        }

        $this->assertSame([
            'p2' => ['filter.condition_false', '90'],
            'p3' => ['filter.null_value', null],
            'p4' => ['filter.unconvertible', 'n/d'],
        ], $byOrder);
    }

    public function test_text_equality_is_exact_and_does_not_strip_leading_zeros(): void
    {
        [$context, $kept] = $this->apply([
            ['p1', '0187', '1'],
            ['p2', '187', '1'],
        ], [$this->condition('eq', '0187', 'text', 'cliente_id')]);

        $this->assertSame(['p1'], array_map(fn (int $t) => $this->orderIdOf($context, $t), $kept));
    }

    public function test_null_handling_for_neq_and_is_null(): void
    {
        [, $keptNeq, $neq] = $this->apply([['p1', 'c1', '1'], ['p2', null, '1']], [$this->condition('neq', 'c1', 'text', 'cliente_id')]);
        $this->assertCount(0, $keptNeq);
        $this->assertSame(1, $neq['excluded_by_reason']['null_value']);

        [$context, $keptNull] = $this->apply([['p1', 'c1', '1'], ['p2', null, '1']], [$this->condition('is_null', null, 'text', 'cliente_id')]);
        $this->assertSame(['p2'], array_map(fn (int $t) => $this->orderIdOf($context, $t), $keptNull));
    }

    public function test_between_dates_and_first_failing_condition_is_reported(): void
    {
        [$context, $kept, $stats] = $this->apply([
            ['2026-09-15', 'c1', '50'],
            ['2026-08-31', 'c1', '50'],
            ['30/09/2026', 'c1', '5'],
        ], [
            $this->condition('between', ['2026-09-01', '2026-09-30'], 'date', 'id'),
            $this->condition('gt', '10', 'number'),
        ]);

        $this->assertSame(['2026-09-15'], array_map(fn (int $t) => $this->orderIdOf($context, $t), $kept));
        $this->assertSame([1, 1], $stats['excluded_by_condition']);
    }
}
