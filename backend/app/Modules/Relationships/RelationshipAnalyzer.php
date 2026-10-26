<?php

namespace App\Modules\Relationships;

use App\Modules\Datasets\DatasetColumn;
use App\Modules\Datasets\DatasetVersion;

final class RelationshipAnalyzer
{
    public function __construct(private readonly ColumnValueIndex $index) {}

    public function evaluate(DatasetVersion $fromVersion, DatasetColumn $fromColumn, DatasetVersion $toVersion, DatasetColumn $toColumn): array
    {
        $from = $this->index->counts($fromVersion->id, $fromColumn->key);
        $to = $this->index->counts($toVersion->id, $toColumn->key);
        $fromNulls = $this->index->nulls($fromVersion->id, $fromColumn->key);
        $toNulls = $this->index->nulls($toVersion->id, $toColumn->key);

        $fromNonNull = array_sum($from);
        $toNonNull = array_sum($to);
        $matchedRows = 0;
        $matchedDistinct = 0;
        $unmatched = [];

        foreach ($from as $key => $count) {
            if (isset($to[$key])) {
                $matchedRows += $count;
                $matchedDistinct++;
            } else {
                $unmatched[$key] = $count;
            }
        }

        arsort($unmatched);
        $unreferenced = array_diff_key($to, $from);
        $fromUnique = $fromNonNull > 0 && count($from) === $fromNonNull;
        $toUnique = $toNonNull > 0 && count($to) === $toNonNull;
        $toDuplicates = count(array_filter($to, fn (int $count) => $count > 1));
        $ratio = $fromNonNull > 0 ? $matchedRows / $fromNonNull : 0.0;

        $fromDataset = $fromVersion->dataset;
        $toDataset = $toVersion->dataset;
        $name = NameHeuristics::evaluate($fromColumn->key, $toDataset->key, $toColumn->key);
        $types = $this->typeCompatibility($fromColumn, $toColumn);
        $cardinality = $this->cardinality($fromUnique, $toUnique);
        $nearMatches = $this->nearMatches(array_keys($unmatched), array_keys($to));

        $score = round(
            0.55 * $ratio + 0.2 * ($toUnique ? 1 : 0) + 0.15 * ($name['matched'] ? 1 : 0) + 0.1 * ($types['compatible'] ? 1 : 0),
            4,
        );

        $evidence = [
            'from' => $this->side($fromDataset->id, $fromDataset->key, $fromDataset->name, $fromVersion, $fromColumn, $fromNonNull, $fromNulls, count($from), $fromUnique),
            'to' => $this->side($toDataset->id, $toDataset->key, $toDataset->name, $toVersion, $toColumn, $toNonNull, $toNulls, count($to), $toUnique) + [
                'duplicate_values' => $toDuplicates,
            ],
            'match' => [
                'matched_rows' => $matchedRows,
                'unmatched_rows' => $fromNonNull - $matchedRows,
                'null_rows' => $fromNulls,
                'match_ratio' => round($ratio, 4),
                'matched_distinct' => $matchedDistinct,
                'unmatched_distinct' => count($unmatched),
                'unmatched_samples' => array_map(
                    fn (string $key) => ['value' => ColumnValueIndex::value($key), 'rows' => $unmatched[$key]],
                    array_slice(array_keys($unmatched), 0, 8),
                ),
            ],
            'unreferenced' => [
                'rows' => array_sum($unreferenced),
                'samples' => array_map(fn (string $key) => ColumnValueIndex::value($key), array_slice(array_keys($unreferenced), 0, 8)),
            ],
            'near_matches' => $nearMatches,
            'join_effect' => $this->joinEffect($from, $to, $fromNonNull, $fromNulls, $matchedRows),
            'cardinality' => $cardinality,
            'name' => $name,
            'types' => $types,
            'score' => $score,
        ];

        $evidence['statements'] = $this->statements($evidence);

        return $evidence;
    }

