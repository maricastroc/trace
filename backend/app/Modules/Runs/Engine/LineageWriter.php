<?php

namespace App\Modules\Runs\Engine;

use App\Modules\Runs\Run;
use Illuminate\Support\Facades\DB;

final class LineageWriter
{
    private const CHUNK = 2000;

    public function write(Run $run, ExecutionOutcome $outcome, int $startedAt): void
    {
        DB::transaction(function () use ($run, $outcome, $startedAt) {
            $this->insert('run_steps', array_map(fn (array $step) => [
                'run_id' => $run->id,
                'position' => $step['position'],
                'type' => $step['type'],
                'config' => $this->json($step['config']),
                'input_count' => $step['input_count'],
                'output_count' => $step['output_count'],
                'excluded_count' => $step['excluded_count'],
                'stats' => $this->json($step['stats']),
                'duration_ms' => $step['duration_ms'],
            ], $outcome->steps));

            $this->insert('run_result_rows', array_map(fn (array $result) => [
                'run_id' => $run->id,
                'result_no' => $result['result_no'],
                'values' => $this->json($result['values']),
                'contributor_count' => $result['contributor_count'],
            ], $outcome->results));

            $this->writeTuples($run, $outcome->tuples);

            $this->insert('run_diagnostics', array_map(fn (array $diagnostic) => [
                'run_id' => $run->id,
                'step_position' => $diagnostic['step_position'],
                'code' => $diagnostic['code'],
                'severity' => $diagnostic['severity'],
                'source_row_id' => $diagnostic['source_row_id'],
                'tuple_no' => $diagnostic['tuple_no'],
                'detail' => $this->json($diagnostic['detail']),
            ], $outcome->diagnostics));

            $run->forceFill([
                'status' => Run::SUCCEEDED,
                'output_columns' => $outcome->columns,
                'result_count' => count($outcome->results),
                'tuple_count' => $outcome->tuples->count(),
                'duration_ms' => (int) round((hrtime(true) - $startedAt) / 1e6),
                'finished_at' => now(),
                'error' => null,
            ])->save();
        });
    }

    private function writeTuples(Run $run, TupleStore $tuples): void
    {
        $tupleBatch = [];
        $sourceBatch = [];

        foreach ($tuples->fate as $no => $fate) {
            $tupleBatch[] = [
                'run_id' => $run->id,
                'tuple_no' => $no,
                'parent_no' => $tuples->parent[$no],
                'born_step' => $tuples->born[$no],
                'end_step' => $tuples->endStep[$no] ?? null,
                'fate' => $fate,
                'exclusion_code' => $tuples->exclusionCode[$no] ?? null,
                'exclusion_detail' => isset($tuples->exclusionDetail[$no]) ? $this->json($tuples->exclusionDetail[$no]) : null,
                'result_no' => $tuples->result[$no] ?? null,
            ];

            foreach ($tuples->sources[$no] as $input => $rowId) {
                $sourceBatch[] = [
                    'run_id' => $run->id,
                    'tuple_no' => $no,
                    'input_position' => $input,
                    'source_row_id' => $rowId,
                ];
            }

            if (count($tupleBatch) >= self::CHUNK) {
                DB::table('run_tuples')->insert($tupleBatch);
                $tupleBatch = [];
                $this->flushSources($sourceBatch);
            }
        }

        if ($tupleBatch !== []) {
            DB::table('run_tuples')->insert($tupleBatch);
        }
        $this->flushSources($sourceBatch, true);
    }

    private function flushSources(array &$batch, bool $force = false): void
    {
        if ($batch === [] || (! $force && count($batch) < self::CHUNK)) {
            return;
        }

        foreach (array_chunk($batch, self::CHUNK * 2) as $chunk) {
            DB::table('run_tuple_sources')->insert($chunk);
        }
        $batch = [];
    }

    private function insert(string $table, array $rows): void
    {
        foreach (array_chunk($rows, self::CHUNK) as $chunk) {
            DB::table($table)->insert($chunk);
        }
    }

    private function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
