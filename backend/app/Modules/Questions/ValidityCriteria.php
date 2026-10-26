<?php

namespace App\Modules\Questions;

use App\Modules\Recipes\StepDescriber;

final class ValidityCriteria
{
    /**
     * @param  array{start_column: string, end_column: string|null, end_inclusive: bool}  $validity
     * @return array{enters: string, leaves: string, rule: string, undetermined: string}
     */
    public static function describe(string $reading, string $from, string $to, array $validity): array
    {
        $f = StepDescriber::date($from);
        $t = StepDescriber::date($to);
        $start = $validity['start_column'];
        $end = $validity['end_column'];
        $inclusive = $validity['end_inclusive'];
        $op = $inclusive ? '≥' : '>';

        $stillOn = fn (string $day): string => $inclusive
            ? " e não terminou antes de {$day}"
            : " e terminou depois de {$day}, ou não terminou";
        $endedBy = fn (string $day): string => $inclusive ? "terminou antes de {$day}" : "terminou até {$day}";

        [$enters, $leaves, $rule] = match ($reading) {
            'started' => [
                "quem começou entre {$f} e {$t}",
                "quem começou antes de {$f} ou depois de {$t}",
                "{$f} ≤ {$start} ≤ {$t}",
            ],
            'active_any' => $end === null ? [
                "quem começou até {$t}",
                "quem começou depois de {$t}",
                "{$start} ≤ {$t}",
            ] : [
                "quem começou até {$t}".$stillOn($f),
                "quem começou depois de {$t} ou ".$endedBy($f),
                "{$start} ≤ {$t} e ({$end} vazio ou {$end} {$op} {$f})",
            ],
            default => $end === null ? [
                "quem começou até {$t}",
                "quem começou depois de {$t}",
                "{$start} ≤ {$t}",
            ] : [
                "quem começou até {$t}".$stillOn($t),
                "quem começou depois de {$t} ou ".$endedBy($t),
                "{$start} ≤ {$t} e ({$end} vazio ou {$end} {$op} {$t})",
            ],
        };

        $undetermined = $end === null
            ? "Sem {$start} válido: fica de fora como indeterminado, em qualquer leitura."
            : "Sem {$start} válido, com {$end} que não é data ou com {$end} antes de {$start}: fica de fora como indeterminado, em qualquer leitura.";

        return ['enters' => $enters, 'leaves' => $leaves, 'rule' => $rule, 'undetermined' => $undetermined];
    }
}
