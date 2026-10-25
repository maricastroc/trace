<?php

namespace App\Modules\Recipes\Http;

use App\Modules\Recipes\CompiledRecipe;
use App\Modules\Recipes\Recipe;
use App\Modules\Recipes\RecipeCompiler;
use App\Modules\Recipes\RecipePreview;
use App\Modules\Runs\Run;
use App\Modules\Runs\RunPresenter;
use App\Modules\Support\Canonical;
use App\Modules\Support\DomainError;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class RecipeController
{
    public function __construct(private readonly RecipeCompiler $compiler) {}

    public function index(Workspace $workspace): JsonResponse
    {
        $recipes = $workspace->recipes()->with('baseDataset')->orderBy('created_at')->get();

        return response()->json(['data' => $recipes->map(fn (Recipe $recipe) => $this->present($workspace, $recipe))->all()]);
    }

    public function validateDraft(Request $request, Workspace $workspace): JsonResponse
    {
        $compiled = $this->compiler->compile($workspace, $request->input('base_dataset_id'), $request->input('steps', []));

        return response()->json(['data' => $this->compiledPayload($compiled)]);
    }

    public function previewDraft(Request $request, Workspace $workspace, RecipePreview $preview): JsonResponse
    {
        return response()->json(['data' => $preview->preview($workspace, $request->input('base_dataset_id'), $request->input('steps', []))]);
    }

    public function preview(Workspace $workspace, string $recipe, RecipePreview $preview): JsonResponse
    {
        $model = $workspace->recipes()->findOrFail($recipe);

        return response()->json(['data' => $preview->preview($workspace, $model->base_dataset_id, $model->steps, $model)]);
    }

    public function store(Request $request, Workspace $workspace): JsonResponse
    {
        $data = $this->validated($request);
        $compiled = $this->compileOrFail($workspace, $data['base_dataset_id'], $data['steps'] ?? []);

        $recipe = $workspace->recipes()->create([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'base_dataset_id' => $compiled->baseDatasetId,
            'steps' => $compiled->storableSteps(),
            'revision' => 1,
        ]);

        return response()->json(['data' => $this->present($workspace, $recipe->load('baseDataset'), $compiled)], 201);
    }

    public function show(Workspace $workspace, string $recipe): JsonResponse
    {
        $model = $workspace->recipes()->with('baseDataset')->findOrFail($recipe);

        return response()->json(['data' => $this->present($workspace, $model)]);
    }

    public function update(Request $request, Workspace $workspace, string $recipe): JsonResponse
    {
        $model = $workspace->recipes()->findOrFail($recipe);
        $data = $this->validated($request);
        $compiled = $this->compileOrFail($workspace, $data['base_dataset_id'], $data['steps'] ?? []);
        $steps = $compiled->storableSteps();

        $changed = ! Canonical::same($steps, $model->steps) || $compiled->baseDatasetId !== $model->base_dataset_id;

        $model->fill([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'base_dataset_id' => $compiled->baseDatasetId,
            'steps' => $steps,
            'revision' => $changed ? $model->revision + 1 : $model->revision,
        ])->save();

        return response()->json(['data' => $this->present($workspace, $model->load('baseDataset'), $compiled)]);
    }

    public function destroy(Workspace $workspace, string $recipe): JsonResponse
    {
        $workspace->recipes()->findOrFail($recipe)->delete();

        return response()->json(null, 204);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'description' => ['nullable', 'string', 'max:2000'],
            'base_dataset_id' => ['required', 'string'],
            'steps' => ['present', 'array', 'max:20'],
        ], [
            'name.required' => 'Dê um nome à receita.',
            'name.max' => 'O nome pode ter no máximo 160 caracteres.',
            'base_dataset_id.required' => 'Escolha o conjunto de partida.',
            'steps.present' => 'Informe a lista de passos.',
            'steps.max' => 'Uma receita pode ter no máximo 20 passos.',
        ]);
    }

    private function compileOrFail(Workspace $workspace, string $baseDatasetId, array $steps): CompiledRecipe
    {
        $compiled = $this->compiler->compile($workspace, $baseDatasetId, $steps);

        if (! $compiled->isSavable()) {
            throw new DomainError('recipe.invalid', 'A receita tem passos inválidos.', 422, ['issues' => $compiled->errors()]);
        }

        return $compiled;
    }

    private function compiledPayload(CompiledRecipe $compiled): array
    {
        return [
            'base_dataset_id' => $compiled->baseDatasetId,
            'inputs' => $compiled->inputs,
            'steps' => $compiled->steps,
            'issues' => $compiled->issues,
            'savable' => $compiled->isSavable(),
            'runnable' => $compiled->isRunnable() && $compiled->steps !== [],
        ];
    }

    private function present(Workspace $workspace, Recipe $recipe, ?CompiledRecipe $compiled = null): array
    {
        $compiled ??= $this->compiler->compile($workspace, $recipe->base_dataset_id, $recipe->steps);
        $lastRun = $recipe->runs()->first();

        return [
            'id' => $recipe->id,
            'name' => $recipe->name,
            'description' => $recipe->description,
            'revision' => $recipe->revision,
            'base_dataset' => [
                'id' => $recipe->baseDataset->id,
                'key' => $recipe->baseDataset->key,
                'name' => $recipe->baseDataset->name,
            ],
            'definition' => ['base_dataset_id' => $recipe->base_dataset_id, 'steps' => $recipe->steps],
            'compiled' => $this->compiledPayload($compiled),
            'last_run' => $lastRun instanceof Run ? RunPresenter::summary($lastRun) : null,
            'created_at' => $recipe->created_at?->toIso8601String(),
            'updated_at' => $recipe->updated_at?->toIso8601String(),
        ];
    }
}
