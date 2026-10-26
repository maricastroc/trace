<?php

namespace App\Modules\Comparisons;

use App\Modules\Relationships\Relationship;
use App\Modules\Relationships\RelationshipStanding;

final class Equivalence
{
    public const SAME_FIELD = 'same_field';

    public const RELATION = 'relation';

    public const DECLARED = 'declared';

    public const UNCONFIRMED = 'unconfirmed';

    public const READING_SAME_FIELD = 'same_field';

    public const READING_REGISTRY = 'registry_references';

    public const READING_UNKNOWN = 'unknown';

    /**
     * @return array{status: string, a: array<string, string>, b: array<string, string>, relationship_id: string|null, relationship_standing: string|null, statement: string, reading: array<string, mixed>}
     */
    public static function of(SidePlan $a, SidePlan $b, ?Relationship $relationship, mixed $declared): array
    {
        $fieldA = self::field($a);
        $fieldB = self::field($b);
        $standing = $relationship === null ? null : RelationshipStanding::of($relationship)['key'];
        $route = $relationship === null ? null : "{$relationship->fromDataset->key}.{$relationship->from_column} → {$relationship->toDataset->key}.{$relationship->to_column}";
        $link = self::link($a, $b, $relationship, $standing);

        [$status, $statement] = match (true) {
            $a->dataset->id === $b->dataset->id && $a->key === $b->key => [
                self::SAME_FIELD,
                "Os dois lados usam a mesma coluna, {$fieldA['name']}. A correspondência vem da própria definição.",
            ],
            $link['gap'] === null => [
                self::RELATION,
                "A relação {$route} foi confirmada no Mapa: cada valor de {$link['from']} aponta para um único registro de {$link['table']} pela coluna {$link['to']}, que não se repete. Os dois lados usam, portanto, os mesmos identificadores.",
            ],
            self::matches($declared, $a, $b) => [
                self::DECLARED,
                "Você declarou que {$fieldA['name']} e {$fieldB['name']} identificam a mesma entidade. O Trace não verificou essa equivalência.",
            ],
            default => [self::UNCONFIRMED, self::gapStatement($link, $route, $standing, $fieldA['name'], $fieldB['name'])],
        };

        return [
            'status' => $status,
            'a' => $fieldA,
            'b' => $fieldB,
            'relationship_id' => $relationship?->id,
            'relationship_standing' => $standing,
            'statement' => $statement,
            'reading' => self::reading($status, $a, $link),
        ];
    }

    public static function matches(mixed $declared, SidePlan $a, SidePlan $b): bool
    {
        return is_array($declared)
            && ($declared['a']['dataset_id'] ?? null) === $a->dataset->id
            && ($declared['a']['key'] ?? null) === $a->key
            && ($declared['b']['dataset_id'] ?? null) === $b->dataset->id
            && ($declared['b']['key'] ?? null) === $b->key;
    }

    /**
     * @return array{a: array{dataset_id: string, key: string}, b: array{dataset_id: string, key: string}}
     */
    public static function declaration(SidePlan $a, SidePlan $b): array
    {
        return ['a' => ['dataset_id' => $a->dataset->id, 'key' => $a->key], 'b' => ['dataset_id' => $b->dataset->id, 'key' => $b->key]];
    }

    /**
     * @return array{gap: string|null, registry: string|null, from: string|null, to: string|null, table: string|null, entity: array{dataset: string, name: string}|null}
     */
    private static function link(SidePlan $a, SidePlan $b, ?Relationship $relationship, ?string $standing): array
    {
        $none = ['registry' => null, 'from' => null, 'to' => null, 'table' => null, 'entity' => null];
        if ($relationship === null) {
            return ['gap' => 'none'] + $none;
        }
        if ($relationship->status !== Relationship::CONFIRMED) {
            return ['gap' => $standing === RelationshipStanding::REJECTED ? 'rejected' : 'suggested'] + $none;
        }

        $registry = $relationship->to_dataset_id === $a->dataset->id && $relationship->to_column === $a->key ? 'a' : 'b';
        $target = $registry === 'a' ? $a : $b;
        $source = $registry === 'a' ? $b : $a;
        $link = [
            'registry' => $registry,
            'from' => "{$source->dataset->key}.{$source->key}",
            'to' => "{$target->dataset->key}.{$target->key}",
            'table' => $target->dataset->key,
            'entity' => ['dataset' => $target->dataset->key, 'name' => $target->dataset->name],
        ];

        $gap = match (true) {
            $relationship->policy === Relationship::ACCEPT_MULTIPLICITY => 'multiplicity',
            ! self::unique($target) => 'target_repeats',
            $standing !== RelationshipStanding::CONFIRMED => 'review',
            self::unique($source) => 'one_to_one',
            default => null,
        };

        return ['gap' => $gap] + $link;
    }

    /**
     * @param  array{gap: string|null, from: string|null, to: string|null}  $link
     */
    private static function gapStatement(array $link, ?string $route, ?string $standing, string $a, string $b): string
    {
        return match ($link['gap']) {
            'multiplicity', 'target_repeats' => "A relação {$route} está confirmada no Mapa, mas {$link['to']} tem valores repetidos: ela não identifica um registro único. A relação não basta para dizer que {$a} e {$b} identificam a mesma entidade.",
            'one_to_one' => "A relação {$route} está confirmada no Mapa, mas {$link['from']} também não se repete: uma relação um para um pode ligar entidades diferentes. Confirme se {$a} e {$b} identificam a mesma entidade.",
            'review' => "A relação {$route} está em revisão no Mapa. Enquanto isso, ela não basta para dizer que {$a} e {$b} identificam a mesma entidade.",
            'rejected' => "A relação {$route} foi rejeitada no Mapa. Confirme só se os valores de {$a} e {$b} identificam a mesma entidade.",
            'suggested' => "A relação {$route} do Mapa sugere estas colunas, mas ninguém confirmou que os valores identificam a mesma entidade.",
            default => "Nenhuma evidência liga {$a} a {$b}. Confirme que os valores identificam a mesma entidade.",
        };
    }

    /**
     * @param  array{gap: string|null, registry: string|null, entity: array{dataset: string, name: string}|null}  $link
     * @return array{kind: string, registry: string|null, entity: array{dataset: string, name: string}|null, key_unique: bool|null}
     */
    private static function reading(string $status, SidePlan $a, array $link): array
    {
        if ($status === self::SAME_FIELD) {
            return ['kind' => self::READING_SAME_FIELD, 'registry' => null, 'entity' => ['dataset' => $a->dataset->key, 'name' => $a->dataset->name], 'key_unique' => self::unique($a)];
        }
        if ($link['registry'] !== null && in_array($link['gap'], [null, 'one_to_one'], true) && in_array($status, [self::RELATION, self::DECLARED], true)) {
            return ['kind' => self::READING_REGISTRY, 'registry' => $link['registry'], 'entity' => $link['entity'], 'key_unique' => true];
        }

        return ['kind' => self::READING_UNKNOWN, 'registry' => null, 'entity' => null, 'key_unique' => null];
    }

    private static function unique(SidePlan $side): bool
    {
        return ($side->version->column($side->key)?->profile['unique'] ?? false) === true;
    }

    /**
     * @return array{dataset_id: string, dataset: string, key: string, name: string}
     */
    private static function field(SidePlan $side): array
    {
        return ['dataset_id' => $side->dataset->id, 'dataset' => $side->dataset->key, 'key' => $side->key, 'name' => "{$side->dataset->key}.{$side->key}"];
    }
}
