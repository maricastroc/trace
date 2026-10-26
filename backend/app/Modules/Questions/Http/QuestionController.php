<?php

namespace App\Modules\Questions\Http;

use App\Modules\Questions\QuestionTranslator;
use App\Modules\Questions\TranslatedQuestion;
use App\Modules\Questions\ValidityCriteria;
use App\Modules\Recipes\Recipe;
use App\Modules\Recipes\RecipeCompiler;
use App\Modules\Recipes\RecipePreview;
use App\Modules\Runs\Engine\ExecutionBudget;
use App\Modules\Runs\Engine\ValidityRule;
use App\Modules\Runs\RunLauncher;
use App\Modules\Runs\RunPresenter;
use App\Modules\Support\Canonical;
use App\Modules\Support\DomainError;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class QuestionController
{
    public function __construct(
        private readonly QuestionTranslator $translator,
        private readonly RecipePreview $preview,
    ) {}

    public function preview(Request $request, Workspace $workspace): JsonResponse
    {
        $translated = $this->translated($workspace, $request->input('question'));
        $payload = [
            'question' => $translated->question,
            'question_key' => $translated->key,
            'needs_reading' => $translated->needsReading,
            'recipe' => null,
            'preview' => null,
        ];

        if (! $translated->needsReading) {
            $payload['recipe'] = ['base_dataset_id' => $translated->baseDatasetId, 'steps' => $translated->steps];
            $payload['preview'] = $this->preview->preview($workspace, $translated->baseDatasetId, $translated->steps);
        }

        return response()->json(['data' => $payload]);
    }

    public function readings(Request $request, Workspace $workspace): JsonResponse
    {
        $raw = $request->input('question');
        $translated = $this->translated($workspace, $raw);
        $period = $translated->question['period'];

        if ($period === null || $period['kind'] !== 'validity') {
            throw new DomainError('question.not_validity', 'Esta pergunta não tem um período por vigência para esclarecer.');
        }

        $validity = $workspace->datasets()->findOrFail($translated->baseDatasetId)->validity();
        $readings = [];
        $budget = ExecutionBudget::forPreview();

        foreach (ValidityRule::READINGS as $reading) {
            $raw['period']['reading'] = $reading;
            $option = $this->translated($workspace, $raw);
            $preview = $this->preview->preview($workspace, $option->baseDatasetId, $option->steps, null, $budget);

            $readings[] = [
                'reading' => $reading,
                'question_key' => $option->key,
                'computed' => $preview['computed'],
                'reason' => $preview['reason'],
                'value' => $preview['totals']['values'][QuestionTranslator::ANSWER] ?? null,
                'rows' => $preview['totals']['values'][QuestionTranslator::ROWS] ?? null,
                'excluded' => $this->validityExclusions($preview['steps']),
                'pending' => $preview['pending'],
                'criteria' => $validity === null ? null : ValidityCriteria::describe($reading, $period['from'], $period['to'], $validity),
            ];
        }

        return response()->json(['data' => ['declaration' => $validity, 'readings' => $readings]]);
    }

    public function trace(Request $request, Workspace $workspace, RecipeCompiler $compiler, RunLauncher $launcher): JsonResponse
    {
        $translated = $this->translated($workspace, $request->input('question'));

        if ($translated->needsReading) {
            throw new DomainError('question.reading_required', 'Escolha uma leitura do período antes de rastrear a resposta.');
        }

        $compiled = $compiler->compile($workspace, $translated->baseDatasetId, $translated->steps);
        if (! $compiled->isRunnable()) {
            throw new DomainError('recipe.not_runnable', 'A pergunta ainda depende de decisões antes de ser rastreada.', 422, ['issues' => $compiled->blockers()]);
        }

        $title = is_string($request->input('title')) && trim($request->input('title')) !== ''
            ? mb_substr(trim($request->input('title')), 0, 160)
            : 'Pergunta';
        $steps = $compiled->storableSteps();

        $recipe = DB::transaction(function () use ($workspace, $translated, $title, $steps): Recipe {
            $recipe = $workspace->recipes()->where('question_key', $translated->key)->lockForUpdate()->first();

            if ($recipe === null) {
                return $workspace->recipes()->create([
                    'name' => $title,
                    'base_dataset_id' => $translated->baseDatasetId,
                    'steps' => $steps,
                    'revision' => 1,
                    'question' => $translated->question,
                    'question_key' => $translated->key,
                ]);
            }

            $recipe->fill([
                'name' => $title,
                'steps' => $steps,
                'revision' => Canonical::same($steps, $recipe->steps) ? $recipe->revision : $recipe->revision + 1,
            ])->save();

            return $recipe;
        });

        $run = $launcher->launch($workspace, $recipe);

        return response()->json(['data' => [
            'recipe_id' => $recipe->id,
            'question_key' => $translated->key,
            'run' => RunPresenter::summary($run),
        ]], 202);
    }

    private function translated(Workspace $workspace, mixed $raw): TranslatedQuestion
    {
        $translated = $this->translator->translate($workspace, $raw);

        if (! $translated->isValid()) {
            throw new DomainError('question.invalid', $translated->errors[0]['message'], 422, ['issues' => $translated->errors]);
        }

        return $translated;
    }

    /**
     * @return array{out: int, undetermined: int}|null
     */
    private function validityExclusions(array $steps): ?array
    {
        foreach ($steps as $step) {
            $reasons = $step['stats']['excluded_by_reason'] ?? null;
            if (is_array($reasons) && array_key_exists(ValidityRule::OUT, $reasons)) {
                return ['out' => (int) $reasons[ValidityRule::OUT], 'undetermined' => (int) ($reasons[ValidityRule::UNDETERMINED] ?? 0)];
            }
        }

        return null;
    }
}
