<?php

namespace App\Modules\Runs\Engine;

final class ExecutionBudget
{
    private readonly int $deadline;

    public function __construct(private readonly float $seconds, private readonly int $traceTuples)
    {
        $this->deadline = hrtime(true) + (int) ($seconds * 1e9);
    }

    public static function forPreview(): self
    {
        return new self((float) config('trace.limits.preview_seconds'), (int) config('trace.limits.tuples'));
    }

    public function guard(?int $step): void
    {
        if (hrtime(true) > $this->deadline) {
            $seconds = rtrim(rtrim(number_format($this->seconds, 1, ',', ''), '0'), ',');

            throw new ExecutionFailed(
                'limit.preview_time',
                "A prévia passou de {$seconds} s e foi interrompida. Rastrear calcula em segundo plano, sem esse limite de tempo; ou reduza o período ou o recorte.",
                $step,
                ['seconds' => $this->seconds],
            );
        }
    }

    public function tooManyTuples(int $limit, int $step): ExecutionFailed
    {
        return new ExecutionFailed(
            'limit.preview_tuples',
            'A prévia passou de '.number_format($limit, 0, ',', '.').' linhas intermediárias, o limite para calcular na tela. Rastrear calcula em segundo plano, até '.number_format($this->traceTuples, 0, ',', '.').' linhas; ou reduza o período ou o recorte. Se uma ligação está multiplicando linhas, veja a relação no Mapa.',
            $step,
            ['max_tuples' => $limit, 'trace_tuples' => $this->traceTuples],
        );
    }
}
