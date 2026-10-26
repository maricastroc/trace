<?php

namespace App\Modules\Comparisons;

use App\Modules\Runs\Lineage\RunLineage;
use App\Modules\Runs\Run;
use App\Modules\Runs\RunExecutor;
use App\Modules\Support\DomainError;
use Illuminate\Support\Facades\DB;
use Throwable;

final class ComparisonExecutor
{
    private const CHUNK = 1000;

    public function __construct(
        private readonly RunExecutor $runs,
        private readonly SideCollector $collector,
        private readonly ComparisonEngine $engine,
        private readonly RunLineage $lineage,
    ) {}

    public function execute(ComparisonRun $comparison): void
    {
        $claimed = ComparisonRun::query()->whereKey($comparison->id)->where('status', ComparisonRun::QUEUED)
            ->update(['status' => ComparisonRun::RUNNING, 'started_at' => now(), 'updated_at' => now()]);
        if ($claimed === 0) {
            return;
        }

        $comparison->refresh();
        $started = hrtime(true);

        try {
            $sets = [];
            $steps = [];
            foreach (['a', 'b'] as $side) {
                $run = $comparison->sideRun($side);
                if ($run === null) {
                    $this->fail($comparison, ['code' => 'comparison.side_missing', 'message' => 'A execução de um dos lados não existe mais.', 'side' => $side]);

                    return;
                }
                if ($run->status === Run::QUEUED) {
                    $this->runs->execute($run);
                    $run->refresh();
                }
                if ($run->status !== Run::SUCCEEDED) {
                    $this->fail($comparison, [
                        'code' => 'comparison.side_failed',
                        'message' => 'O lado '.strtoupper($side).' não terminou: '.($run->error['message'] ?? 'a execução falhou.'),
                        'side' => $side,
                    ]);

                    return;
                }

                $basis = $comparison->sides[$side];
                $sets[$side] = $this->collector->fromRun($run, new SideSource($basis['version']['id'], $basis['key'], $basis['validity'], $basis['fields'], $basis));
                $steps[$side] = $this->lineage->steps($run);
            }

            $spec = $comparison->spec;
            $periods = [
                'a' => ['validity' => $comparison->sides['a']['validity'], 'other_period' => $this->period($spec['b'])],
                'b' => ['validity' => $comparison->sides['b']['validity'], 'other_period' => $this->period($spec['a'])],
            ];
            $result = $this->engine->compare($sets['a'], $sets['b'], $spec['rules'], $periods, $spec['fields'], $steps);

            DB::transaction(function () use ($comparison, $result, $started) {
                foreach (array_chunk($result['identities'], self::CHUNK, true) as $chunk) {
                    DB::table('comparison_identities')->insert(array_map(fn (array $identity, int $position) => [
                        'comparison_run_id' => $comparison->id,
                        'position' => $position + 1,
                        'identity' => $identity['identity'],
                        'a_value' => $identity['a_value'],
                        'b_value' => $identity['b_value'],
                        'category' => $identity['category'],
                        'explanation' => $identity['explanation'],
                        'detail' => $identity['detail'] === null ? null : json_encode($identity['detail'], JSON_UNESCAPED_UNICODE),
                        'a_rows' => $identity['a_rows'],
                        'b_rows' => $identity['b_rows'],
                        'fields' => $identity['fields'] === [] ? null : json_encode($identity['fields'], JSON_UNESCAPED_UNICODE),
                    ], $chunk, array_keys($chunk)));
                }

                $comparison->update([
                    'status' => ComparisonRun::SUCCEEDED,
                    'summary' => $result['summary'],
                    'issues' => array_merge($comparison->issues, $result['caveats']),
                    'finished_at' => now(),
                    'duration_ms' => (int) round((hrtime(true) - $started) / 1e6),
                ]);
            });
        } catch (DomainError $error) {
            $this->fail($comparison, ['code' => $error->errorCode, 'message' => $error->getMessage(), 'details' => $error->details]);
        } catch (Throwable $exception) {
            report($exception);
            $this->fail($comparison, ['code' => 'internal', 'message' => 'A comparação falhou por um erro interno. Nada foi gravado.']);
        }
    }

    public function fail(ComparisonRun $comparison, array $error): void
    {
        ComparisonRun::query()->whereKey($comparison->id)->whereIn('status', [ComparisonRun::QUEUED, ComparisonRun::RUNNING])->update([
            'status' => ComparisonRun::FAILED,
            'error' => json_encode($error, JSON_UNESCAPED_UNICODE),
            'finished_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function period(array $side): ?array
    {
        $period = $side['period'] ?? null;

        return $period === null ? null : [$period['from'], $period['to']];
    }
}
