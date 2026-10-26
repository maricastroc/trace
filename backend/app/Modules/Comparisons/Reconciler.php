<?php

namespace App\Modules\Comparisons;

use App\Modules\Runs\Engine\ValidityRule;
use App\Modules\Support\DomainError;

final class Reconciler
{
    public const SHARED = 'shared';

    public const SHARED_BY_RULE = 'shared_by_rule';

    public const ONLY_A = 'only_a';

    public const ONLY_B = 'only_b';

    public const CATEGORIES = [self::SHARED, self::SHARED_BY_RULE, self::ONLY_A, self::ONLY_B];

    public const EXPLANATIONS = ['excluded_in_other', 'outside_other_period', 'possible_match', 'ambiguous_match', 'variant_of_matched', 'absent'];

    /**
     * @param  list<string>  $rules  accepted normalization rules
     * @param  array{a: array{validity: array|null, other_period: array{0: string, 1: string}|null}, b: array{validity: array|null, other_period: array{0: string, 1: string}|null}}  $periods
     * @param  list<array{a: string, b: string}>  $fields
     * @return array{identities: list<array<string, mixed>>, summary: array<string, mixed>}
     */
    public function reconcile(SideSet $a, SideSet $b, array $rules, array $periods, array $fields): array
    {
        $shared = [];
        $onlyA = [];
        $onlyB = [];
        foreach ($a->keys() as $key) {
            if ($b->has($key)) {
                $shared[] = $key;
            } else {
                $onlyA[] = $key;
            }
        }
        foreach ($b->keys() as $key) {
            if (! $a->has($key)) {
                $onlyB[] = $key;
            }
        }

        $byRule = $rules === [] ? [] : $this->uniquePairs($onlyA, $onlyB, $rules);
        $paired = array_flip(array_map('strval', array_keys($byRule)));
        $pairedB = array_flip(array_map('strval', array_values($byRule)));
        $onlyA = array_values(array_filter($onlyA, fn (string $k) => ! isset($paired[$k])));
        $onlyB = array_values(array_filter($onlyB, fn (string $k) => ! isset($pairedB[$k])));

        [$hypA, $hypB] = $this->hypotheses($onlyA, $onlyB);
        [$ambA, $ambB] = $this->ambiguous($onlyA, $onlyB, $hypA, $hypB);

        $identities = [];
        sort($shared, SORT_STRING);
        foreach ($shared as $key) {
            $identities[] = $this->identity($key, $key, $key, self::SHARED, null, null, $a, $b, $fields);
        }
        $ruleKeys = array_map('strval', array_keys($byRule));
        sort($ruleKeys, SORT_STRING);
        foreach ($ruleKeys as $key) {
            $identities[] = $this->identity($key, $key, (string) $byRule[$key], self::SHARED_BY_RULE, null, ['rules' => array_values($rules)], $a, $b, $fields);
        }

        $explained = ['a' => array_fill_keys(self::EXPLANATIONS, 0), 'b' => array_fill_keys(self::EXPLANATIONS, 0)];
        $variants = ['a' => $this->normalizedIndex($b->keys()), 'b' => $this->normalizedIndex($a->keys())];
        foreach ([['a', $onlyA, $a, $b, $hypA, $ambA], ['b', $onlyB, $b, $a, $hypB, $ambB]] as [$side, $keys, $own, $other, $hyp, $amb]) {
            sort($keys, SORT_STRING);
            foreach ($keys as $key) {
                [$explanation, $detail] = $this->explain($key, $own, $other, $periods[$side], $hyp, $amb, $variants[$side]);
                $explained[$side][$explanation]++;
                $identities[] = $side === 'a'
                    ? $this->identity($key, $key, null, self::ONLY_A, $explanation, $detail, $a, $b, [])
                    : $this->identity($key, null, $key, self::ONLY_B, $explanation, $detail, $a, $b, []);
            }
        }

        $summary = $this->summary($a, $b, count($shared), count($byRule), count($onlyA), count($onlyB), $explained, $identities, $fields, count($hypA));
        $this->verify($summary['checks']);

        return ['identities' => $identities, 'summary' => $summary];
    }

    /**
     * @param  list<string>  $left
     * @param  list<string>  $right
     * @param  list<string>  $rules
     * @return array<string, string> left key => right key, only when each side has exactly one candidate
     */
    private function uniquePairs(array $left, array $right, array $rules): array
    {
        $byNormLeft = [];
        foreach ($left as $key) {
            $byNormLeft['n'.IdentityRules::normalize($key, $rules)][] = $key;
        }
        $byNormRight = [];
        foreach ($right as $key) {
            $byNormRight['n'.IdentityRules::normalize($key, $rules)][] = $key;
        }

        $pairs = [];
        foreach ($byNormLeft as $norm => $keys) {
            if (count($keys) === 1 && count($byNormRight[$norm] ?? []) === 1) {
                $pairs[$keys[0]] = $byNormRight[$norm][0];
            }
        }

        return $pairs;
    }

