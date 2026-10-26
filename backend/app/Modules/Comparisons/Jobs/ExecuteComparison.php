<?php

namespace App\Modules\Comparisons\Jobs;

use App\Modules\Comparisons\ComparisonExecutor;
use App\Modules\Comparisons\ComparisonRun;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

class ExecuteComparison implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 900;

    public function __construct(public readonly string $comparisonRunId) {}

    public function handle(ComparisonExecutor $executor): void
    {
        $run = ComparisonRun::query()->find($this->comparisonRunId);

        if ($run !== null) {
            $executor->execute($run);
        }
    }

    public function failed(?Throwable $exception): void
    {
        $run = ComparisonRun::query()->find($this->comparisonRunId);

        if ($run !== null) {
            app(ComparisonExecutor::class)->fail($run, [
                'code' => 'job_failed',
                'message' => 'O processamento foi interrompido antes de terminar (tempo limite ou falha do worker).',
            ]);
        }
    }
}
