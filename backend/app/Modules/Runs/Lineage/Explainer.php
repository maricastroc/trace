<?php

namespace App\Modules\Runs\Lineage;

use App\Modules\Recipes\StepDescriber;

final class Explainer
{
    public static function exclusion(?string $code, array $detail): string
    {
        return match ($code) {
            'filter.condition_false' => self::filterFalse($detail),
            'filter.null_value' => "{$detail['alias']}.{$detail['column']} está vazio, mas a regra exige: ".self::rule($detail).'.',
            'filter.unconvertible' => "{$detail['alias']}.{$detail['column']} = \"{$detail['actual']}\" não pôde ser interpretado como ".self::typeName($detail['value_type']).'; a condição não pôde ser verificada.',
            'join.no_match' => self::noMatch($detail),
            'join.null_key' => "{$detail['probe']['alias']}.{$detail['probe']['column']} está vazio; não há chave para relacionar com {$detail['lookup']['alias']}.",
            default => 'Registro excluído.',
        };
    }

    public static function diagnostic(string $code, array $detail): string
    {
        return match ($code) {
            'join.left_unmatched' => self::noMatch($detail),
            'join.null_key' => "{$detail['probe']['alias']}.{$detail['probe']['column']} está vazio; o registro não pôde ser relacionado.",
            'join.right_unmatched' => "Nenhum registro que chegou à junção tem {$detail['probe']['alias']}.{$detail['probe']['column']} = \"{$detail['key']}\"; este registro de {$detail['lookup']['alias']} não foi relacionado.",
            'join.lookup_null_key' => "{$detail['lookup']['alias']}.{$detail['lookup']['column']} está vazio; este registro não pode ser encontrado pela junção.",
            'join.multiple_matches' => "A chave \"{$detail['key']}\" corresponde a {$detail['matches']} registros de {$detail['lookup']['alias']}; o registro foi multiplicado por {$detail['matches']}.",
            'aggregate.null_ignored' => "{$detail['alias']}.{$detail['column']} está vazio e foi ignorado na soma de {$detail['measure']}.",
            'aggregate.unconvertible_ignored' => "{$detail['alias']}.{$detail['column']} = \"{$detail['value']}\" não é um número e foi ignorado na soma de {$detail['measure']}.",
            default => $code,
        };
    }

    public static function codeLabel(string $code): string
    {
        return match ($code) {
            'filter.condition_false' => 'Não atende à condição',
            'filter.null_value' => 'Valor vazio',
            'filter.unconvertible' => 'Valor não interpretável',
            'join.no_match' => 'Sem correspondência',
            'join.null_key' => 'Chave vazia',
            'join.left_unmatched' => 'Sem correspondência',
            'join.right_unmatched' => 'Não referenciado',
            'join.lookup_null_key' => 'Chave vazia no destino',
            'join.multiple_matches' => 'Múltiplas correspondências',
            'aggregate.null_ignored' => 'Vazio ignorado na soma',
            'aggregate.unconvertible_ignored' => 'Não numérico ignorado na soma',
            default => $code,
        };
    }

    private static function filterFalse(array $detail): string
    {
        $actual = $detail['actual'] === null ? 'vazio' : StepDescriber::value($detail['actual'], $detail['value_type']);

        return "{$detail['alias']}.{$detail['column']} = {$actual}, mas a regra exige: ".self::rule($detail).'.';
    }

    private static function rule(array $detail): string
    {
        return StepDescriber::condition([
            'alias' => $detail['alias'],
            'column' => $detail['column'],
            'operator' => $detail['operator'],
            'value' => $detail['expected'],
            'value_type' => $detail['value_type'],
        ]);
    }

    private static function noMatch(array $detail): string
    {
        $text = "Nenhum registro de {$detail['lookup']['alias']} tem {$detail['lookup']['column']} = \"{$detail['key']}\".";
        $near = $detail['near_match'] ?? null;

        if ($near !== null) {
            $why = $near['kind'] === 'leading_zeros' ? 'se zeros à esquerda fossem ignorados' : 'se maiúsculas e espaços fossem ignorados';
            $text .= " Existe \"{$near['candidate']}\", que corresponderia {$why}; o Trace não trata isso como correspondência.";
        }

        return $text;
    }

    private static function typeName(string $type): string
    {
        return match ($type) {
            'number' => 'número',
            'date' => 'data',
            default => 'texto',
        };
    }
}