    /**
     * @return array{0: array<string, array{candidate: string, rules: list<string>}>, 1: array<string, array{candidate: string, rules: list<string>}>}
     */
    private function hypotheses(array $onlyA, array $onlyB): array
    {
        $hypA = [];
        $hypB = [];
        foreach ([[IdentityRules::LEADING_ZEROS], [IdentityRules::CASE_AND_SPACING], IdentityRules::SUPPORTED] as $rules) {
            $left = array_values(array_filter($onlyA, fn (string $k) => ! isset($hypA[$k])));
            $right = array_values(array_filter($onlyB, fn (string $k) => ! isset($hypB[$k])));
            foreach ($this->uniquePairs($left, $right, $rules) as $aKey => $bKey) {
                $hypA[(string) $aKey] = ['candidate' => (string) $bKey, 'rules' => $rules];
                $hypB[(string) $bKey] = ['candidate' => (string) $aKey, 'rules' => $rules];
            }
        }

        return [$hypA, $hypB];
    }

    private function ambiguous(array $onlyA, array $onlyB, array $hypA, array $hypB): array
    {
        $groups = ['a' => [], 'b' => []];
        foreach ($onlyA as $key) {
            $groups['a']['n'.IdentityRules::normalize($key, IdentityRules::SUPPORTED)][] = $key;
        }
        foreach ($onlyB as $key) {
            $groups['b']['n'.IdentityRules::normalize($key, IdentityRules::SUPPORTED)][] = $key;
        }

        $ambA = [];
        $ambB = [];
        foreach ($groups['a'] as $norm => $keys) {
            $candidates = $groups['b'][$norm] ?? [];
            if ($candidates === []) {
                continue;
            }
            foreach ($keys as $key) {
                if (! isset($hypA[$key])) {
                    $ambA[$key] = $candidates;
                }
            }
            foreach ($candidates as $key) {
                if (! isset($hypB[$key])) {
                    $ambB[$key] = $keys;
                }
            }
        }

        return [$ambA, $ambB];
    }

