<?php

namespace App\Modules\Runs\Engine;

final class ProjectOperator
{
    public function apply(ExecutionContext $context, array $alive): array
    {
        $columns = [];
        foreach ($context->inputs as $input) {
            foreach ($input['columns'] as $column) {
                $columns[] = [
                    'key' => "{$input['alias']}.{$column['key']}",
                    'label' => "{$input['alias']}.{$column['key']}",
                    'role' => 'field',
                    'type' => $column['type'],
                    'source' => ['alias' => $input['alias'], 'column' => $column['key'], 'input' => $input['position']],
                ];
            }
        }

        $results = [];
        foreach ($alive as $index => $tuple) {
            $resultNo = $index + 1;
            $values = [];
            foreach ($columns as $column) {
                $values[$column['key']] = $context->value($tuple, $column['source']['input'], $column['source']['column']);
            }
            $context->tuples->include($tuple, $resultNo);
            $results[] = ['result_no' => $resultNo, 'values' => $values, 'contributor_count' => 1];
        }

        return [$results, $columns];
    }
}
