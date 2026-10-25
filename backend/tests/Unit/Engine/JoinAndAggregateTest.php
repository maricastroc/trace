<?php

namespace Tests\Unit\Engine;

use App\Modules\Runs\Engine\AggregateOperator;
use App\Modules\Runs\Engine\ExecutionFailed;
use App\Modules\Runs\Engine\JoinOperator;
use App\Modules\Runs\Engine\TupleStore;

class JoinAndAggregateTest extends OperatorTestCase
{
    private function orders(): array
    {
        return [
            ['p1', 'c1', '10'],
            ['p2', 'c1', '20'],
            ['p3', 'c2', '5'],
            ['p4', null, '7'],
            ['p5', 'c9', '3'],
            ['p6', 'C2', '1'],
        ];
    }

    private function clients(): array
    {
        return [
            ['c1', 'norte'],
            ['c1', 'sul'],
            ['c2', 'norte'],
            ['c3', 'leste'],
            [null, 'oeste'],
        ];
    }

    public function test_inner_join_multiplies_rows_for_duplicate_keys_and_records_every_case(): void
    {
        [$context, $alive] = $this->context($this->orders(), $this->clients());
        [$output, $stats] = (new JoinOperator)->apply($context, $this->joinStep('inner'), $alive);

        $this->assertCount(5, $output);
        $this->assertSame(3, $stats['matched_tuples']);
        $this->assertSame(2, $stats['multiplied_tuples']);
        $this->assertSame(2, $stats['max_matches']);
        $this->assertSame(['no_match' => 2, 'null_key' => 1], $stats['excluded_by_reason']);
        $this->assertSame(1, $stats['unreferenced_lookup_rows']);
        $this->assertSame(1, $stats['lookup_null_key_rows']);

        $this->assertSame([
            'join.left_unmatched' => 2,
            'join.lookup_null_key' => 1,
            'join.multiple_matches' => 2,
            'join.null_key' => 1,
            'join.right_unmatched' => 1,
        ], $this->codes($context));

        $excluded = [];
        foreach ($context->tuples->fate as $tuple => $fate) {
            if ($fate === TupleStore::EXCLUDED) {
                $excluded[$this->orderIdOf($context, $tuple)] = $context->tuples->exclusionCode[$tuple];
            }
        }
        $this->assertSame(['p4' => 'join.null_key', 'p5' => 'join.no_match', 'p6' => 'join.no_match'], $excluded);

        foreach ($output as $child) {
            $parent = $context->tuples->parent[$child];
            $this->assertSame(TupleStore::EXPANDED, $context->tuples->fate[$parent]);
            $this->assertSame($context->tuples->sources[$parent][0], $context->tuples->sources[$child][0]);
        }

        $near = collect($context->diagnostics)->firstWhere(fn ($d) => ($d['detail']['key'] ?? null) === 'C2');
        $this->assertSame(['candidate' => 'c2', 'kind' => 'case_or_spacing'], $near['detail']['near_match']);
    }

    public function test_aggregating_after_duplicate_keys_inflates_totals_and_lineage_shows_it(): void
    {
        [$context, $alive] = $this->context($this->orders(), $this->clients());
        [$joined] = (new JoinOperator)->apply($context, $this->joinStep('inner'), $alive);
        [$results] = (new AggregateOperator)->apply($context, $this->aggregateStep(), $joined);

        $byRegion = array_column(array_map(fn ($r) => $r['values'], $results), null, 'regiao');
        $this->assertSame(['total' => '35', 'registros' => 3], array_intersect_key($byRegion['norte'], ['total' => 1, 'registros' => 1]));
        $this->assertSame(['total' => '30', 'registros' => 2], array_intersect_key($byRegion['sul'], ['total' => 1, 'registros' => 1]));

        $p1Tuples = array_filter(
            array_keys($context->tuples->fate),
            fn (int $t) => $context->tuples->fate[$t] === TupleStore::INCLUDED && $this->orderIdOf($context, $t) === 'p1',
        );
        $this->assertCount(2, $p1Tuples, 'p1 contributes once to each region because c1 is duplicated');
    }

