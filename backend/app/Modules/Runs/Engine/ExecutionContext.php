<?php

namespace App\Modules\Runs\Engine;

final class ExecutionContext
{
    public readonly TupleStore $tuples;

    public array $diagnostics = [];

    public function __construct(
        public readonly array $inputs,
        public readonly array $rows,
        public readonly int $maxTuples,
    ) {
        $this->tuples = new TupleStore;
    }

    public function value(int $tuple, int $input, string $column): ?string
    {
        $rowId = $this->tuples->sources[$tuple][$input] ?? null;

        if ($rowId === null) {
            return null;
        }

        return $this->rows[$input][$rowId][$column] ?? null;
    }

    public function diagnose(int $step, string $code, string $severity, ?int $sourceRowId, ?int $tuple, array $detail): void
    {
        $this->diagnostics[] = [
            'step_position' => $step,
            'code' => $code,
            'severity' => $severity,
            'source_row_id' => $sourceRowId,
            'tuple_no' => $tuple,
            'detail' => $detail,
        ];
    }

    public function guardTupleLimit(int $step): void
    {
        if ($this->tuples->count() > $this->maxTuples) {
            throw new ExecutionFailed(
                'limit.tuples',
                "A execução ultrapassou o limite de {$this->maxTuples} registros intermediários. Verifique se a junção está multiplicando registros por chaves repetidas.",
                $step,
                ['max_tuples' => $this->maxTuples],
            );
        }
    }
}
