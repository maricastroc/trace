<?php

namespace App\Modules\Runs\Engine;

final class JoinOperator
{
    public function apply(ExecutionContext $context, array $step, array $alive): array
    {
        $position = $step['position'];
        $probe = $step['probe'];
        $lookup = $step['lookup'];
        $isLeft = $step['join_type'] === 'left';

        [$index, $lookupNullRows] = $this->buildIndex($context->rows[$lookup['input']], $lookup['column']);
        $strippedIndex = $this->nearIndex(array_keys($index));
        $matchedLookup = [];

        $output = [];
        $stats = [
            'matched_tuples' => 0,
            'unmatched_tuples' => 0,
            'null_key_tuples' => 0,
            'multiplied_tuples' => 0,
            'max_matches' => 0,
            'created_tuples' => 0,
            'lookup_rows' => count($context->rows[$lookup['input']]),
        ];

        foreach ($alive as $tuple) {
            $key = $context->value($tuple, $probe['input'], $probe['column']);
            $probeRow = $context->tuples->source($tuple, $probe['input']);
            $base = [
                'probe' => ['alias' => $probe['alias'], 'column' => $probe['column']],
                'lookup' => ['alias' => $lookup['alias'], 'column' => $lookup['column']],
                'key' => $key,
                'source_row_id' => $probeRow,
            ];

            if ($key === null) {
                $stats['null_key_tuples']++;
                $context->diagnose($position, 'join.null_key', 'warning', $probeRow, $tuple, $base);
                if ($isLeft) {
                    $output[] = $tuple;
                } else {
                    $context->tuples->exclude($tuple, $position, 'join.null_key', $base);
                }

                continue;
            }

            $matches = $index['v'.$key] ?? [];

            if ($matches === []) {
                $stats['unmatched_tuples']++;
                $detail = $base + ['near_match' => $this->nearMatch($key, $strippedIndex)];
                $context->diagnose($position, 'join.left_unmatched', 'warning', $probeRow, $tuple, $detail);
                if ($isLeft) {
                    $output[] = $tuple;
                } else {
                    $context->tuples->exclude($tuple, $position, 'join.no_match', $detail);
                }

                continue;
            }

            $stats['matched_tuples']++;
            $context->tuples->expand($tuple, $position);
            $sources = $context->tuples->sources[$tuple];

            foreach ($matches as $lookupRow) {
                $matchedLookup[$lookupRow] = true;
                $output[] = $context->tuples->create($tuple, $position, $sources + [$lookup['input'] => $lookupRow]);
                $stats['created_tuples']++;
            }

            if (count($matches) > 1) {
                $stats['multiplied_tuples']++;
                $context->diagnose($position, 'join.multiple_matches', 'warning', $probeRow, $tuple, $base + [
                    'matches' => count($matches),
                    'lookup_row_ids' => array_slice($matches, 0, 20),
                ]);
            }
            $stats['max_matches'] = max($stats['max_matches'], count($matches));

            $context->guardTupleLimit($position);
        }

        $unreferenced = 0;
        foreach ($index as $key => $rowIds) {
            foreach ($rowIds as $rowId) {
                if (! isset($matchedLookup[$rowId])) {
                    $unreferenced++;
                    $context->diagnose($position, 'join.right_unmatched', 'info', $rowId, null, [
                        'probe' => ['alias' => $probe['alias'], 'column' => $probe['column']],
                        'lookup' => ['alias' => $lookup['alias'], 'column' => $lookup['column']],
                        'key' => substr($key, 1),
                    ]);
                }
            }
        }

        foreach ($lookupNullRows as $rowId) {
            $context->diagnose($position, 'join.lookup_null_key', 'info', $rowId, null, [
                'lookup' => ['alias' => $lookup['alias'], 'column' => $lookup['column']],
            ]);
        }

        $stats['unreferenced_lookup_rows'] = $unreferenced;
        $stats['lookup_null_key_rows'] = count($lookupNullRows);
        $stats['excluded_by_reason'] = $isLeft
            ? ['no_match' => 0, 'null_key' => 0]
            : ['no_match' => $stats['unmatched_tuples'], 'null_key' => $stats['null_key_tuples']];

        return [$output, $stats];
    }

    private function buildIndex(array $rows, string $column): array
    {
        $index = [];
        $nullRows = [];

        foreach ($rows as $rowId => $values) {
            $key = $values[$column] ?? null;
            if ($key === null) {
                $nullRows[] = $rowId;

                continue;
            }
            $index['v'.$key][] = $rowId;
        }

        return [$index, $nullRows];
    }

    private function nearIndex(array $keys): array
    {
        $near = [];
        foreach ($keys as $key) {
            $value = substr($key, 1);
            $stripped = ltrim($value, '0');
            if ($stripped !== '') {
                $near['z'.$stripped] ??= $value;
            }
            $near['f'.mb_strtolower($value)] ??= $value;
        }

        return $near;
    }

    private function nearMatch(string $key, array $near): ?array
    {
        $stripped = ltrim($key, '0');
        if ($stripped !== '' && isset($near['z'.$stripped])) {
            return ['candidate' => $near['z'.$stripped], 'kind' => 'leading_zeros'];
        }

        if (isset($near['f'.mb_strtolower($key)])) {
            return ['candidate' => $near['f'.mb_strtolower($key)], 'kind' => 'case_or_spacing'];
        }

        return null;
    }
}