    public function test_left_join_keeps_unmatched_rows_and_groups_them_under_null(): void
    {
        [$context, $alive] = $this->context($this->orders(), $this->clients());
        [$joined, $stats] = (new JoinOperator)->apply($context, $this->joinStep('left'), $alive);
        [$results] = (new AggregateOperator)->apply($context, $this->aggregateStep(), $joined);

        $this->assertCount(8, $joined);
        $this->assertSame(['no_match' => 0, 'null_key' => 0], $stats['excluded_by_reason']);

        $last = end($results);
        $this->assertNull($last['values']['regiao'], 'null group is sorted last');
        $this->assertSame('11', $last['values']['total']);
        $this->assertSame(3, $last['values']['registros']);
    }

    public function test_sum_ignores_invalid_values_and_reports_each_one(): void
    {
        [$context, $alive] = $this->context([
            ['p1', 'c1', '1.50'],
            ['p2', 'c1', '2.25'],
            ['p3', 'c1', null],
            ['p4', 'c1', 'n/d'],
            ['p5', 'c2', 'abc'],
        ], [['c1', 'norte'], ['c2', 'sul']]);
        [$joined] = (new JoinOperator)->apply($context, $this->joinStep(), $alive);
        [$results, , $stats] = (new AggregateOperator)->apply($context, $this->aggregateStep(), $joined);

        $byRegion = array_column(array_map(fn ($r) => $r['values'], $results), null, 'regiao');
        $this->assertSame('3.75', $byRegion['norte']['total']);
        $this->assertSame(4, $byRegion['norte']['registros']);
        $this->assertNull($byRegion['sul']['total'], 'a group without any valid value has no sum, not zero');
        $this->assertSame(['null' => 1, 'unconvertible' => 2], $stats['ignored_values']['total']);

        $ignoredRows = array_map(
            fn ($d) => $context->rows[0][$d['source_row_id']]['id'],
            array_values(array_filter($context->diagnostics, fn ($d) => str_starts_with($d['code'], 'aggregate.'))),
        );
        sort($ignoredRows);
        $this->assertSame(['p3', 'p4', 'p5'], $ignoredRows);
    }

    public function test_a_join_confirmed_as_n_to_one_refuses_to_multiply_rows(): void
    {
        [$context, $alive] = $this->context($this->orders(), $this->clients());

        try {
            (new JoinOperator)->apply($context, $this->joinStep('inner') + ['direction' => 'forward', 'relationship_policy' => null], $alive);
            $this->fail('the join should have stopped');
        } catch (ExecutionFailed $failure) {
            $this->assertSame('join.unexpected_multiplicity', $failure->errorCode);
            $this->assertSame(['key' => 'c1', 'matches' => 2], $failure->details);
        }
    }

    public function test_accepted_multiplicity_and_reverse_joins_may_multiply_rows(): void
    {
        foreach ([['direction' => 'forward', 'relationship_policy' => 'accept_multiplicity'], ['direction' => 'reverse', 'relationship_policy' => null]] as $extra) {
            [$context, $alive] = $this->context($this->orders(), $this->clients());
            [$output, $stats] = (new JoinOperator)->apply($context, $this->joinStep('inner') + $extra, $alive);
            $this->assertCount(5, $output);
            $this->assertSame(2, $stats['multiplied_tuples']);
        }
    }

    public function test_tuple_limit_stops_runaway_joins(): void
    {
        $orders = array_map(fn (int $i) => ["p{$i}", 'c1', '1'], range(1, 10));
        $clients = array_map(fn (int $i) => ['c1', "r{$i}"], range(1, 10));
        [$context, $alive] = $this->context($orders, $clients, maxTuples: 50);

        $this->expectException(ExecutionFailed::class);
        (new JoinOperator)->apply($context, $this->joinStep(), $alive);
    }
}
