<?php

namespace App\Modules\Runs\Engine;

use App\Modules\Datasets\Import\ValueParser;
use Collator;

final class AggregateOperator
{
    public function apply(ExecutionContext $context, array $step, array $alive): array
    {
        $position = $step['position'];
        $groups = [];
        $ignored = [];

        foreach ($step['measures'] as $measure) {
            $ignored[$measure['name']] = ['null' => 0, 'unconvertible' => 0];
        }

        foreach ($alive as $tuple) {
            $keyValues = array_map(
                fn (array $group) => $context->value($tuple, $group['input'], $group['column']),
                $step['group_by'],
            );
            $groupKey = json_encode($keyValues, JSON_UNESCAPED_UNICODE);

            if (! isset($groups[$groupKey])) {
                $groups[$groupKey] = ['keys' => $keyValues, 'tuples' => [], 'sums' => [], 'counted' => []];
                foreach ($step['measures'] as $measure) {
                    $groups[$groupKey]['sums'][$measure['name']] = '0';
                    $groups[$groupKey]['counted'][$measure['name']] = 0;
                }
            }

            $groups[$groupKey]['tuples'][] = $tuple;

            foreach ($step['measures'] as $measure) {
                if ($measure['function'] !== 'sum') {
                    continue;
                }

                $raw = $context->value($tuple, $measure['input'], $measure['column']);
                $rowId = $context->tuples->source($tuple, $measure['input']);
                $detail = ['measure' => $measure['name'], 'alias' => $measure['alias'], 'column' => $measure['column'], 'value' => $raw, 'group' => $keyValues];

                if ($raw === null) {
                    $ignored[$measure['name']]['null']++;
                    $context->diagnose($position, 'aggregate.null_ignored', 'info', $rowId, $tuple, $detail);

                    continue;
                }

                $number = ValueParser::number($raw);
                if ($number === null) {
                    $ignored[$measure['name']]['unconvertible']++;
                    $context->diagnose($position, 'aggregate.unconvertible_ignored', 'warning', $rowId, $tuple, $detail);

                    continue;
                }

                $groups[$groupKey]['sums'][$measure['name']] = ValueParser::add($groups[$groupKey]['sums'][$measure['name']], $number);
                $groups[$groupKey]['counted'][$measure['name']]++;
            }
        }

        $ordered = array_values($groups);
        $types = array_map(fn (array $group) => $group['type'], $step['group_by']);
        $collator = class_exists(Collator::class) ? new Collator('pt_BR') : null;
        usort($ordered, fn (array $a, array $b) => $this->compareKeys($a['keys'], $b['keys'], $types, $collator));

        $results = [];
        foreach ($ordered as $index => $group) {
            $resultNo = $index + 1;
            $values = [];

            foreach ($step['group_by'] as $i => $groupBy) {
                $values[$groupBy['output']] = $group['keys'][$i];
            }

            foreach ($step['measures'] as $measure) {
                $values[$measure['name']] = $measure['function'] === 'count'
                    ? count($group['tuples'])
                    : ($group['counted'][$measure['name']] > 0 ? $group['sums'][$measure['name']] : null);
            }

            foreach ($group['tuples'] as $tuple) {
                $context->tuples->include($tuple, $resultNo);
            }

            $results[] = ['result_no' => $resultNo, 'values' => $values, 'contributor_count' => count($group['tuples'])];
        }

        $columns = [];
        foreach ($step['group_by'] as $groupBy) {
            $columns[] = [
                'key' => $groupBy['output'],
                'label' => $groupBy['output'],
                'role' => 'group_key',
                'type' => $groupBy['type'],
                'source' => ['alias' => $groupBy['alias'], 'column' => $groupBy['column'], 'input' => $groupBy['input']],
            ];
        }
        foreach ($step['measures'] as $measure) {
            $columns[] = [
                'key' => $measure['name'],
                'label' => $measure['name'],
                'role' => 'measure',
                'type' => 'number',
                'function' => $measure['function'],
                'source' => $measure['function'] === 'sum'
                    ? ['alias' => $measure['alias'], 'column' => $measure['column'], 'input' => $measure['input']]
                    : null,
            ];
        }

        return [$results, $columns, [
            'groups' => count($results),
            'aggregated_tuples' => count($alive),
            'ignored_values' => $ignored,
        ]];
    }

    private function compareKeys(array $a, array $b, array $types, ?Collator $collator): int
    {
        foreach ($a as $i => $left) {
            $right = $b[$i];
            if ($left === $right) {
                continue;
            }
            if ($left === null) {
                return 1;
            }
            if ($right === null) {
                return -1;
            }

            $type = $types[$i];
            if ($type === 'number') {
                $l = ValueParser::number($left);
                $r = ValueParser::number($right);
                if ($l !== null && $r !== null) {
                    $cmp = ValueParser::compareNumbers($l, $r);
                    if ($cmp !== 0) {
                        return $cmp;
                    }

                    continue;
                }
            }

            $cmp = $collator ? $collator->compare($left, $right) : strcmp($left, $right);
            if ($cmp !== 0) {
                return $cmp;
            }
        }

        return 0;
    }
}
