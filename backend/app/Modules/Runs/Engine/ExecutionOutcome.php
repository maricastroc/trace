<?php

namespace App\Modules\Runs\Engine;

final class ExecutionOutcome
{
    public function __construct(
        public readonly TupleStore $tuples,
        public readonly array $diagnostics,
        public readonly array $steps,
        public readonly array $results,
        public readonly array $columns,
    ) {
    }
}
