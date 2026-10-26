<?php

namespace App\Modules\Runs;

use App\Modules\Recipes\CompiledRecipe;
use App\Modules\Recipes\Recipe;
use App\Modules\Recipes\RecipeCompiler;
use App\Modules\Runs\Jobs\ExecuteRun;
use App\Modules\Support\DomainError;
use App\Modules\Workspaces\Workspace;
use Illuminate\Support\Facades\DB;

final class RunLauncher
{
    public function __construct(private readonly RecipeCompiler $compiler) {}

    public function launch(Workspace $workspace, Recipe $recipe): Run
    {
        $compiled = $this->compiler->compile($workspace, $recipe->base_dataset_id, $recipe->steps);

        if (! $compiled->isRunnable()) {
            throw new DomainError('recipe.not_runnable', 'A receita ainda não pode ser executada.', 422, [
                'issues' => $compiled->blockers(),
            ]);
        }

        if ($compiled->steps === []) {
            throw new DomainError('recipe.empty', 'Adicione pelo menos um passo antes de executar.');
        }

        $run = $this->record($workspace, $compiled, $recipe);

        ExecuteRun::dispatch($run->id)->afterCommit();

        return $run->refresh();
    }

    public function record(Workspace $workspace, CompiledRecipe $compiled, ?Recipe $recipe): Run
    {
        return DB::transaction(function () use ($workspace, $recipe, $compiled) {
            $run = Run::create([
                'workspace_id' => $workspace->id,
                'recipe_id' => $recipe?->id,
                'recipe_revision' => $recipe?->revision ?? 1,
                'recipe_snapshot' => $compiled->snapshot($recipe),
                'status' => Run::QUEUED,
                'queued_at' => now(),
            ]);

            DB::table('run_inputs')->insert(array_map(fn (array $input) => [
                'run_id' => $run->id,
                'position' => $input['position'],
                'alias' => $input['alias'],
                'dataset_id' => $input['dataset_id'],
                'dataset_version_id' => $input['version_id'],
            ], $compiled->inputs));

            return $run;
        });
    }
}
