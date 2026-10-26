<?php

namespace App\Modules\Questions;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetColumn;
use App\Modules\Datasets\Import\ValueParser;
use App\Modules\Runs\Engine\ValidityRule;
use App\Modules\Support\Canonical;
use App\Modules\Workspaces\Workspace;

final class QuestionTranslator
{
    public const ANSWER = 'resposta';

    public const ROWS = 'registros';

    public const MAX_PATH = 3;

    private array $errors = [];

    public function translate(Workspace $workspace, mixed $raw): TranslatedQuestion
    {
        $this->errors = [];

        if (! is_array($raw)) {
            $this->error('question.invalid', 'Envie a pergunta estruturada.', 'question');

            return TranslatedQuestion::invalid($this->errors);
        }

        $base = is_string($raw['base_dataset_id'] ?? null)
            ? $workspace->datasets()->with('latestVersion.columns')->find($raw['base_dataset_id'])
            : null;

        if ($base === null || $base->latestVersion === null) {
            $this->error('question.base_missing', 'Escolha a tabela da pergunta.', 'question.base_dataset_id');

            return TranslatedQuestion::invalid($this->errors);
        }

        $measure = $this->measure($base, $raw['measure'] ?? null);
        $period = $this->period($base, $raw['period'] ?? null);
        [$dimension, $final] = $this->dimension($workspace, $base, $raw['dimension'] ?? null);

        if ($this->errors !== []) {
            return TranslatedQuestion::invalid($this->errors);
        }

        $question = [
            'base_dataset_id' => $base->id,
            'measure' => $measure,
            'period' => $period,
            'dimension' => $dimension,
        ];
        $key = hash('sha256', json_encode(Canonical::normalize($question), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

        if ($period !== null && $period['kind'] === 'validity' && $period['reading'] === null) {
            return new TranslatedQuestion($question, $key, [], true, $base->id, []);
        }

        return new TranslatedQuestion($question, $key, [], false, $base->id, $this->steps($base, $final, $question));
    }

    private function measure(Dataset $base, mixed $raw): ?array
    {
        $function = is_array($raw) ? ($raw['function'] ?? null) : null;

        if (! in_array($function, ['count', 'count_distinct', 'sum'], true)) {
            $this->error('question.measure_invalid', 'Escolha o que contar: registros, valores diferentes ou a soma de uma coluna.', 'question.measure.function');

            return null;
        }

        if ($function === 'count') {
            return ['function' => 'count', 'column' => null];
        }

        $column = $raw['column'] ?? null;
        $type = is_string($column) ? $this->column($base, $column)?->inferred_type : null;

        if ($type === null) {
            $this->error('question.measure_column_unknown', "Escolha uma coluna de {$base->key} para a medida.", 'question.measure.column');

            return null;
        }

        if ($function === 'sum' && $type === 'date') {
            $this->error('question.measure_not_numeric', "{$base->key}.{$column} foi lida como data: só valores numéricos podem ser somados.", 'question.measure.column');

            return null;
        }

        return ['function' => $function, 'column' => $column];
    }

    private function period(Dataset $base, mixed $raw): ?array
    {
        if ($raw === null) {
            return null;
        }

        $kind = is_array($raw) ? ($raw['kind'] ?? null) : null;
        if (! in_array($kind, ['date', 'validity'], true)) {
            $this->error('question.period_invalid', 'O período precisa ser por uma coluna de data ou pela vigência da tabela.', 'question.period.kind');

            return null;
        }

        $from = is_string($raw['from'] ?? null) ? ValueParser::date(trim($raw['from'])) : null;
        $to = is_string($raw['to'] ?? null) ? ValueParser::date(trim($raw['to'])) : null;
        if ($from === null || $to === null || $from > $to) {
            $this->error('question.period_dates', 'Informe um período válido, com o início antes do fim.', 'question.period.from');

            return null;
        }

        if ($kind === 'date') {
            $column = $raw['column'] ?? null;
            if (! is_string($column) || $this->column($base, $column)?->inferred_type !== 'date') {
                $this->error('question.period_column', "Escolha uma coluna de datas de {$base->key} para o período.", 'question.period.column');

                return null;
            }

            return ['kind' => 'date', 'column' => $column, 'from' => $from, 'to' => $to];
        }

        $reading = $raw['reading'] ?? null;
        if ($reading !== null && ! in_array($reading, ValidityRule::READINGS, true)) {
            $this->error('question.reading_invalid', 'Leitura de vigência inválida. Use started, active_any ou active_at_end.', 'question.period.reading');

            return null;
        }

        return ['kind' => 'validity', 'reading' => $reading, 'from' => $from, 'to' => $to];
    }

    /**
     * @return array{0: array|null, 1: Dataset}
     */
    private function dimension(Workspace $workspace, Dataset $base, mixed $raw): array
    {
        if ($raw === null) {
            return [null, $base];
        }

        $ids = is_array($raw) ? ($raw['relationships'] ?? []) : null;
        if (! is_array($ids) || ! array_is_list($ids) || count($ids) > self::MAX_PATH) {
            $this->error('question.path_invalid', 'O caminho até o recorte pode ter no máximo '.self::MAX_PATH.' relações.', 'question.dimension.relationships');

            return [null, $base];
        }

        $relationships = $workspace->relationships()
            ->with('toDataset.latestVersion.columns')
            ->whereIn('id', array_values(array_filter($ids, 'is_string')))
            ->get()
            ->keyBy('id');

        $current = $base;
        $visited = [$base->id];
        foreach ($ids as $i => $id) {
            $relationship = is_string($id) ? $relationships->get($id) : null;
            $path = "question.dimension.relationships.{$i}";

            if ($relationship === null) {
                $this->error('question.path_unknown', 'Uma das relações do caminho não existe neste espaço.', $path);

                return [null, $base];
            }

            if ($relationship->from_dataset_id !== $current->id) {
                $this->error('question.path_broken', "O caminho precisa seguir as relações a partir de {$current->key}: cada relação sai da tabela alcançada pela anterior.", $path);

                return [null, $base];
            }

            if (in_array($relationship->to_dataset_id, $visited, true) || $relationship->toDataset->latestVersion === null) {
                $this->error('question.path_cycle', "O caminho passa duas vezes por {$relationship->toDataset->key}.", $path);

                return [null, $base];
            }

            $current = $relationship->toDataset;
            $visited[] = $current->id;
        }

        $column = $raw['column'] ?? null;
        if (! is_string($column) || $this->column($current, $column) === null) {
            $this->error('question.dimension_column', "Escolha uma coluna de {$current->key} para recortar ou agrupar.", 'question.dimension.column');

            return [null, $base];
        }

        $label = $raw['label_column'] ?? null;
        if ($label !== null && (! is_string($label) || $label === $column || $this->column($current, $label) === null)) {
            $this->error('question.label_unknown', "O rótulo precisa ser outra coluna de {$current->key}.", 'question.dimension.label_column');

            return [null, $base];
        }

        if ($label !== null && ($this->column($current, $column)->profile['unique'] ?? false) !== true) {
            $this->error('question.label_requires_key', "{$current->key}.{$column} tem valores repetidos: um rótulo poderia dividir o mesmo valor em grupos diferentes.", 'question.dimension.label_column');

            return [null, $base];
        }

        $value = $raw['value'] ?? null;
        if ($value !== null && (! is_string($value) || trim($value) === '' || mb_strlen($value) > 500)) {
            $this->error('question.dimension_value', 'O valor do recorte precisa ser um texto de até 500 caracteres.', 'question.dimension.value');

            return [null, $base];
        }

        return [[
            'relationships' => array_values($ids),
            'column' => $column,
            'label_column' => $label,
            'value' => $value,
        ], $current];
    }

    private function steps(Dataset $base, Dataset $final, array $question): array
    {
        $steps = [];
        $period = $question['period'];

        if ($period !== null && $period['kind'] === 'date') {
            $steps[] = ['id' => 'periodo', 'type' => 'filter', 'conditions' => [[
                'alias' => $base->key,
                'column' => $period['column'],
                'operator' => 'between',
                'value' => [$period['from'], $period['to']],
                'value_type' => 'date',
            ]]];
        }

        if ($period !== null && $period['kind'] === 'validity') {
            $steps[] = ['id' => 'vigencia', 'type' => 'filter', 'conditions' => [[
                'kind' => 'validity',
                'alias' => $base->key,
                'reading' => $period['reading'],
                'from' => $period['from'],
                'to' => $period['to'],
            ]]];
        }

        $dimension = $question['dimension'];
        $grouped = $dimension !== null && $dimension['value'] === null;

        foreach ($dimension['relationships'] ?? [] as $i => $id) {
            $steps[] = ['id' => 'ligacao_'.($i + 1), 'type' => 'join', 'relationship_id' => $id, 'join_type' => $grouped ? 'left' : 'inner'];
        }

        if ($dimension !== null && $dimension['value'] !== null) {
            $steps[] = ['id' => 'recorte', 'type' => 'filter', 'conditions' => [[
                'alias' => $final->key,
                'column' => $dimension['column'],
                'operator' => 'eq',
                'value' => $dimension['value'],
                'value_type' => 'text',
            ]]];
        }

        $groupBy = [];
        if ($grouped) {
            $groupBy[] = ['alias' => $final->key, 'column' => $dimension['column']];
            if ($dimension['label_column'] !== null) {
                $groupBy[] = ['alias' => $final->key, 'column' => $dimension['label_column']];
            }
        }

        $measure = $question['measure'];
        $measures = [$measure['function'] === 'count'
            ? ['function' => 'count', 'name' => self::ANSWER]
            : ['function' => $measure['function'], 'alias' => $base->key, 'column' => $measure['column'], 'name' => self::ANSWER]];

        if ($measure['function'] !== 'count') {
            $measures[] = ['function' => 'count', 'name' => self::ROWS];
        }

        $steps[] = ['id' => 'resposta', 'type' => 'aggregate', 'group_by' => $groupBy, 'measures' => $measures];

        return $steps;
    }

    private function column(Dataset $dataset, string $key): ?DatasetColumn
    {
        return $dataset->latestVersion?->column($key);
    }

    private function error(string $code, string $message, string $path): void
    {
        $this->errors[] = ['code' => $code, 'message' => $message, 'path' => $path];
    }
}
