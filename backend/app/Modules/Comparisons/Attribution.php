<?php

namespace App\Modules\Comparisons;

use App\Modules\Support\Canonical;

final class Attribution
{
    private const WORDS = [
        'key' => 'a coluna identificadora',
        'version' => 'a versão dos dados',
        'period' => 'o período',
        'cut' => 'o recorte',
        'path' => 'o caminho das relações',
        'steps' => 'os passos da seleção',
    ];

    /**
     * @return array{kind: string, differences: list<string>, statement: string}
     */
    public static function of(SidePlan $a, SidePlan $b): array
    {
        if ($a->dataset->id !== $b->dataset->id) {
            return [
                'kind' => 'sources',
                'differences' => ['source'],
                'statement' => "Os lados vêm de tabelas diferentes ({$a->dataset->key} e {$b->dataset->key}). As diferenças são entre populações de origens diferentes: cada identidade sem par traz a própria explicação, mas não há uma causa única.",
            ];
        }

        $differences = [];
        if ($a->key !== $b->key) {
            $differences[] = 'key';
        }
        if ($a->versionId !== $b->versionId) {
            $differences[] = 'version';
        }

        if ($a->kind() === 'population' && $b->kind() === 'population') {
            if (! Canonical::same($a->definition['period'], $b->definition['period'])) {
                $differences[] = 'period';
            }
            $da = $a->definition['dimension'];
            $db = $b->definition['dimension'];
            if ($da !== null && $db !== null && $da['relationships'] !== $db['relationships']) {
                $differences[] = 'path';
            }
            if (($da['column'] ?? null) !== ($db['column'] ?? null) || ($da['value'] ?? null) !== ($db['value'] ?? null)) {
                $differences[] = 'cut';
            }
        } elseif (! Canonical::same(self::selection($a), self::selection($b))) {
            $differences[] = 'steps';
        }

        $list = implode(', ', array_map(fn (string $d) => self::WORDS[$d], $differences));
        [$kind, $statement] = match (true) {
            $differences === [] => ['identical', 'Os dois lados têm a mesma definição, a mesma versão e a mesma chave: não deveria haver diferença.'],
            $differences === ['version'] => ['versions', "Os lados diferem só na versão de {$a->dataset->key} (versão {$a->version->number} e versão {$b->version->number}). Toda diferença vem da mudança nos dados."],
            array_diff($differences, ['period', 'cut', 'steps']) === [] => ['criteria', "Os lados usam a mesma tabela, a mesma versão e a mesma chave, e diferem só em {$list}. Toda diferença vem desse critério de seleção."],
            $differences === ['path'] => ['relations', 'Os lados diferem só no caminho das relações até o recorte. Toda diferença vem desse caminho.'],
            $differences === ['key'] => ['keys', "Os lados usam colunas identificadoras diferentes ({$a->key} e {$b->key}) na mesma tabela."],
            default => ['mixed', "Os lados diferem em mais de um ponto ({$list}). Não é possível atribuir a diferença a uma causa só."],
        };

        return ['kind' => $kind, 'differences' => $differences, 'statement' => $statement];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function selection(SidePlan $side): array
    {
        $steps = $side->compiled?->steps ?? $side->run?->steps() ?? [];
        $selection = [];
        foreach ($steps as $step) {
            if ($step['type'] === 'aggregate') {
                continue;
            }
            $selection[] = $step['type'] === 'join'
                ? ['type' => 'join', 'relationship_id' => $step['relationship_id'], 'join_type' => $step['join_type']]
                : ['type' => 'filter', 'conditions' => array_map(
                    fn (array $c) => array_intersect_key($c, array_flip(['kind', 'alias', 'column', 'operator', 'value', 'value_type', 'reading', 'from', 'to'])),
                    $step['conditions'],
                )];
        }

        return $selection;
    }
}
