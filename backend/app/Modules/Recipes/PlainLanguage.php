<?php

namespace App\Modules\Recipes;

final class PlainLanguage
{
    public static function describe(array $steps, array $inputs): array
    {
        $base = self::dataset($inputs, 0);
        $unit = "registros de {$base}";
        $described = [];

        foreach ($steps as $step) {
            $inputUnit = $unit;
            $plain = match ($step['type']) {
                'filter' => self::filter($step, $inputs, $base),
                'join' => self::join($step, $inputs),
                'aggregate' => self::aggregate($step, $inputs),
                default => ['headline' => '', 'drops' => []],
            };

            $unit = match ($step['type']) {
                'join' => 'registros de '.self::dataset($inputs, $step['probe']['input']).' ligados a '.self::dataset($inputs, $step['lookup']['input']),
                'aggregate' => 'grupos',
                default => $unit,
            };

            $described[$step['position']] = $plain + ['input_unit' => $inputUnit, 'unit' => $unit];
        }

        return $described;
    }

    private static function filter(array $step, array $inputs, string $base): array
    {
        $phrases = array_map(fn (array $c) => self::keep($c, $inputs), $step['conditions']);
        $foreign = array_values(array_unique(array_filter(array_map(
            fn (array $c) => ($c['input'] ?? 0) !== 0 ? self::dataset($inputs, $c['input']) : null,
            $step['conditions'],
        ))));
        $subject = $foreign === [] ? $base : "{$base} de ".implode(' e ', $foreign);
        $single = count($step['conditions']) === 1 ? $step['conditions'][0] : null;
        $validity = collect($step['conditions'])->first(fn (array $c) => ($c['kind'] ?? null) === 'validity');
        $extra = $validity === null ? [] : [
            'validity_out' => 'fora do período pela leitura escolhida',
            'validity_undetermined' => 'vigência impossível de determinar',
        ];

        if ($single !== null && $validity !== null) {
            return [
                'headline' => "Mantém {$subject} que ".self::validityPhrase($validity),
                'drops' => $extra,
            ];
        }

        return [
            'headline' => "Mantém {$subject} com ".implode(' e ', $phrases),
            'drops' => $extra + [
                'condition_false' => $single ? self::reject($single, $inputs) : 'não atendem a todas as condições',
                'null_value' => $single ? 'sem '.self::column($single, $inputs) : 'valor vazio',
                'unconvertible' => $single ? self::column($single, $inputs).($single['value_type'] === 'date' ? ' não é uma data válida' : ' não é um número') : 'valor fora do formato',
            ],
        ];
    }

    private static function validityPhrase(array $c): string
    {
        $from = self::value($c['from'], 'date');
        $to = self::value($c['to'], 'date');

        return match ($c['reading']) {
            'started' => "começaram de {$from} a {$to}",
            'active_any' => "estiveram vigentes em algum momento de {$from} a {$to}",
            default => "estavam vigentes em {$to}",
        };
    }

    private static function join(array $step, array $inputs): array
    {
        $probe = self::dataset($inputs, $step['probe']['input']);
        $lookup = self::dataset($inputs, $step['lookup']['input']);
        $probeColumn = self::columnLabel($inputs, $step['probe']['input'], $step['probe']['column']);
        $lookupColumn = self::columnLabel($inputs, $step['lookup']['input'], $step['lookup']['column']);
        $policy = $step['join_type'] === 'left' ? "quem não encontra par continua, sem {$lookup}" : 'quem não encontra par sai';

        return [
            'headline' => "Liga {$probe} a {$lookup} por {$probeColumn} = {$lookupColumn}; {$policy}",
            'drops' => [
                'no_match' => "sem par em {$lookup}",
                'null_key' => "sem {$probeColumn}",
            ],
        ];
    }