    /**
     * @param  array<string, int>  $from
     * @param  array<string, int>  $to
     * @return array<string, mixed>
     */
    private function joinEffect(array $from, array $to, int $fromNonNull, int $fromNulls, int $matchedRows): array
    {
        $innerRows = 0;
        $multipliedRows = 0;
        $extraByKey = [];

        foreach ($from as $key => $count) {
            $copies = $to[$key] ?? 0;
            if ($copies === 0) {
                continue;
            }
            $innerRows += $count * $copies;
            if ($copies > 1) {
                $multipliedRows += $count;
                $extraByKey[$key] = $count * ($copies - 1);
            }
        }

        arsort($extraByKey);
        $unmatchedRows = $fromNonNull - $matchedRows;

        return [
            'source_rows' => $fromNonNull + $fromNulls,
            'matched_rows' => $matchedRows,
            'unmatched_rows' => $unmatchedRows,
            'null_key_rows' => $fromNulls,
            'inner_rows' => $innerRows,
            'left_rows' => $innerRows + $unmatchedRows + $fromNulls,
            'extra_rows' => $innerRows - $matchedRows,
            'multiplied_rows' => $multipliedRows,
            'repeated_keys' => count($extraByKey),
            'samples' => array_map(
                fn (string $key) => [
                    'value' => ColumnValueIndex::value($key),
                    'target_rows' => $to[$key],
                    'source_rows' => $from[$key],
                    'extra_rows' => $extraByKey[$key],
                ],
                array_slice(array_keys($extraByKey), 0, 8),
            ),
        ];
    }

    private function side(string $datasetId, string $datasetKey, string $datasetName, DatasetVersion $version, DatasetColumn $column, int $nonNull, int $nulls, int $distinct, bool $unique): array
    {
        return [
            'dataset_id' => $datasetId,
            'dataset_key' => $datasetKey,
            'dataset_name' => $datasetName,
            'version_id' => $version->id,
            'version_number' => $version->number,
            'column' => $column->key,
            'column_label' => $column->label,
            'type' => $column->inferred_type,
            'rows' => $nonNull + $nulls,
            'non_null' => $nonNull,
            'nulls' => $nulls,
            'distinct' => $distinct,
            'unique' => $unique,
        ];
    }

    private function cardinality(bool $fromUnique, bool $toUnique): string
    {
        return match (true) {
            $fromUnique && $toUnique => 'one_to_one',
            ! $fromUnique && $toUnique => 'many_to_one',
            $fromUnique && ! $toUnique => 'one_to_many',
            default => 'many_to_many',
        };
    }

    private function typeCompatibility(DatasetColumn $from, DatasetColumn $to): array
    {
        $a = $from->inferred_type;
        $b = $to->inferred_type;
        $lengthA = $from->profile['fixed_length'] ?? null;
        $lengthB = $to->profile['fixed_length'] ?? null;

        if ($a === 'date' xor $b === 'date') {
            return ['compatible' => false, 'detail' => 'Uma coluna foi lida como data e a outra não.'];
        }

        if ($a === $b && $a === 'identifier' && $lengthA !== null && $lengthA === $lengthB) {
            return ['compatible' => true, 'detail' => "Ambas foram lidas como identificadores textuais com {$lengthA} caracteres."];
        }

        if ($a === $b) {
            return ['compatible' => true, 'detail' => 'As duas colunas têm o mesmo tipo inferido.'];
        }

        if (in_array($a, ['identifier', 'number'], true) && in_array($b, ['identifier', 'number'], true)) {
            return ['compatible' => true, 'detail' => 'Tipos numéricos com formatação diferente: a comparação é feita pelo texto exato, sem converter.'];
        }

        return ['compatible' => true, 'detail' => 'A comparação é feita pelo texto exato dos valores.'];
    }

    private function nearMatches(array $unmatchedKeys, array $toKeys): array
    {
        $byStripped = [];
        $byFolded = [];
        foreach ($toKeys as $key) {
            $value = ColumnValueIndex::value($key);
            $byStripped[ltrim($value, '0')] ??= $value;
            $byFolded[mb_strtolower(preg_replace('/\s+/', ' ', $value))] ??= $value;
        }

        $found = [];
        foreach ($unmatchedKeys as $key) {
            $value = ColumnValueIndex::value($key);
            $stripped = ltrim($value, '0');
            $folded = mb_strtolower(preg_replace('/\s+/', ' ', $value));

            if ($stripped !== '' && isset($byStripped[$stripped])) {
                $found[] = ['value' => $value, 'candidate' => $byStripped[$stripped], 'kind' => 'leading_zeros'];
            } elseif (isset($byFolded[$folded])) {
                $found[] = ['value' => $value, 'candidate' => $byFolded[$folded], 'kind' => 'case_or_spacing'];
            }

            if (count($found) >= 10) {
                break;
            }
        }

        return $found;
    }

