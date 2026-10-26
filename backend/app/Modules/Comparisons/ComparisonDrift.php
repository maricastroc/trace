<?php

namespace App\Modules\Comparisons;

use App\Modules\Recipes\Decisions;
use App\Modules\Workspaces\Workspace;

final class ComparisonDrift
{
    /**
     * @return array{a: list<array<string, mixed>>, b: list<array<string, mixed>>, equivalence: string|null, recorded: bool}
     */
    public static function of(Workspace $workspace, ComparisonRun $run): array
    {
        $recorded = isset($run->sides['a']['decisions'], $run->sides['b']['decisions']);

        return [
            'a' => Decisions::changes($workspace, $run->sides['a']['decisions'] ?? []),
            'b' => Decisions::changes($workspace, $run->sides['b']['decisions'] ?? []),
            'equivalence' => self::equivalence($workspace, $run->equivalence),
            'recorded' => $recorded,
        ];
    }

    /**
     * @param  array<string, mixed>|null  $equivalence
     */
    private static function equivalence(Workspace $workspace, ?array $equivalence): ?string
    {
        if (($equivalence['status'] ?? null) !== Equivalence::MAP_DECLARED) {
            return null;
        }

        $relationship = $workspace->relationships()->find($equivalence['relationship_id'] ?? null);

        return $relationship !== null && $relationship->identityDeclared()
            ? null
            : "Nesta execução, a identidade entre {$equivalence['a']['name']} e {$equivalence['b']['name']} estava declarada no Mapa. Essa declaração foi retirada depois; a execução continua registrando a declaração que usou.";
    }
}
