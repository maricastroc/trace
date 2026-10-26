<?php

namespace Tests\Unit\Comparisons;

use App\Modules\Comparisons\Reconciler;
use App\Modules\Comparisons\SideSet;
use App\Modules\Support\DomainError;
use PHPUnit\Framework\TestCase;

class ReconcilerTest extends TestCase
{
    private const NO_PERIODS = ['a' => ['validity' => null, 'other_period' => null], 'b' => ['validity' => null, 'other_period' => null]];

    /**
     * @param  list<string|null>  $values
     */
    private function side(array $values, int &$rowId): SideSet
    {
        $identities = [];
        $empty = [];
        foreach ($values as $value) {
            $rowId++;
            if ($value === null || trim($value) === '') {
                $empty[] = $rowId;
            } else {
                $identities[$value][] = $rowId;
            }
        }

        return new SideSet($identities, $empty, [], count($values), [], [], []);
    }

    /**
     * @return list<string|null>
     */
    private function randomValues(int $seed, int $count): array
    {
        mt_srand($seed);
        $values = [];
        for ($i = 0; $i < $count; $i++) {
            $n = mt_rand(1, 60);
            $values[] = match (mt_rand(0, 9)) {
                0 => null,
                1 => str_pad((string) $n, 4, '0', STR_PAD_LEFT),
                2 => ' ',
                default => (string) $n,
            };
        }

        return $values;
    }

    private function strip(string $value): string
    {
        $stripped = ltrim($value, '0');

        return $stripped === '' ? '0' : $stripped;
    }

    public function test_random_sets_reconcile_like_independent_set_operations_with_and_without_the_rule(): void
    {
        foreach ([3, 17, 42, 101, 977] as $seed) {
            $left = $this->randomValues($seed, 120);
            $right = $this->randomValues($seed + 1, 90);
            $rowId = 0;
            $a = $this->side($left, $rowId);
            $b = $this->side($right, $rowId);

            $keysA = array_values(array_unique(array_filter($left, fn ($v) => $v !== null && trim($v) !== '')));
            $keysB = array_values(array_unique(array_filter($right, fn ($v) => $v !== null && trim($v) !== '')));
            $shared = array_intersect($keysA, $keysB);
            $onlyA = array_values(array_diff($keysA, $keysB));
            $onlyB = array_values(array_diff($keysB, $keysA));

            $strict = (new Reconciler)->reconcile($a, $b, [], self::NO_PERIODS, [])['summary'];
            $this->assertSame([count($shared), 0, count($onlyA), count($onlyB)], [$strict['shared'], $strict['shared_by_rule'], $strict['only_a'], $strict['only_b']], "seed {$seed}");

            $normA = array_count_values(array_map(fn (string $v) => 'n'.$this->strip($v), $onlyA));
            $normB = array_count_values(array_map(fn (string $v) => 'n'.$this->strip($v), $onlyB));
            $pairs = count(array_filter($normA, fn (int $n, string $norm) => $n === 1 && ($normB[$norm] ?? 0) === 1, ARRAY_FILTER_USE_BOTH));

            $ruled = (new Reconciler)->reconcile($a, $b, ['leading_zeros'], self::NO_PERIODS, [])['summary'];
            $this->assertSame([count($shared), $pairs, count($onlyA) - $pairs, count($onlyB) - $pairs], [$ruled['shared'], $ruled['shared_by_rule'], $ruled['only_a'], $ruled['only_b']], "seed {$seed}");
            $this->assertSame($pairs, $strict['explanations']['only_a']['possible_match'], "seed {$seed}: hypotheses are the pairs a rule would make");

            foreach ([$strict, $ruled] as $summary) {
                $this->assertSame($summary['a']['distinct'], $summary['shared'] + $summary['shared_by_rule'] + $summary['only_a']);
                $this->assertSame($summary['b']['distinct'], $summary['shared'] + $summary['shared_by_rule'] + $summary['only_b']);
                $this->assertSame(count($left), $summary['a']['rows']);
                $this->assertSame(count(array_filter($left, fn ($v) => $v === null || trim($v) === '')), $summary['a']['empty_rows']);
                $this->assertTrue(collect($summary['checks'])->every(fn (array $check) => $check['holds']));
            }
        }
    }