    private function statements(array $e): array
    {
        $from = "{$e['from']['dataset_key']}.{$e['from']['column']}";
        $to = "{$e['to']['dataset_key']}.{$e['to']['column']}";
        $pct = number_format($e['match']['match_ratio'] * 100, 1, ',', '.');
        $lines = [];

        $lines[] = ['kind' => 'match', 'text' => "{$pct}% dos valores não nulos de {$from} encontram correspondência exata em {$to}."];

        $lines[] = $e['to']['unique']
            ? ['kind' => 'uniqueness', 'text' => "A coluna {$to} possui valores únicos."]
            : ['kind' => 'uniqueness', 'text' => "A coluna {$to} não possui valores únicos: {$e['to']['duplicate_values']} valores se repetem, o que pode multiplicar registros numa junção."];

        $lines[] = ['kind' => 'cardinality', 'text' => 'Cardinalidade provável: '.self::cardinalityLabel($e['cardinality']).'.'];

        $effect = $e['join_effect'];
        if ($effect['extra_rows'] > 0) {
            $lines[] = ['kind' => 'multiplicity', 'text' => 'Ligar '.$e['from']['dataset_key'].' a '.$e['to']['dataset_key'].' transformaria '.self::plural($effect['matched_rows'], 'linha com par', 'linhas com par').' em '.number_format($effect['inner_rows'], 0, ',', '.').': '.self::plural($effect['extra_rows'], 'linha a mais', 'linhas a mais').', por causa de '.self::plural($effect['repeated_keys'], 'id repetido', 'ids repetidos').' que '.($effect['repeated_keys'] === 1 ? 'é citado' : 'são citados').'.'];
        }

        if ($e['match']['unmatched_rows'] > 0) {
            $lines[] = ['kind' => 'unmatched', 'text' => self::plural($e['match']['unmatched_rows'], 'registro não encontrou', 'registros não encontraram')." correspondência ({$e['match']['unmatched_distinct']} valores distintos)."];
        }

        if ($e['match']['null_rows'] > 0) {
            $lines[] = ['kind' => 'nulls', 'text' => self::plural($e['match']['null_rows'], 'registro tem', 'registros têm')." {$from} vazio e não pode se relacionar."];
        }

        if ($e['unreferenced']['rows'] > 0) {
            $lines[] = ['kind' => 'unreferenced', 'text' => self::plural($e['unreferenced']['rows'], 'registro', 'registros')." de {$e['to']['dataset_key']} não são referenciados por nenhum registro de {$e['from']['dataset_key']}."];
        }

        foreach ($e['near_matches'] as $near) {
            $why = $near['kind'] === 'leading_zeros' ? 'se zeros à esquerda fossem ignorados' : 'se maiúsculas e espaços fossem ignorados';
            $lines[] = ['kind' => 'near_match', 'text' => "\"{$near['value']}\" corresponderia a \"{$near['candidate']}\" {$why}. O Trace não considera isso uma correspondência."];
        }

        $lines[] = ['kind' => 'name', 'text' => $e['name']['matched']
            ? "Indício pelo nome: {$e['name']['reason']} Isso, sozinho, não comprova a relação."
            : $e['name']['reason']];

        $lines[] = ['kind' => 'types', 'text' => $e['types']['detail']];

        return $lines;
    }

    public static function cardinalityLabel(string $cardinality): string
    {
        return match ($cardinality) {
            'one_to_one' => 'um para um',
            'many_to_one' => 'muitos para um',
            'one_to_many' => 'um para muitos',
            default => 'muitos para muitos',
        };
    }

    private static function plural(int $count, string $singular, string $plural): string
    {
        return $count === 1 ? "1 {$singular}" : number_format($count, 0, ',', '.')." {$plural}";
    }
}
