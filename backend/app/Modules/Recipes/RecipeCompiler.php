<?php

namespace App\Modules\Recipes;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetVersion;
use App\Modules\Datasets\Import\ValueParser;
use App\Modules\Relationships\Relationship;
use App\Modules\Support\Identifier;
use App\Modules\Workspaces\Workspace;

final class RecipeCompiler
{
    private const MAX_STEPS = 20;

    private const OPERATORS_BY_TYPE = [
        'text' => ['eq', 'neq', 'in', 'not_in', 'contains', 'is_null', 'is_not_null'],
        'number' => ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
        'date' => ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    ];

    private array $issues = [];

    private array $inputs = [];

    private array $versions = [];

    public function compile(Workspace $workspace, mixed $baseDatasetId, mixed $steps): CompiledRecipe
    {
        $this->issues = [];
        $this->inputs = [];
        $this->versions = [];

        $base = is_string($baseDatasetId)
            ? $workspace->datasets()->with('latestVersion.columns')->find($baseDatasetId)
            : null;

        if ($base === null || $base->latestVersion === null) {
            $this->issue('error', 'recipe.base_missing', 'Escolha o conjunto de dados de partida da receita.', null, 'base_dataset_id');

            return new CompiledRecipe(null, [], [], $this->issues);
        }

        $this->addInput($base);

        if (! is_array($steps) || ! array_is_list($steps)) {
            $this->issue('error', 'recipe.steps_invalid', 'Os passos da receita devem ser uma lista.', null, 'steps');

            return new CompiledRecipe($base->id, $this->inputs, [], $this->issues);
        }

        if (count($steps) > self::MAX_STEPS) {
            $this->issue('error', 'recipe.too_many_steps', 'Uma receita pode ter no máximo '.self::MAX_STEPS.' passos.', null, 'steps');
        }

        $compiled = [];
        $ids = [];
        $aggregated = false;

        foreach (array_slice($steps, 0, self::MAX_STEPS) as $index => $raw) {
            $position = $index + 1;
            $path = "steps.{$index}";

            if (! is_array($raw) || ! in_array($raw['type'] ?? null, ['filter', 'join', 'aggregate'], true)) {
                $this->issue('error', 'step.type_invalid', 'Tipo de passo inválido. Use filtro, junção ou agregação.', $position, "{$path}.type");

                continue;
            }

            $id = is_string($raw['id'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $raw['id']) === 1 ? $raw['id'] : "s{$position}";
            $id = in_array($id, $ids, true) ? "s{$position}" : $id;
            $ids[] = $id;

            if ($aggregated) {
                $this->issue('error', 'step.after_aggregate', 'A agregação precisa ser o último passo da receita.', $position, $path);
            }

            $step = match ($raw['type']) {
                'filter' => $this->filter($raw, $position, $path),
                'join' => $this->join($workspace, $raw, $position, $path),
                'aggregate' => $this->aggregate($raw, $position, $path),
            };

            if ($step === null) {
                continue;
            }

            $aggregated = $aggregated || $raw['type'] === 'aggregate';
            $step = ['id' => $id, 'position' => $position, 'title' => StepDescriber::title($step['type'])] + $step;
            $step['summary'] = StepDescriber::describe($step);
            $compiled[] = $step;
        }

        $plain = PlainLanguage::describe($compiled, $this->inputs);
        foreach ($compiled as &$step) {
            $step['plain'] = $plain[$step['position']];
        }
        unset($step);

        return new CompiledRecipe($base->id, $this->inputs, $compiled, $this->issues);
    }

    private function filter(array $raw, int $position, string $path): ?array
    {
        $conditions = $raw['conditions'] ?? null;

        if (! is_array($conditions) || ! array_is_list($conditions) || $conditions === [] || count($conditions) > 10) {
            $this->issue('error', 'filter.conditions_invalid', 'Um filtro precisa de 1 a 10 condições.', $position, "{$path}.conditions");

            return null;
        }

        $normalized = [];
        foreach ($conditions as $i => $condition) {
            $result = $this->condition($condition, $position, "{$path}.conditions.{$i}");
            if ($result !== null) {
                $normalized[] = $result;
            }
        }

        return count($normalized) === count($conditions) ? ['type' => 'filter', 'conditions' => $normalized] : null;
    }

    private function condition(mixed $condition, int $position, string $path): ?array
    {
        if (! is_array($condition)) {
            $this->issue('error', 'filter.condition_invalid', 'Condição inválida.', $position, $path);

            return null;
        }

        $ref = $this->reference($condition, $position, $path);
        if ($ref === null) {
            return null;
        }

        $columnType = $ref['type'];
        $valueType = $condition['value_type'] ?? match ($columnType) {
            'number' => 'number',
            'date' => 'date',
            default => 'text',
        };

        if (! isset(self::OPERATORS_BY_TYPE[$valueType])) {
            $this->issue('error', 'filter.value_type_invalid', 'Tipo de comparação inválido. Use text, number ou date.', $position, "{$path}.value_type");

            return null;
        }

        $operator = $condition['operator'] ?? null;
        if (! in_array($operator, self::OPERATORS_BY_TYPE[$valueType], true)) {
            $this->issue('error', 'filter.operator_invalid', "Operador não permitido para comparação do tipo {$valueType}.", $position, "{$path}.operator");

            return null;
        }

        $value = $this->conditionValue($condition['value'] ?? null, $operator, $valueType, $position, "{$path}.value");
        if ($value === false) {
            return null;
        }

        if ($valueType === 'number' && $columnType !== 'number') {
            $this->issue('warning', 'filter.column_not_numeric', "{$ref['alias']}.{$ref['column']} não é inteiramente numérica: valores que não forem números serão excluídos e explicados.", $position, $path);
        }

        if ($valueType === 'date' && $columnType !== 'date') {
            $this->issue('warning', 'filter.column_not_date', "{$ref['alias']}.{$ref['column']} não contém apenas datas: valores inválidos serão excluídos e explicados.", $position, $path);
        }

        return [
            'alias' => $ref['alias'],
            'column' => $ref['column'],
            'input' => $ref['input'],
            'operator' => $operator,
            'value' => $value,
            'value_type' => $valueType,
        ];
    }

    private function conditionValue(mixed $value, string $operator, string $type, int $position, string $path): mixed
    {
        if (in_array($operator, ['is_null', 'is_not_null'], true)) {
            return null;
        }

        if ($operator === 'between') {
            if (! is_array($value) || count($value) !== 2) {
                $this->issue('error', 'filter.between_invalid', 'O intervalo precisa de um valor inicial e um final.', $position, $path);

                return false;
            }
            $low = $this->scalar(array_values($value)[0], $type, $position, $path);
            $high = $this->scalar(array_values($value)[1], $type, $position, $path);
            if ($low === false || $high === false) {
                return false;
            }
            $inverted = $type === 'number' ? ValueParser::compareNumbers($low, $high) > 0 : strcmp($low, $high) > 0;
            if ($inverted) {
                $this->issue('error', 'filter.between_inverted', 'O valor inicial do intervalo é maior que o final.', $position, $path);

                return false;
            }

            return [$low, $high];
        }

        if (in_array($operator, ['in', 'not_in'], true)) {
            if (! is_array($value) || $value === [] || count($value) > 200) {
                $this->issue('error', 'filter.list_invalid', 'Informe de 1 a 200 valores.', $position, $path);

                return false;
            }
            $list = [];
            foreach ($value as $item) {
                $scalar = $this->scalar($item, $type, $position, $path);
                if ($scalar === false) {
                    return false;
                }
                $list[] = $scalar;
            }

            return array_values(array_unique($list));
        }

        return $this->scalar($value, $type, $position, $path);
    }

    private function scalar(mixed $value, string $type, int $position, string $path): string|false
    {
        if (! is_string($value) && ! is_int($value) && ! is_float($value)) {
            $this->issue('error', 'filter.value_missing', 'Informe um valor para a condição.', $position, $path);

            return false;
        }

        $value = trim((string) $value);
        if ($value === '') {
            $this->issue('error', 'filter.value_missing', 'Informe um valor para a condição.', $position, $path);

            return false;
        }

        if ($type === 'text') {
            return mb_substr($value, 0, 500);
        }

        $converted = ValueParser::convert($value, $type);
        if ($converted === null) {
            $expected = $type === 'number' ? 'um número (ex.: 120 ou 12.5)' : 'uma data (AAAA-MM-DD ou DD/MM/AAAA)';
            $this->issue('error', 'filter.value_unconvertible', "\"{$value}\" não é {$expected}.", $position, $path);

            return false;
        }

        return $converted;
    }

    private function join(Workspace $workspace, array $raw, int $position, string $path): ?array
    {
        $relationship = is_string($raw['relationship_id'] ?? null)
            ? $workspace->relationships()->with('fromDataset.latestVersion.columns', 'toDataset.latestVersion.columns')->find($raw['relationship_id'])
            : null;

        if ($relationship === null) {
            $this->issue('error', 'join.relationship_missing', 'Escolha um relacionamento para a junção.', $position, "{$path}.relationship_id");

            return null;
        }

        $joinType = $raw['join_type'] ?? 'inner';
        if (! in_array($joinType, ['inner', 'left'], true)) {
            $this->issue('error', 'join.type_invalid', 'Tipo de junção inválido. Use inner ou left.', $position, "{$path}.join_type");

            return null;
        }

        $fromIn = $this->aliasFor($relationship->from_dataset_id);
        $toIn = $this->aliasFor($relationship->to_dataset_id);

        if ($fromIn !== null && $toIn !== null) {
            $this->issue('error', 'join.both_present', 'Os dois conjuntos deste relacionamento já participam da receita.', $position, $path);

            return null;
        }

        if ($fromIn === null && $toIn === null) {
            $this->issue('error', 'join.disconnected', 'Nenhum dos conjuntos deste relacionamento participa da receita até este passo.', $position, $path);

            return null;
        }

        [$probeDataset, $probeColumn, $lookupDataset, $lookupColumn] = $fromIn !== null
            ? [$relationship->fromDataset, $relationship->from_column, $relationship->toDataset, $relationship->to_column]
            : [$relationship->toDataset, $relationship->to_column, $relationship->fromDataset, $relationship->from_column];

        if ($lookupDataset->latestVersion === null) {
            $this->issue('error', 'join.no_version', "O conjunto {$lookupDataset->key} não possui versões.", $position, $path);

            return null;
        }

        $probeInput = $this->inputFor($probeDataset->id);
        $lookupInput = $this->addInput($lookupDataset);

        foreach ([[$probeInput, $probeColumn], [$lookupInput, $lookupColumn]] as [$input, $column]) {
            if (! isset($this->versions[$input['position']][$column])) {
                $this->issue('error', 'join.column_missing', "A coluna {$input['alias']}.{$column} não existe na versão atual.", $position, $path);

                return null;
            }
        }

        if ($relationship->status === Relationship::SUGGESTED) {
            $this->issue('blocker', 'join.relationship_unconfirmed', "O relacionamento {$probeInput['alias']}.{$probeColumn} → {$lookupInput['alias']}.{$lookupColumn} ainda não foi confirmado.", $position, "{$path}.relationship_id", ['relationship_id' => $relationship->id]);
        }

        if ($relationship->status === Relationship::REJECTED) {
            $this->issue('blocker', 'join.relationship_rejected', 'Este relacionamento foi rejeitado. Confirme-o ou escolha outro.', $position, "{$path}.relationship_id", ['relationship_id' => $relationship->id]);
        }

        return [
            'type' => 'join',
            'relationship_id' => $relationship->id,
            'relationship_status' => $relationship->status,
            'join_type' => $joinType,
            'probe' => ['alias' => $probeInput['alias'], 'column' => $probeColumn, 'input' => $probeInput['position']],
            'lookup' => ['alias' => $lookupInput['alias'], 'column' => $lookupColumn, 'input' => $lookupInput['position']],
        ];
    }

    private function aggregate(array $raw, int $position, string $path): ?array
    {
        $groupBy = $raw['group_by'] ?? null;
        $measures = $raw['measures'] ?? null;

        if (! is_array($groupBy) || ! array_is_list($groupBy) || $groupBy === [] || count($groupBy) > 5) {
            $this->issue('error', 'aggregate.group_invalid', 'Escolha de 1 a 5 colunas para agrupar.', $position, "{$path}.group_by");

            return null;
        }

        if (! is_array($measures) || ! array_is_list($measures) || $measures === [] || count($measures) > 10) {
            $this->issue('error', 'aggregate.measures_invalid', 'Defina de 1 a 10 medidas.', $position, "{$path}.measures");

            return null;
        }

        $groups = [];
        $outputNames = [];
        foreach ($groupBy as $i => $group) {
            $ref = is_array($group) ? $this->reference($group, $position, "{$path}.group_by.{$i}") : null;
            if ($ref === null) {
                return null;
            }
            $output = in_array($ref['column'], $outputNames, true) ? "{$ref['alias']}_{$ref['column']}" : $ref['column'];
            $outputNames[] = $output;
            $groups[] = ['alias' => $ref['alias'], 'column' => $ref['column'], 'input' => $ref['input'], 'output' => $output, 'type' => $ref['type']];
        }

        $normalized = [];
        foreach ($measures as $i => $measure) {
            $measurePath = "{$path}.measures.{$i}";
            $function = is_array($measure) ? ($measure['function'] ?? null) : null;

            if (! in_array($function, ['sum', 'count'], true)) {
                $this->issue('error', 'aggregate.function_invalid', 'Função inválida. Use sum (soma) ou count (contagem).', $position, "{$measurePath}.function");

                return null;
            }

            $name = $measure['name'] ?? null;
            if (! Identifier::isValid($name) || in_array($name, $outputNames, true)) {
                $this->issue('error', 'aggregate.name_invalid', 'Dê à medida um nome único com letras minúsculas, números e _ (ex.: total_refeicoes).', $position, "{$measurePath}.name");

                return null;
            }
            $outputNames[] = $name;

            if ($function === 'count') {
                $normalized[] = ['function' => 'count', 'name' => $name];

                continue;
            }

            $ref = $this->reference($measure, $position, $measurePath);
            if ($ref === null) {
                return null;
            }

            if ($ref['type'] !== 'number') {
                $this->issue('warning', 'aggregate.column_not_numeric', "{$ref['alias']}.{$ref['column']} não é inteiramente numérica: valores vazios ou não numéricos serão ignorados na soma e registrados como diagnóstico.", $position, $measurePath);
            }

            $normalized[] = ['function' => 'sum', 'alias' => $ref['alias'], 'column' => $ref['column'], 'input' => $ref['input'], 'name' => $name];
        }

        return ['type' => 'aggregate', 'group_by' => $groups, 'measures' => $normalized];
    }

    private function reference(array $ref, int $position, string $path): ?array
    {
        $alias = $ref['alias'] ?? null;
        $column = $ref['column'] ?? null;
        $input = is_string($alias) ? $this->inputByAlias($alias) : null;

        if ($input === null) {
            $this->issue('error', 'ref.alias_unknown', 'O conjunto '.(is_string($alias) ? "\"{$alias}\"" : '').' não está disponível neste passo. Relacione-o antes com uma junção.', $position, "{$path}.alias");

            return null;
        }

        if (! is_string($column) || ! isset($this->versions[$input['position']][$column])) {
            $this->issue('error', 'ref.column_unknown', 'A coluna '.(is_string($column) ? "\"{$column}\"" : '')." não existe em {$alias}.", $position, "{$path}.column");

            return null;
        }

        return ['alias' => $alias, 'column' => $column, 'input' => $input['position'], 'type' => $this->versions[$input['position']][$column]];
    }

    private function addInput(Dataset $dataset): array
    {
        $version = $dataset->latestVersion;
        $position = count($this->inputs);
        $this->versions[$position] = $version->columns->pluck('inferred_type', 'key')->all();

        $input = [
            'position' => $position,
            'alias' => $dataset->key,
            'dataset_id' => $dataset->id,
            'dataset_name' => $dataset->name,
            'version_id' => $version->id,
            'version_number' => $version->number,
            'columns' => $this->columnsOf($version),
        ];
        $this->inputs[] = $input;

        return $input;
    }

    private function columnsOf(DatasetVersion $version): array
    {
        return $version->columns->map(fn ($column) => [
            'key' => $column->key,
            'label' => $column->label,
            'type' => $column->inferred_type,
        ])->all();
    }

    private function aliasFor(string $datasetId): ?string
    {
        return $this->inputFor($datasetId)['alias'] ?? null;
    }

    private function inputFor(string $datasetId): ?array
    {
        foreach ($this->inputs as $input) {
            if ($input['dataset_id'] === $datasetId) {
                return $input;
            }
        }

        return null;
    }

    private function inputByAlias(string $alias): ?array
    {
        foreach ($this->inputs as $input) {
            if ($input['alias'] === $alias) {
                return $input;
            }
        }

        return null;
    }

    private function issue(string $severity, string $code, string $message, ?int $position, string $path, array $details = []): void
    {
        $this->issues[] = [
            'severity' => $severity,
            'code' => $code,
            'message' => $message,
            'step_position' => $position,
            'path' => $path,
            'details' => $details === [] ? new \stdClass : $details,
        ];
    }
}
