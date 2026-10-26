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
        $grouped = null;
        $dotDecimals = 0;
        $localFormat = 0;
        $localMarked = 0;

        $invalidDate = null;

        foreach ($nonNull as $value) {
            if ($invalidDate === null && preg_match('/^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/', $value) === 1 && ValueParser::date($value) === null) {
                $invalidDate = $value;
            }
            if (preg_match('/^[+-]?[1-9]\d{0,2}\.\d{3}$/', $value) === 1) {
                $grouped ??= $value;
            } elseif (preg_match('/^[+-]?\d+\.\d+$/', $value) === 1) {
                $dotDecimals++;
            }
            if (preg_match('/^[+-]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/', $value) === 1) {
                $localFormat++;
                if (str_contains($value, ',') || substr_count($value, '.') > 1) {
                    $localMarked++;
                }
            }
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
        $ambiguous = $type === 'number' && $grouped !== null && $dotDecimals === 0;
        if ($ambiguous) {
            $type = 'text';
        }

        $profile = [
            'non_null' => $total,
            'nulls' => $nullCount,
            'distinct' => $distinct,
            'unique' => $total > 0 && $distinct === $total,
            'samples' => array_map(fn ($sample) => mb_strlen((string) $sample) > 80 ? mb_substr((string) $sample, 0, 79).'…' : (string) $sample, array_slice(array_keys($counts), 0, 5)),
            'leading_zero_values' => $leadingZeros,
            'fixed_length' => count($lengths) === 1 ? (int) array_key_first($lengths) : null,
            'type_reason' => match (true) {
                $ambiguous => "Valores como {$grouped} podem usar o ponto para separar milhares ou decimais. O Trace não escolhe: a coluna fica como texto e não entra em somas.",
                $total > 0 && $localFormat === $total && $localMarked > 0 => 'Números com vírgula decimal ou ponto de milhar (como 1.234,56): o Trace lê só o ponto como decimal, então a coluna fica como texto e não entra em somas.',
                $type === 'text' && $dates > 0 && $dates * 2 >= $total => ($total - $dates).' de '.$total.' valores não são datas válidas'.($invalidDate !== null ? " (por exemplo, {$invalidDate})" : '').': a coluna fica como texto e não pode marcar vigência até que sejam corrigidos.',
                default => $this->reason($type, $total, $numbers),
            },
        ];

        if ($ambiguous) {
            $profile['decimal_ambiguous'] = true;
        }

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
