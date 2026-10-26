<?php

namespace App\Modules\Recipes;

use App\Modules\Relationships\Relationship;
use App\Modules\Support\Canonical;
use App\Modules\Workspaces\Workspace;

final class Decisions
{
    /**
     * @param  list<array<string, mixed>>  $steps  compiled steps
     * @param  list<array<string, mixed>>  $inputs  compiled inputs
     * @return list<array<string, mixed>>
     */
    public static function of(array $steps, array $inputs): array
    {
        $datasets = array_column($inputs, 'dataset_id', 'position');
        $decisions = [];

        foreach ($steps as $step) {
            if ($step['type'] === 'join') {
                $probe = "{$step['probe']['alias']}.{$step['probe']['column']}";
                $lookup = "{$step['lookup']['alias']}.{$step['lookup']['column']}";
                $decisions[] = [
                    'kind' => 'relation',
                    'position' => $step['position'],
                    'relationship_id' => $step['relationship_id'],
                    'route' => ($step['direction'] ?? 'forward') === 'reverse' ? "{$lookup} → {$probe}" : "{$probe} → {$lookup}",
                    'status' => $step['relationship_status'] ?? null,
                    'policy' => $step['relationship_policy'] ?? null,
                    'direction' => $step['direction'] ?? null,
                ];
            }

            if ($step['type'] === 'filter') {
                foreach ($step['conditions'] as $condition) {
                    if (($condition['kind'] ?? null) === 'validity') {
                        $decisions[] = self::validity($step['position'], $condition['alias'], $datasets[$condition['input'] ?? null] ?? null, $condition);
                    }
                }
            }
        }

        return $decisions;
    }

    /**
     * @param  array{start_column?: string|null, end_column?: string|null, end_inclusive?: bool|null}  $declaration
     * @return array<string, mixed>
     */
    public static function validity(?int $position, string $alias, ?string $datasetId, array $declaration): array
    {
        return [
            'kind' => 'validity',
            'position' => $position,
            'alias' => $alias,
            'dataset_id' => $datasetId,
            'start_column' => $declaration['start_column'] ?? null,
            'end_column' => $declaration['end_column'] ?? null,
            'end_inclusive' => $declaration['end_inclusive'] ?? null,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $decisions
     */
    public static function key(array $decisions): string
    {
        return sha1(json_encode(Canonical::normalize(array_map(fn (array $decision) => array_diff_key($decision, ['route' => true]), $decisions))));
    }

    /**
     * @param  list<array<string, mixed>>  $decisions
     * @return list<array{kind: string, position: int|null, message: string}>
     */
    public static function changes(Workspace $workspace, array $decisions): array
    {
        $relationships = $workspace->relationships()
            ->whereIn('id', array_column(array_filter($decisions, fn (array $d) => $d['kind'] === 'relation'), 'relationship_id'))
            ->get()
            ->keyBy('id');
        $datasets = $workspace->datasets()
            ->whereIn('id', array_filter(array_column(array_filter($decisions, fn (array $d) => $d['kind'] === 'validity'), 'dataset_id')))
            ->get()
            ->keyBy('id');
        $changes = [];

        foreach ($decisions as $decision) {
            $message = $decision['kind'] === 'relation'
                ? self::relationChange($decision, $relationships->get($decision['relationship_id']))
                : self::validityChange($decision, $decision['dataset_id'] === null ? null : $datasets->get($decision['dataset_id'])?->validity(), $decision['dataset_id'] !== null && ! $datasets->has($decision['dataset_id']));

            if ($message !== null && ! in_array($message, array_column($changes, 'message'), true)) {
                $changes[] = ['kind' => $decision['kind'], 'position' => $decision['position'], 'message' => $message];
            }
        }

        return $changes;
    }

    /**
     * @param  array<string, mixed>  $decision
     */
    private static function relationChange(array $decision, ?Relationship $current): ?string
    {
        if ($current === null) {
            return "A relação {$decision['route']} não existe mais no Mapa.";
        }

        if ($current->status === $decision['status'] && $current->policy === $decision['policy']) {
            return null;
        }

        return 'A relação '.$decision['route'].' estava '.self::relationWord($decision['status'], $decision['policy']).'; agora está '.self::relationWord($current->status, $current->policy).'.';
    }

    /**
     * @param  array<string, mixed>  $decision
     * @param  array{start_column: string, end_column: string|null, end_inclusive: bool}|null  $current
     */
    private static function validityChange(array $decision, ?array $current, bool $missing): ?string
    {
        if ($decision['dataset_id'] === null) {
            return null;
        }

        $was = self::validityWords($decision);
        $now = $missing || $current === null ? null : self::validityWords($current);

        return match (true) {
            $was === $now => null,
            $now === null => "A vigência de {$decision['alias']} era {$was}; essa declaração foi retirada.",
            $was === null => "A vigência de {$decision['alias']} não estava declarada; agora é {$now}.",
            default => "A vigência de {$decision['alias']} era {$was}; agora é {$now}.",
        };
    }

    private static function relationWord(?string $status, ?string $policy): string
    {
        return match (true) {
            $status === Relationship::CONFIRMED && $policy === Relationship::ACCEPT_MULTIPLICITY => 'confirmada com multiplicidade aceita',
            $status === Relationship::CONFIRMED => 'confirmada como N:1',
            $status === Relationship::REJECTED => 'rejeitada',
            $status === Relationship::SUGGESTED => 'sugerida, sem confirmação',
            default => 'sem registro de decisão',
        };
    }

    /**
     * @param  array{start_column?: string|null, end_column?: string|null, end_inclusive?: bool|null}  $declaration
     */
    private static function validityWords(array $declaration): ?string
    {
        $start = $declaration['start_column'] ?? null;
        $end = $declaration['end_column'] ?? null;

        if ($start === null) {
            return null;
        }

        if ($end === null) {
            return "{$start}, sem coluna de fim";
        }

        return "{$start} → {$end} (".(($declaration['end_inclusive'] ?? true) ? 'fim incluído' : 'fim excluído').')';
    }
}