    private static function aggregate(array $step, array $inputs): array
    {
        $groups = implode(' e ', array_map(fn (array $g) => self::columnLabel($inputs, $g['input'], $g['column']), $step['group_by']));
        $sums = array_values(array_filter($step['measures'], fn (array $m) => $m['function'] === 'sum'));
        $counts = array_filter($step['measures'], fn (array $m) => $m['function'] === 'count');
        $distinct = array_values(array_filter($step['measures'], fn (array $m) => $m['function'] === 'count_distinct'));
        $parts = [];
        if ($sums !== []) {
            $parts[] = 'Soma '.implode(' e ', array_map(fn (array $m) => self::columnLabel($inputs, $m['input'], $m['column']), $sums));
        }
        if ($distinct !== []) {
            $parts[] = ($parts === [] ? 'Conta' : 'conta').' valores diferentes de '.implode(' e ', array_map(fn (array $m) => self::columnLabel($inputs, $m['input'], $m['column']), $distinct));
        }
        $headline = $parts === []
            ? "Conta os registros por {$groups}"
            : implode(' e ', $parts)." por {$groups}".($counts === [] ? '' : ' e conta os registros');

        return ['headline' => $headline, 'drops' => []];
    }

    private static function keep(array $c, array $inputs): string
    {
        if (($c['kind'] ?? null) === 'validity') {
            return 'vigência de quem '.self::validityPhrase($c);
        }

        $column = self::column($c, $inputs);
        $value = fn (mixed $v) => self::value($v, $c['value_type']);

        return match ($c['operator']) {
            'eq' => $c['value_type'] === 'text' ? "{$column} {$value($c['value'])}" : "{$column} igual a {$value($c['value'])}",
            'neq' => "{$column} diferente de {$value($c['value'])}",
            'gt' => "{$column} acima de {$value($c['value'])}",
            'gte' => "{$column} a partir de {$value($c['value'])}",
            'lt' => "{$column} abaixo de {$value($c['value'])}",
            'lte' => "{$column} até {$value($c['value'])}",
            'between' => "{$column} de {$value($c['value'][0])} a {$value($c['value'][1])}",
            'in' => "{$column} ".self::list(array_map($value, $c['value']), 'ou'),
            'not_in' => "{$column} fora de ".self::list(array_map($value, $c['value']), 'e'),
            'contains' => "{$column} contendo {$value($c['value'])}",
            'is_null' => "{$column} vazio",
            'is_not_null' => "{$column} preenchido",
            default => $column,
        };
    }

    private static function reject(array $c, array $inputs): string
    {
        $column = self::column($c, $inputs);
        $value = fn (mixed $v) => self::value($v, $c['value_type']);

        return match ($c['operator']) {
            'eq' => "{$column} diferente de {$value($c['value'])}",
            'neq' => "{$column} igual a {$value($c['value'])}",
            'gt' => "{$column} até {$value($c['value'])}",
            'gte' => "{$column} abaixo de {$value($c['value'])}",
            'lt' => "{$column} a partir de {$value($c['value'])}",
            'lte' => "{$column} acima de {$value($c['value'])}",
            'between' => "{$column} fora de {$value($c['value'][0])} a {$value($c['value'][1])}",
            'in' => "{$column} fora da lista",
            'not_in' => "{$column} na lista excluída",
            'contains' => "{$column} sem {$value($c['value'])}",
            'is_null' => "{$column} preenchido",
            default => 'não atendem à condição',
        };
    }

    private static function value(mixed $value, string $type): string
    {
        if ($value === null) {
            return 'vazio';
        }

        $value = (string) $value;

        return match ($type) {
            'date' => preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1 ? "{$m[3]}/{$m[2]}/{$m[1]}" : $value,
            'number' => self::number($value),
            default => "“{$value}”",
        };
    }

    private static function number(string $value): string
    {
        $negative = str_starts_with($value, '-');
        [$integer, $fraction] = array_pad(explode('.', ltrim($value, '-'), 2), 2, null);
        $grouped = number_format((float) $integer, 0, ',', '.');

        return ($negative ? '-' : '').$grouped.($fraction !== null ? ",{$fraction}" : '');
    }

    private static function list(array $values, string $last): string
    {
        if (count($values) <= 1) {
            return implode('', $values);
        }

        return implode(', ', array_slice($values, 0, -1))." {$last} ".end($values);
    }

    private static function column(array $condition, array $inputs): string
    {
        return self::columnLabel($inputs, $condition['input'] ?? 0, $condition['column']);
    }

    private static function columnLabel(array $inputs, int $input, string $key): string
    {
        foreach ($inputs[$input]['columns'] ?? [] as $column) {
            if ($column['key'] === $key) {
                return $column['label'];
            }
        }

        return $key;
    }

    private static function dataset(array $inputs, int $input): string
    {
        return mb_strtolower($inputs[$input]['dataset_name'] ?? $inputs[$input]['alias'] ?? 'registros');
    }
}
