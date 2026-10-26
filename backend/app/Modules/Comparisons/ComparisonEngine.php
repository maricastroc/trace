<?php

namespace App\Modules\Comparisons;

final class ComparisonEngine
{
    public const SAMPLE = 10;

    public function __construct(private readonly Reconciler $reconciler) {}

    /**
     * @param  array{a: list<array>, b: list<array>}  $steps  executed steps of each side, with their stats
     * @return array{identities: list<array<string, mixed>>, summary: array<string, mixed>, caveats: list<array<string, mixed>>}
     */
    public function compare(SideSet $a, SideSet $b, array $rules, array $periods, array $fields, array $steps): array
    {
        $result = $this->reconciler->reconcile($a, $b, $rules, $periods, $fields);

        return $result + ['caveats' => $this->caveats($result['summary'], $steps)];
    }

    /**
     * @param  list<array<string, mixed>>  $identities
     * @return array<string, list<array<string, mixed>>>
     */
    public function samples(array $identities): array
    {
        $samples = array_fill_keys(Reconciler::CATEGORIES, []);
        foreach ($identities as $identity) {
            if (count($samples[$identity['category']]) < self::SAMPLE) {
                $samples[$identity['category']][] = $identity;
            }
        }

        return $samples;
    }

    /**
     * @param  list<array<string, mixed>>  $identities
     * @return array{only_a: array<string, list<array<string, mixed>>>, only_b: array<string, list<array<string, mixed>>>}
     */
    public function explainedSamples(array $identities): array
    {
        $samples = [Reconciler::ONLY_A => [], Reconciler::ONLY_B => []];
        foreach ($identities as $identity) {
            $explanation = $identity['explanation'];
            if ($explanation === null || count($samples[$identity['category']][$explanation] ?? []) >= self::SAMPLE) {
                continue;
            }
            $samples[$identity['category']][$explanation][] = $identity;
        }

        return array_map(fn (array $byExplanation) => $byExplanation === [] ? new \stdClass : $byExplanation, $samples);
    }

    private function caveats(array $summary, array $steps): array
    {
        $caveats = [];
        foreach (['a', 'b'] as $side) {
            $name = strtoupper($side);
            $counts = $summary[$side];
            if ($counts['repeated_identities'] > 0) {
                $caveats[] = $this->caveat('comparison.repeated_identities', $side, "Lado {$name}: {$counts['repeated_identities']} identidades aparecem em mais de uma linha ({$counts['repeated_rows']} linhas repetidas). Cada uma conta uma vez na comparação.");
            }
            if ($counts['empty_rows'] > 0) {
                $caveats[] = $this->caveat('comparison.empty_identifiers', $side, "Lado {$name}: {$counts['empty_rows']} linhas sem identificador ficam fora da comparação de identidades.");
            }
            $copies = 0;
            $cutAfterCopies = false;
            foreach ($steps[$side] as $step) {
                $stats = $step['stats'] ?? [];
                if (($step['type'] ?? null) === 'join') {
                    $copies += max(0, ($stats['created_tuples'] ?? 0) - ($stats['matched_tuples'] ?? 0));
                }
                if (($step['type'] ?? null) === 'filter' && $copies > 0) {
                    $cutAfterCopies = true;
                }
            }
            if ($copies > 0) {
                $caveats[] = $this->caveat('comparison.join_copies', $side, $cutAfterCopies
                    ? "Lado {$name}: uma ligação copiou {$copies} linhas porque o destino repete ids. A comparação usa cada linha de origem uma vez, mas a linha entra no lado se qualquer uma das cópias passar pelo recorte: ela pode entrar por um valor que só uma das cópias tem."
                    : "Lado {$name}: uma ligação copiou {$copies} linhas porque o destino repete ids. A comparação usa cada linha de origem uma vez, então as cópias não mudam as contagens deste lado.");
            }
        }

        if ($summary['possible_matches'] > 0) {
            $caveats[] = $this->caveat('comparison.possible_matches', null, "{$summary['possible_matches']} pares possíveis por normalização continuam como hipótese e não contam como par. Para que contem, aceite a regra correspondente na comparação.");
        }

        return $caveats;
    }

    private function caveat(string $code, ?string $side, string $message): array
    {
        return ['severity' => 'warning', 'code' => $code, 'message' => $message, 'side' => $side, 'path' => 'summary', 'details' => new \stdClass];
    }
}
