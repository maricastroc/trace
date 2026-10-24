<?php

namespace App\Modules\Runs\Engine;

use App\Modules\Datasets\Import\ValueParser;

final class FilterOperator
{
    public function apply(ExecutionContext $context, array $step, array $alive): array
    {
        $kept = [];
        $byReason = ['condition_false' => 0, 'null_value' => 0, 'unconvertible' => 0];
        $byCondition = array_fill(0, count($step['conditions']), 0);

        foreach ($alive as $tuple) {
            $failure = null;

            foreach ($step['conditions'] as $index => $condition) {
                $raw = $context->value($tuple, $condition['input'], $condition['column']);
                $reason = self::evaluate($condition, $raw);

                if ($reason !== null) {
                    $failure = [$index, $condition, $raw, $reason];
                    break;
                }
            }

            if ($failure === null) {
                $kept[] = $tuple;

                continue;
            }

            [$index, $condition, $raw, $reason] = $failure;
            $byReason[$reason]++;
            $byCondition[$index]++;

            $context->tuples->exclude($tuple, $step['position'], "filter.{$reason}", [
                'condition' => $index,
                'alias' => $condition['alias'],
                'column' => $condition['column'],
                'operator' => $condition['operator'],
                'expected' => $condition['value'],
                'value_type' => $condition['value_type'],
                'actual' => $raw,
                'source_row_id' => $context->tuples->source($tuple, $condition['input']),
            ]);
        }

        return [$kept, [
            'excluded_by_reason' => $byReason,
            'excluded_by_condition' => $byCondition,
        ]];
    }

    public static function evaluate(array $condition, ?string $raw): ?string
    {
        $operator = $condition['operator'];

        if ($operator === 'is_null') {
            return $raw === null ? null : 'condition_false';
        }

        if ($operator === 'is_not_null') {
            return $raw !== null ? null : 'null_value';
        }

        if ($raw === null) {
            return 'null_value';
        }

        $type = $condition['value_type'];
        $value = ValueParser::convert($raw, $type);

        if ($value === null) {
            return 'unconvertible';
        }

        $expected = $condition['value'];

        $passes = match ($operator) {
            'eq' => self::compare($value, $expected, $type) === 0,
            'neq' => self::compare($value, $expected, $type) !== 0,
            'gt' => self::compare($value, $expected, $type) > 0,
            'gte' => self::compare($value, $expected, $type) >= 0,
            'lt' => self::compare($value, $expected, $type) < 0,
            'lte' => self::compare($value, $expected, $type) <= 0,
            'between' => self::compare($value, $expected[0], $type) >= 0 && self::compare($value, $expected[1], $type) <= 0,
            'in' => in_array($value, $expected, true),
            'not_in' => ! in_array($value, $expected, true),
            'contains' => str_contains($value, $expected),
            default => false,
        };

        return $passes ? null : 'condition_false';
    }

    private static function compare(string $left, string $right, string $type): int
    {
        return match ($type) {
            'number' => ValueParser::compareNumbers($left, $right),
            default => strcmp($left, $right) <=> 0,
        };
    }
}