    public function test_every_identity_lands_in_exactly_one_category_with_its_occurrences(): void
    {
        $rowId = 0;
        $a = $this->side(['7', '7', '7', '8', null], $rowId);
        $b = $this->side(['7', '7', '9', '9', '9'], $rowId);

        $result = (new Reconciler)->reconcile($a, $b, [], self::NO_PERIODS, []);
        $byIdentity = collect($result['identities'])->keyBy('identity');

        $this->assertSame(['7', '8', '9'], collect($result['identities'])->pluck('identity')->sort()->values()->all(), 'identities stay text, never numbers');
        $this->assertSame(['shared', 3, 2], [$byIdentity['7']['category'], $byIdentity['7']['a_rows'], $byIdentity['7']['b_rows']]);
        $this->assertSame(['only_a', 'absent'], [$byIdentity['8']['category'], $byIdentity['8']['explanation']]);
        $this->assertSame(['only_b', 0, 3], [$byIdentity['9']['category'], $byIdentity['9']['a_rows'], $byIdentity['9']['b_rows']]);
        $this->assertSame(['rows' => 5, 'rows_with_key' => 4, 'empty_rows' => 1, 'distinct' => 2, 'repeated_identities' => 1, 'repeated_rows' => 2], $result['summary']['a']);
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    private function assertInvariants(array $summary): void
    {
        $this->assertSame($summary['a']['distinct'], $summary['shared'] + $summary['shared_by_rule'] + $summary['only_a']);
        $this->assertSame($summary['b']['distinct'], $summary['shared'] + $summary['shared_by_rule'] + $summary['only_b']);
        $this->assertSame($summary['a']['distinct'] - $summary['b']['distinct'], $summary['net_difference']);
        $this->assertSame($summary['only_a'] - $summary['only_b'], $summary['net_difference']);
        $this->assertSame($summary['only_a'] + $summary['only_b'], $summary['unmatched']);
        $this->assertSame($summary['only_a'], array_sum($summary['explanations']['only_a']));
        $this->assertSame($summary['only_b'], array_sum($summary['explanations']['only_b']));
        $this->assertTrue(collect($summary['checks'])->every(fn (array $check) => $check['holds']));
    }

    public function test_edge_cases_keep_every_identity_in_exactly_one_place(): void
    {
        $cases = [
            'both empty' => [[], [], [0, 0, 0, 0, 0]],
            'one side empty' => [[], ['1', '2', '2'], [0, 0, 0, 2, -2]],
            'only blanks on one side' => [[null, ' ', ''], ['1'], [0, 0, 0, 1, -1]],
            'equal totals, different identities' => [['1', '2', '3'], ['3', '4', '5'], [1, 0, 2, 2, 0]],
            'very unequal' => [array_map('strval', range(1, 400)), ['7', '900'], [1, 0, 399, 1, 398]],
        ];
        foreach ($cases as $name => [$left, $right, $expected]) {
            $rowId = 0;
            $result = (new Reconciler)->reconcile($this->side($left, $rowId), $this->side($right, $rowId), [], self::NO_PERIODS, []);
            $summary = $result['summary'];
            $this->assertSame($expected, [$summary['shared'], $summary['shared_by_rule'], $summary['only_a'], $summary['only_b'], $summary['net_difference']], $name);
            $this->assertInvariants($summary);
            $this->assertCount($summary['shared'] + $summary['shared_by_rule'] + $summary['only_a'] + $summary['only_b'], $result['identities'], "{$name}: one entry per identity");
            $this->assertSame(count(array_filter($left, fn ($v) => $v === null || trim($v) === '')), $summary['a']['empty_rows'], $name);
        }
    }

    public function test_competing_candidates_never_make_a_pair_even_with_the_rule_accepted(): void
    {
        $rowId = 0;
        $a = $this->side(['007', '08', '3', '0187'], $rowId);
        $b = $this->side(['7', '07', '8', '0003', '187', '0187'], $rowId);

        foreach ([[], ['leading_zeros']] as $rules) {
            $result = (new Reconciler)->reconcile($a, $b, $rules, self::NO_PERIODS, []);
            $summary = $result['summary'];
            $this->assertInvariants($summary);
            $byIdentity = collect($result['identities'])->groupBy('identity');
            $this->assertSame('ambiguous_match', $byIdentity['007']->first()['explanation'], 'two candidates (7 and 07) for 007');
            $this->assertSame(['only_b', 'variant_of_matched'], [$byIdentity['187']->first()['category'], $byIdentity['187']->first()['explanation']], '187 is a variant of 0187, which already has an exact pair');
            $this->assertSame('shared', $byIdentity['0187']->first()['category']);
            $paired = collect($result['identities'])->where('category', 'shared_by_rule')->pluck('b_value')->all();
            $this->assertSame(count($paired), count(array_unique($paired)), 'no identity of B is used by two pairs');
        }

        $ruled = (new Reconciler)->reconcile($a, $b, ['leading_zeros'], self::NO_PERIODS, [])['summary'];
        $this->assertSame([1, 2], [$ruled['shared'], $ruled['shared_by_rule']], '08 ↔ 8 and 3 ↔ 0003 are unique pairs; 007 stays ambiguous');
    }

    public function test_an_inconsistent_side_is_refused_instead_of_reported(): void
    {
        $broken = new SideSet(['1' => [1], '2' => [2]], [], [], 5, [], [], []);
        $rowId = 10;

        try {
            (new Reconciler)->reconcile($broken, $this->side(['1'], $rowId), [], self::NO_PERIODS, []);
            $this->fail('the reconciliation should have been refused');
        } catch (DomainError $error) {
            $this->assertSame('comparison.inconsistent', $error->errorCode);
            $this->assertSame(['rows_a'], array_column($error->details['checks'], 'name'));
        }
    }

    public function test_field_values_are_compared_as_sets_so_no_row_is_paired_by_position(): void
    {
        $a = new SideSet(['1' => [1, 2], '2' => [3], '3' => [4]], [], [], 4, [], [1 => ['k' => 'x'], 2 => ['k' => 'y'], 3 => ['k' => 'p'], 4 => ['k' => null]], []);
        $b = new SideSet(['1' => [5], '2' => [6], '3' => [7]], [], [], 3, [], [5 => ['k' => 'y'], 6 => ['k' => 'p'], 7 => ['k' => 'q']], []);

        $result = (new Reconciler)->reconcile($a, $b, [], self::NO_PERIODS, [['a' => 'k', 'b' => 'k']]);
        $status = collect($result['identities'])->mapWithKeys(fn (array $i) => [$i['identity'] => $i['fields'][0]['status']])->all();

        $this->assertSame(['1' => 'partial', '2' => 'same', '3' => 'different'], $status);
        $this->assertSame(['a' => 'k', 'b' => 'k', 'compared' => 3, 'same' => 1, 'different' => 1, 'partial' => 1], $result['summary']['fields'][0]);
    }
}