    /**
     * @return array{0: string, 1: array<string, mixed>|null}
     */
    private function explain(string $key, SideSet $own, SideSet $other, array $period, array $hyp, array $amb, array $variants): array
    {
        if (isset($other->excluded[$key])) {
            $by = [];
            foreach ($other->excluded[$key] as $stepCode => $rows) {
                [$step, $code] = explode('|', $stepCode, 2);
                $by[] = ['step' => (int) $step, 'code' => $code, 'rows' => $rows];
            }

            return ['excluded_in_other', ['by' => $by]];
        }

        $reasons = $this->outsidePeriod($own->rowsOf($key), $own, $period);
        if ($reasons !== null) {
            return ['outside_other_period', ['reasons' => $reasons, 'from' => $period['other_period'][0], 'to' => $period['other_period'][1]]];
        }

        if (isset($hyp[$key])) {
            return ['possible_match', $hyp[$key]];
        }

        if (isset($amb[$key])) {
            return ['ambiguous_match', ['count' => count($amb[$key]), 'candidates' => array_slice(array_map('strval', $amb[$key]), 0, 5)]];
        }

        $matched = $variants['n'.IdentityRules::normalize($key, IdentityRules::SUPPORTED)] ?? [];
        if ($matched !== []) {
            return ['variant_of_matched', ['count' => count($matched), 'candidates' => array_slice($matched, 0, 5)]];
        }

        return ['absent', null];
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, list<string>>
     */
    private function normalizedIndex(array $keys): array
    {
        $index = [];
        foreach ($keys as $key) {
            $index['n'.IdentityRules::normalize($key, IdentityRules::SUPPORTED)][] = $key;
        }

        return $index;
    }

    /**
     * @param  list<int>  $rows
     * @return array<string, int>|null
     */
    private function outsidePeriod(array $rows, SideSet $own, array $period): ?array
    {
        $validity = $period['validity'] ?? null;
        $range = $period['other_period'] ?? null;
        if ($validity === null || $range === null || $rows === []) {
            return null;
        }

        $reasons = [];
        foreach ($rows as $rowId) {
            [$start, $end] = $own->validity[$rowId] ?? [null, null];
            $verdict = ValidityRule::evaluate(
                ['reading' => 'active_any', 'from' => $range[0], 'to' => $range[1], 'end_inclusive' => (bool) $validity['end_inclusive']],
                $start,
                $validity['end_column'] === null ? null : $end,
            );
            if ($verdict === null || $verdict[0] !== ValidityRule::OUT) {
                return null;
            }
            $reasons[$verdict[1]] = ($reasons[$verdict[1]] ?? 0) + 1;
        }

        return $reasons;
    }

    private function identity(string $identity, ?string $aKey, ?string $bKey, string $category, ?string $explanation, ?array $detail, SideSet $a, SideSet $b, array $fields): array
    {
        $aRows = $aKey === null ? [] : $a->rowsOf($aKey);
        $bRows = $bKey === null ? [] : $b->rowsOf($bKey);

        $compared = [];
        foreach ($fields as $field) {
            $left = $this->valueSet($a, $aRows, $field['a']);
            $right = $this->valueSet($b, $bRows, $field['b']);
            $common = array_intersect($left, $right);
            $status = $left === $right ? 'same' : ($common === [] ? 'different' : 'partial');
            $compared[] = ['a' => $field['a'], 'b' => $field['b'], 'status' => $status, 'a_values' => array_slice($left, 0, 5), 'b_values' => array_slice($right, 0, 5)];
        }

        return [
            'identity' => $identity,
            'a_value' => $aKey,
            'b_value' => $bKey,
            'category' => $category,
            'explanation' => $explanation,
            'detail' => $detail,
            'a_rows' => count($aRows),
            'b_rows' => count($bRows),
            'fields' => $compared,
        ];
    }

    /**
     * @param  list<int>  $rows
     * @return list<string|null>
     */
    private function valueSet(SideSet $side, array $rows, string $column): array
    {
        $values = [];
        foreach ($rows as $rowId) {
            $value = $side->fields[$rowId][$column] ?? null;
            $values['v'.($value ?? "\0")] = $value;
        }
        $list = array_values($values);
        usort($list, fn (?string $x, ?string $y) => strcmp((string) $x, (string) $y));

        return $list;
    }

    private function summary(SideSet $a, SideSet $b, int $shared, int $byRule, int $onlyA, int $onlyB, array $explained, array $identities, array $fields, int $hypotheses): array
    {
        $ca = $a->counts();
        $cb = $b->counts();

        $fieldSummary = [];
        foreach ($fields as $i => $field) {
            $counts = ['same' => 0, 'different' => 0, 'partial' => 0];
            foreach ($identities as $identity) {
                if (isset($identity['fields'][$i])) {
                    $counts[$identity['fields'][$i]['status']]++;
                }
            }
            $fieldSummary[] = ['a' => $field['a'], 'b' => $field['b'], 'compared' => array_sum($counts)] + $counts;
        }

        $check = fn (string $name, string $formula, int $left, int $right) => compact('name', 'formula', 'left', 'right') + ['holds' => $left === $right];

        return [
            'unit' => 'identidades distintas',
            'a' => $ca,
            'b' => $cb,
            'shared' => $shared,
            'shared_by_rule' => $byRule,
            'only_a' => $onlyA,
            'only_b' => $onlyB,
            'net_difference' => $ca['distinct'] - $cb['distinct'],
            'unmatched' => $onlyA + $onlyB,
            'possible_matches' => $hypotheses,
            'explanations' => ['only_a' => $explained['a'], 'only_b' => $explained['b']],
            'fields' => $fieldSummary,
            'checks' => [
                $check('distinct_a', 'distintos_A = shared + shared_by_rule + only_a', $ca['distinct'], $shared + $byRule + $onlyA),
                $check('distinct_b', 'distintos_B = shared + shared_by_rule + only_b', $cb['distinct'], $shared + $byRule + $onlyB),
                $check('rows_a', 'linhas_A = com identificador + sem identificador', $ca['rows'], $ca['rows_with_key'] + $ca['empty_rows']),
                $check('rows_b', 'linhas_B = com identificador + sem identificador', $cb['rows'], $cb['rows_with_key'] + $cb['empty_rows']),
                $check('keyed_a', 'com identificador_A = distintos_A + repetidas_A', $ca['rows_with_key'], $ca['distinct'] + $ca['repeated_rows']),
                $check('keyed_b', 'com identificador_B = distintos_B + repetidas_B', $cb['rows_with_key'], $cb['distinct'] + $cb['repeated_rows']),
                $check('net', 'distintos_A − distintos_B = only_a − only_b', $ca['distinct'] - $cb['distinct'], $onlyA - $onlyB),
                $check('explained_a', 'explicações de only_a = only_a', array_sum($explained['a']), $onlyA),
                $check('explained_b', 'explicações de only_b = only_b', array_sum($explained['b']), $onlyB),
                $check('identities', 'identidades classificadas = shared + shared_by_rule + only_a + only_b', count($identities), $shared + $byRule + $onlyA + $onlyB),
            ],
        ];
    }

    private function verify(array $checks): void
    {
        $failed = array_values(array_filter($checks, fn (array $check) => ! $check['holds']));
        if ($failed !== []) {
            throw new DomainError('comparison.inconsistent', 'A reconciliação não fechou e foi recusada: '.implode('; ', array_column($failed, 'formula')).'.', 500, ['checks' => $failed]);
        }
    }
}
