<?php

namespace App\Modules\Runs\Engine;

use Illuminate\Support\Facades\DB;

final class Pipeline
{
    public function __construct(
        private readonly FilterOperator $filter,
        private readonly JoinOperator $join,
        private readonly AggregateOperator $aggregate,
        private readonly ProjectOperator $project,
    ) {
    }

    public function execute(array $snapshot, ?int $maxTuples = null): ExecutionOutcome
    {
        $rows = [];
        foreach ($snapshot['inputs'] as $input) {
            $rows[$input['position']] = $this->loadRows($input['version_id']);
        }

        $context = new ExecutionContext($snapshot['inputs'], $rows, $maxTuples ?? (int) config('trace.limits.tuples'));

        $alive = [];
        foreach (array_keys($rows[0]) as $rowId) {
            $alive[] = $context->tuples->create(null, 0, [0 => $rowId]);
        }
        $context->guardTupleLimit(0);

        $steps = [];
        $results = null;
        $columns = null;

        foreach ($snapshot['steps'] as $step) {
            $started = hrtime(true);
            $inputCount = count($alive);

            switch ($step['type']) {
                case 'filter':
                    [$alive, $stats] = $this->filter->apply($context, $step, $alive);
                    $outputCount = count($alive);
                    $excluded = $inputCount - $outputCount;
                    break;
                case 'join':
                    [$alive, $stats] = $this->join->apply($context, $step, $alive);
                    $outputCount = count($alive);
                    $excluded = $stats['excluded_by_reason']['no_match'] + $stats['excluded_by_reason']['null_key'];
                    break;
                case 'aggregate':
                    [$results, $columns, $stats] = $this->aggregate->apply($context, $step, $alive);
                    $outputCount = count($results);
                    $excluded = 0;
                    $alive = [];
                    break;
                default:
                    throw new ExecutionFailed('step.unknown', "Tipo de passo desconhecido: {$step['type']}.", $step['position']);
            }

            $steps[] = [
                'position' => $step['position'],
                'type' => $step['type'],
                'config' => $step,
                'input_count' => $inputCount,
                'output_count' => $outputCount,
                'excluded_count' => $excluded,
                'stats' => $stats,
                'duration_ms' => (int) round((hrtime(true) - $started) / 1e6),
            ];
        }

        if ($results === null) {
            [$results, $columns] = $this->project->apply($context, $alive);
        }

        return new ExecutionOutcome($context->tuples, $context->diagnostics, $steps, $results, $columns);
    }

    private function loadRows(string $versionId): array
    {
        $rows = [];
        $cursor = DB::table('source_rows')
            ->where('dataset_version_id', $versionId)
            ->orderBy('row_number')
            ->select(['id', 'values'])
            ->cursor();

        foreach ($cursor as $row) {
            $rows[(int) $row->id] = json_decode($row->values, true, 512, JSON_THROW_ON_ERROR);
        }

        return $rows;
    }
}
