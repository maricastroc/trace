<?php

namespace App\Modules\Runs\Jobs;

use App\Modules\Runs\Run;
use App\Modules\Runs\RunExecutor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

class ExecuteRun implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(public readonly string $runId)
    {
    }

    public function handle(RunExecutor $executor): void
    {
        $run = Run::query()->find($this->runId);

        if ($run !== null) {
            $executor->execute($run);
        }
    }

    public function failed(?Throwable $exception): void
    {
        $run = Run::query()->find($this->runId);

        if ($run !== null) {
            app(RunExecutor::class)->fail($run, [
                'code' => 'job_failed',
                'message' => 'O processamento foi interrompido antes de terminar (tempo limite ou falha do worker).',
                'step_position' => null,
                'details' => new \stdClass,
            ]);
        }
    }
}
