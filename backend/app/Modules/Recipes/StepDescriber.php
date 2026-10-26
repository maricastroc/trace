<?php

namespace App\Modules\Recipes;

final class StepDescriber
{
    public const OPERATORS = [
        'eq' => 'é igual a',
        'neq' => 'é diferente de',
        'gt' => 'é maior que',
        'gte' => 'é maior ou igual a',
        'lt' => 'é menor que',
        'lte' => 'é menor ou igual a',
        'between' => 'está entre',
        'in' => 'é um de',
        'not_in' => 'não é nenhum de',
        'contains' => 'contém',
        'is_null' => 'está vazio',
        'is_not_null' => 'está preenchido',
    ];

    public static function title(string $type): string
    {
        return match ($type) {
            'filter' => 'Filtro',
            'join' => 'Junção',
            'aggregate' => 'Agregação',
            default => $type,
        };
    }

    public static function describe(array $step): string
    {
        return match ($step['type']) {
            'filter' => 'Manter linhas em que '.implode(' e ', array_map(fn (array $c) => self::condition($c), $step['conditions'])),
            'join' => self::join($step),
            'aggregate' => self::aggregate($step),
            default => '',
        };
    }

    public static function condition(array $condition): string
    {
        if (($condition['kind'] ?? null) === 'validity') {
            return self::validity($condition);
        }

        $field = "{$condition['alias']}.{$condition['column']}";
        $operator = self::OPERATORS[$condition['operator']] ?? $condition['operator'];

        return match ($condition['operator']) {
            'is_null', 'is_not_null' => "{$field} {$operator}",
            'between' => "{$field} está entre ".self::value($condition['value'][0], $condition['value_type']).' e '.self::value($condition['value'][1], $condition['value_type']),
            'in', 'not_in' => "{$field} {$operator} ".implode(', ', array_map(fn ($v) => self::value($v, $condition['value_type']), $condition['value'])),
            default => "{$field} {$operator} ".self::value($condition['value'], $condition['value_type']),
        };
    }

    public static function validity(array $condition): string
    {
        $from = self::date($condition['from']);
        $to = self::date($condition['to']);
        $columns = isset($condition['start_column'])
            ? ' (vigência por '.$condition['start_column'].($condition['end_column']
                ? ' → '.$condition['end_column'].', fim '.(($condition['end_inclusive'] ?? true) ? 'incluído' : 'excluído')
                : ', sem coluna de fim').')'
            : '';

        $reading = match ($condition['reading']) {
            'started' => "começou entre {$from} e {$to}",
            'active_any' => "esteve vigente em algum dia entre {$from} e {$to}",
            default => "estava vigente em {$to}",
        };

        return "a linha de {$condition['alias']} {$reading}{$columns}";
    }

    public static function date(string $iso): string
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $iso, $m) === 1 ? "{$m[3]}/{$m[2]}/{$m[1]}" : $iso;
    }

    public static function value(mixed $value, string $type): string
    {
        if ($value === null) {
            return 'vazio';
        }

        return $type === 'text' ? '"'.$value.'"' : (string) $value;
    }

    private static function join(array $step): string
    {
        $type = $step['join_type'] === 'left' ? 'mantendo linhas sem correspondência' : 'somente linhas com correspondência';
        $probe = $step['probe'];
        $lookup = $step['lookup'];

        $copies = match (true) {
            ($step['direction'] ?? 'forward') === 'reverse' => ' · sentido inverso: uma linha pode virar várias',
            ($step['relationship_policy'] ?? null) !== null => ' · multiplicidade aceita: ids repetidos criam cópias',
            default => '',
        };

        return "Relacionar {$probe['alias']} com {$lookup['alias']} por {$probe['alias']}.{$probe['column']} = {$lookup['alias']}.{$lookup['column']} ({$type}){$copies}";
    }

    private static function aggregate(array $step): string
    {
        $groups = implode(', ', array_map(fn (array $g) => "{$g['alias']}.{$g['column']}", $step['group_by']));
        $measures = implode(' · ', array_map(fn (array $m) => match ($m['function']) {
            'count' => "contar linhas como {$m['name']}",
            'count_distinct' => "contar valores diferentes de {$m['alias']}.{$m['column']} como {$m['name']}",
            default => "somar {$m['alias']}.{$m['column']} como {$m['name']}",
        }, $step['measures']));

        return $groups === '' ? "Calcular sobre todas as linhas · {$measures}" : "Agrupar por {$groups} · {$measures}";
    }
}
