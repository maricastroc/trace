<?php

namespace App\Modules\Comparisons;

use App\Modules\Datasets\Dataset;
use App\Modules\Questions\QuestionTranslator;
use App\Modules\Recipes\RecipeCompiler;
use App\Modules\Runs\Run;
use App\Modules\Support\Canonical;
use App\Modules\Support\DomainError;
use App\Modules\Workspaces\Workspace;

final class ComparisonPlanner
{
    public const MAX_FIELDS = 10;

    private array $issues = [];

    public function __construct(
        private readonly QuestionTranslator $translator,
        private readonly RecipeCompiler $compiler,
    ) {}

    public function plan(Workspace $workspace, mixed $raw): ComparisonPlan
    {
        $this->issues = [];

        if (! is_array($raw) || ! is_array($raw['a'] ?? null) || ! is_array($raw['b'] ?? null)) {
            throw new DomainError('comparison.invalid', 'Defina os dois lados da comparação, A e B.', 422, ['issues' => [$this->make('error', 'comparison.sides_missing', 'Defina os dois lados da comparação, A e B.', null, 'spec')]]);
        }

        $rules = $this->rules($raw['rules'] ?? []);
        $fieldPairs = $this->fieldPairs($raw['fields'] ?? []);

        $a = $this->side($workspace, 'a', $raw['a'], array_column($fieldPairs, 'a'));
        $b = $this->side($workspace, 'b', $raw['b'], array_column($fieldPairs, 'b'));

        $errors = array_values(array_filter($this->issues, fn (array $issue) => $issue['severity'] === 'error'));
        if ($errors !== [] || $a === null || $b === null) {
            throw new DomainError('comparison.invalid', $errors[0]['message'] ?? 'A comparação tem partes inválidas.', 422, ['issues' => $errors]);
        }

        if ($a->keyType !== null && $b->keyType !== null && $a->keyType !== $b->keyType) {
            $this->issue('warning', 'comparison.key_types_differ', "As chaves têm tipos diferentes ({$a->key}: {$a->keyType}; {$b->key}: {$b->keyType}). A comparação continua exata, por texto, e pode encontrar poucos pares.", null, 'spec');
        }

        $equivalence = $this->equivalence($workspace, $a, $b, $raw['equivalence'] ?? null);

        $spec = ['a' => $a->definition, 'b' => $b->definition, 'rules' => $rules, 'fields' => $fieldPairs];
        if ($equivalence['status'] === Equivalence::DECLARED) {
            $spec['equivalence'] = Equivalence::declaration($a, $b);
        }
        $key = hash('sha256', json_encode(Canonical::normalize($spec), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

        return new ComparisonPlan($spec, $key, $a, $b, $rules, $fieldPairs, $this->issues, Attribution::of($a, $b), $equivalence);
    }

    /**
     * @return array<string, mixed>
     */
    private function equivalence(Workspace $workspace, SidePlan $a, SidePlan $b, mixed $declared): array
    {
        $relationship = $workspace->relationships()
            ->where(fn ($query) => $query
                ->where(fn ($q) => $q->where('from_dataset_id', $a->dataset->id)->where('from_column', $a->key)->where('to_dataset_id', $b->dataset->id)->where('to_column', $b->key))
                ->orWhere(fn ($q) => $q->where('from_dataset_id', $b->dataset->id)->where('from_column', $b->key)->where('to_dataset_id', $a->dataset->id)->where('to_column', $a->key)))
            ->first();

        $equivalence = Equivalence::of($a, $b, $relationship, $declared);

        if ($declared !== null && $equivalence['status'] !== Equivalence::DECLARED && ! Equivalence::matches($declared, $a, $b)) {
            $this->issue('warning', 'comparison.equivalence_stale', 'A declaração de equivalência não corresponde às colunas escolhidas agora e foi ignorada. Confirme de novo para estas colunas.', null, 'spec.equivalence');
        }
        if ($equivalence['status'] === Equivalence::UNCONFIRMED) {
            $this->issue('blocker', 'comparison.equivalence_unconfirmed', "Confirme que {$equivalence['a']['name']} e {$equivalence['b']['name']} identificam a mesma entidade. Sem essa confirmação, a comparação não é rastreada.", null, 'spec.equivalence', [
                'a' => $equivalence['a'],
                'b' => $equivalence['b'],
                'relationship_id' => $equivalence['relationship_id'],
            ]);
        }

        return $equivalence;
    }

    private function side(Workspace $workspace, string $side, array $raw, array $fields): ?SidePlan
    {
        $kind = $raw['kind'] ?? null;
        $path = "spec.{$side}";

        if ($kind === 'run') {
            return $this->runSide($workspace, $side, $raw, $fields, $path);
        }

        if ($kind !== 'population') {
            $this->issue('error', 'comparison.side_kind', "Lado {$this->name($side)}: escolha uma população de uma tabela ou uma execução rastreada.", $side, "{$path}.kind");

            return null;
        }

        $dataset = is_string($raw['dataset_id'] ?? null) ? $workspace->datasets()->with('latestVersion.columns')->find($raw['dataset_id']) : null;
        if ($dataset === null || $dataset->latestVersion === null) {
            $this->issue('error', 'comparison.dataset_missing', "Lado {$this->name($side)}: escolha uma tabela deste espaço.", $side, "{$path}.dataset_id");

            return null;
        }

        $versionId = $raw['version_id'] ?? null;
        $version = $versionId === null ? $dataset->latestVersion : (is_string($versionId) ? $dataset->versions()->with('columns')->find($versionId) : null);
        if ($version === null) {
            $this->issue('error', 'comparison.version_unavailable', "Lado {$this->name($side)}: a versão escolhida de {$dataset->key} não existe.", $side, "{$path}.version_id");

            return null;
        }

        $key = $raw['key'] ?? null;
        $column = is_string($key) ? $version->column($key) : null;
        if ($column === null) {
            $this->issue('error', 'comparison.key_missing', "Lado {$this->name($side)}: escolha a coluna identificadora de {$dataset->key}".(is_string($key) ? "; {$key} não existe na versão {$version->number}" : '').'.', $side, "{$path}.key");

            return null;
        }

        if (! $this->fieldsExist($side, $fields, $version->columns->pluck('key')->all(), $dataset->key)) {
            return null;
        }

        $dimension = $raw['dimension'] ?? null;
        if (is_array($dimension) && ($dimension['value'] ?? null) === null) {
            $this->issue('error', 'comparison.dimension_value_required', "Lado {$this->name($side)}: o recorte precisa de um valor. Um lado é uma população, não um agrupamento.", $side, "{$path}.dimension.value");

            return null;
        }

        $translated = $this->translator->translate($workspace, [
            'base_dataset_id' => $dataset->id,
            'measure' => ['function' => 'count'],
            'period' => $raw['period'] ?? null,
            'dimension' => $dimension,
        ]);
        if (! $translated->isValid()) {
            foreach ($translated->errors as $error) {
                $this->issue('error', $error['code'], "Lado {$this->name($side)}: {$error['message']}", $side, $path.substr($error['path'], strlen('question')));
            }

            return null;
        }
        if ($translated->needsReading) {
            $this->issue('error', 'comparison.reading_required', "Lado {$this->name($side)}: escolha a leitura da vigência (começaram, ativos em algum momento ou ativos no último dia).", $side, "{$path}.period.reading");

            return null;
        }

        $steps = array_slice($translated->steps, 0, -1);
        $steps[] = ['id' => 'identidades', 'type' => 'aggregate', 'group_by' => [['alias' => $dataset->key, 'column' => $key]], 'measures' => [['function' => 'count', 'name' => 'ocorrencias']]];
        $compiled = $this->compiler->compile($workspace, $dataset->id, $steps, [$dataset->id => $version->id]);
        foreach ($compiled->issues as $issue) {
            $this->issue($issue['severity'], $issue['code'], "Lado {$this->name($side)}: {$issue['message']}", $side, $path, (array) $issue['details']);
        }

        $definition = [
            'kind' => 'population',
            'label' => $this->label($raw, $dataset->key),
            'dataset_id' => $dataset->id,
            'version_id' => $versionId,
            'key' => $key,
            'period' => $translated->question['period'],
            'dimension' => $translated->question['dimension'],
        ];

        return new SidePlan($side, $definition, $dataset, $version, $version->id, $key, $column->inferred_type, $compiled, null, $dataset->validity(), $fields);
    }

    private function runSide(Workspace $workspace, string $side, array $raw, array $fields, string $path): ?SidePlan
    {
        $run = is_string($raw['run_id'] ?? null) ? $workspace->runs()->find($raw['run_id']) : null;
        if (! $run instanceof Run) {
            $this->issue('error', 'comparison.run_missing', "Lado {$this->name($side)}: escolha uma execução rastreada deste espaço.", $side, "{$path}.run_id");

            return null;
        }
        if ($run->status !== Run::SUCCEEDED) {
            $this->issue('error', 'comparison.run_not_ready', "Lado {$this->name($side)}: a execução escolhida ainda não terminou com sucesso.", $side, "{$path}.run_id");

            return null;
        }

        $input = $run->inputs()[0];
        $dataset = Dataset::query()->find($input['dataset_id']);
        $version = $dataset?->versions()->with('columns')->find($input['version_id']);
        if ($dataset === null || $version === null) {
            $this->issue('error', 'comparison.version_unavailable', "Lado {$this->name($side)}: a versão usada pela execução não está mais disponível.", $side, "{$path}.run_id");

            return null;
        }

        $key = $raw['key'] ?? null;
        $column = is_string($key) ? $version->column($key) : null;
        if ($column === null) {
            $this->issue('error', 'comparison.key_missing', "Lado {$this->name($side)}: escolha a coluna identificadora de {$input['alias']}, a tabela de partida da execução.", $side, "{$path}.key");

            return null;
        }

        if (! $this->fieldsExist($side, $fields, $version->columns->pluck('key')->all(), $dataset->key)) {
            return null;
        }

        $definition = ['kind' => 'run', 'label' => $this->label($raw, $input['alias']), 'run_id' => $run->id, 'key' => $key];

        return new SidePlan($side, $definition, $dataset, $version, $version->id, $key, $column->inferred_type, null, $run, $dataset->validity(), $fields);
    }

    /**
     * @return list<string>
     */
    private function rules(mixed $raw): array
    {
        if (! is_array($raw) || array_diff($raw, IdentityRules::SUPPORTED) !== []) {
            $this->issue('error', 'comparison.rule_unknown', 'Regra de normalização desconhecida. Use leading_zeros ou case_and_spacing.', null, 'spec.rules');

            return [];
        }
        $rules = array_values(array_unique($raw));
        sort($rules);

        return $rules;
    }

    /**
     * @return list<array{a: string, b: string}>
     */
    private function fieldPairs(mixed $raw): array
    {
        if (! is_array($raw) || ! array_is_list($raw) || count($raw) > self::MAX_FIELDS) {
            $this->issue('error', 'comparison.fields_invalid', 'Escolha até '.self::MAX_FIELDS.' pares de campos para comparar.', null, 'spec.fields');

            return [];
        }

        $pairs = [];
        foreach ($raw as $i => $pair) {
            if (! is_array($pair) || ! is_string($pair['a'] ?? null) || ! is_string($pair['b'] ?? null)) {
                $this->issue('error', 'comparison.fields_invalid', 'Cada campo comparado precisa de uma coluna em A e uma em B.', null, "spec.fields.{$i}");

                continue;
            }
            $pairs[] = ['a' => $pair['a'], 'b' => $pair['b']];
        }

        return $pairs;
    }

    private function fieldsExist(string $side, array $fields, array $columns, string $table): bool
    {
        foreach ($fields as $field) {
            if (! in_array($field, $columns, true)) {
                $this->issue('error', 'comparison.field_missing', "Lado {$this->name($side)}: a coluna {$field} não existe em {$table}.", $side, 'spec.fields');

                return false;
            }
        }

        return true;
    }

    private function label(array $raw, string $fallback): string
    {
        $label = is_string($raw['label'] ?? null) ? trim($raw['label']) : '';

        return $label === '' ? $fallback : mb_substr($label, 0, 80);
    }

    private function name(string $side): string
    {
        return strtoupper($side);
    }

    private function issue(string $severity, string $code, string $message, ?string $side, string $path, array $details = []): void
    {
        $this->issues[] = $this->make($severity, $code, $message, $side, $path, $details);
    }

    private function make(string $severity, string $code, string $message, ?string $side, string $path, array $details = []): array
    {
        return ['severity' => $severity, 'code' => $code, 'message' => $message, 'side' => $side, 'path' => $path, 'details' => $details === [] ? new \stdClass : $details];
    }
}
