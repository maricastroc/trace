<?php

namespace App\Modules\Datasets\Import;

final class ColumnProfiler
{
    public function profile(array $values): array
    {
        $nonNull = array_values(array_filter($values, fn (?string $value) => $value !== null));
        $counts = array_count_values($nonNull);
        $distinct = count($counts);
        $nullCount = count($values) - count($nonNull);

        $numbers = 0;
        $dates = 0;
        $leadingZeros = 0;
        $lengths = [];

        foreach ($nonNull as $value) {
            if (ValueParser::number($value) !== null) {
                $numbers++;
            }
            if (ValueParser::date($value) !== null) {
                $dates++;
            }
            if (ValueParser::hasLeadingZero($value)) {
                $leadingZeros++;
            }
            $lengths[mb_strlen($value)] = true;
        }

        $total = count($nonNull);
        $type = $this->inferType($total, $numbers, $dates, $leadingZeros);

        $profile = [
            'non_null' => $total,
            'nulls' => $nullCount,
            'distinct' => $distinct,
            'unique' => $total > 0 && $distinct === $total,
            'samples' => array_map('strval', array_slice(array_keys($counts), 0, 5)),
            'leading_zero_values' => $leadingZeros,
            'fixed_length' => count($lengths) === 1 ? (int) array_key_first($lengths) : null,
            'type_reason' => $this->reason($type, $total, $numbers),
        ];

        if ($type === 'number') {
            $normalized = array_map(fn (string $value) => ValueParser::number($value), $nonNull);
            usort($normalized, fn (string $a, string $b) => ValueParser::compareNumbers($a, $b));
            $profile['min'] = $normalized[0];
            $profile['max'] = $normalized[count($normalized) - 1];
        }

        if ($type === 'date') {
            $normalized = array_map(fn (string $value) => ValueParser::date($value), $nonNull);
            sort($normalized);
            $profile['min'] = $normalized[0];
            $profile['max'] = $normalized[count($normalized) - 1];
        }

        return ['type' => $type, 'profile' => $profile];
    }

    private function inferType(int $total, int $numbers, int $dates, int $leadingZeros): string
    {
        if ($total === 0) {
            return 'text';
        }

        if ($dates === $total) {
            return 'date';
        }

        if ($numbers === $total && $leadingZeros === 0) {
            return 'number';
        }

        if ($numbers === $total && $leadingZeros > 0) {
            return 'identifier';
        }

        return 'text';
    }

    private function reason(string $type, int $total, int $numbers): string
    {
        return match (true) {
            $total === 0 => 'Coluna sem valores preenchidos.',
            $type === 'identifier' => 'Valores numéricos com zeros à esquerda: preservados como texto.',
            $type === 'number' => 'Todos os valores preenchidos são números.',
            $type === 'date' => 'Todos os valores preenchidos são datas válidas.',
            $numbers > 0 && $numbers < $total => 'Mistura de números e texto: tratada como texto.',
            default => 'Valores textuais.',
        };
    }
}
