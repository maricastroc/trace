<?php

namespace App\Modules\Runs;

use App\Modules\Runs\Engine\ExecutionFailed;
use App\Modules\Runs\Engine\LineageWriter;
use App\Modules\Runs\Engine\Pipeline;
use Throwable;

final class RunExecutor
{
    public function __construct(
        private readonly Pipeline $pipeline,
        private readonly LineageWriter $writer,
    ) {
    }

    public function execute(Run $run): void
    {
        $claimed = Run::query()
            ->whereKey($run->id)
            ->where('status', Run::QUEUED)
            ->update(['status' => Run::RUNNING, 'started_at' => now(), 'updated_at' => now()]);

        if ($claimed === 0) {
            return;
        }

        $run->refresh();
        ini_set('memory_limit', '1024M');

        try {
            $outcome = $this->pipeline->execute($run->recipe_snapshot);
            $this->writer->write($run, $outcome);
        } catch (ExecutionFailed $failure) {
            $this->fail($run, $failure->toArray());
        } catch (Throwable $exception) {
            report($exception);
            $this->fail($run, [
                'code' => 'internal',
                'message' => 'A execução falhou por um erro interno. Os resultados parciais foram descartados.',
                'step_position' => null,
                'details' => new \stdClass,
            ]);
        }
    }

    public function fail(Run $run, array $error): void
    {
        Run::query()->whereKey($run->id)->whereIn('status', [Run::QUEUED, Run::RUNNING])->update([
            'status' => Run::FAILED,
            'error' => json_encode($error, JSON_UNESCAPED_UNICODE),
            'finished_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
