<?php

use App\Modules\Datasets\Http\DatasetController;
use App\Modules\Datasets\Http\DatasetVersionController;
use App\Modules\Recipes\Http\RecipeController;
use App\Modules\Relationships\Http\RelationshipController;
use App\Modules\Runs\Http\RunController;
use App\Modules\Workspaces\Http\ResolveWorkspace;
use App\Modules\Workspaces\Http\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('meta', [WorkspaceController::class, 'meta']);
    Route::post('workspaces', [WorkspaceController::class, 'store'])->middleware('throttle:workspaces');

    Route::middleware([ResolveWorkspace::class, 'throttle:workspace-api'])->group(function () {
        Route::get('workspace', [WorkspaceController::class, 'show']);

        Route::get('datasets', [DatasetController::class, 'index']);
        Route::post('datasets', [DatasetController::class, 'store'])->middleware('throttle:uploads');
        Route::post('imports/preview', [DatasetController::class, 'preview'])->middleware('throttle:uploads');
        Route::get('datasets/{dataset}', [DatasetController::class, 'show']);
        Route::delete('datasets/{dataset}', [DatasetController::class, 'destroy']);
        Route::post('datasets/{dataset}/versions', [DatasetController::class, 'storeVersion'])->middleware('throttle:uploads');
        Route::get('dataset-versions/{version}', [DatasetVersionController::class, 'show']);
        Route::get('dataset-versions/{version}/rows', [DatasetVersionController::class, 'rows']);

        Route::get('relationships', [RelationshipController::class, 'index']);
        Route::post('relationships', [RelationshipController::class, 'store']);
        Route::post('relationships/discover', [RelationshipController::class, 'discover']);
        Route::post('relationships/evaluate', [RelationshipController::class, 'evaluate']);
        Route::get('relationships/{relationship}', [RelationshipController::class, 'show']);
        Route::get('relationships/{relationship}/unmatched', [RelationshipController::class, 'unmatched']);
        Route::post('relationships/{relationship}/confirm', [RelationshipController::class, 'confirm']);
        Route::post('relationships/{relationship}/reject', [RelationshipController::class, 'reject']);
        Route::post('relationships/{relationship}/reopen', [RelationshipController::class, 'reopen']);
        Route::post('relationships/{relationship}/correct', [RelationshipController::class, 'correct']);

        Route::get('recipes', [RecipeController::class, 'index']);
        Route::post('recipes', [RecipeController::class, 'store']);
        Route::post('recipes/validate', [RecipeController::class, 'validateDraft']);
        Route::get('recipes/{recipe}', [RecipeController::class, 'show']);
        Route::put('recipes/{recipe}', [RecipeController::class, 'update']);
        Route::delete('recipes/{recipe}', [RecipeController::class, 'destroy']);
        Route::post('recipes/{recipe}/runs', [RunController::class, 'store']);

        Route::get('runs', [RunController::class, 'index']);
        Route::get('runs/{run}', [RunController::class, 'show']);
        Route::get('runs/{run}/results', [RunController::class, 'results']);
        Route::get('runs/{run}/flow', [RunController::class, 'flow']);
        Route::get('runs/{run}/flows', [RunController::class, 'flows']);
        Route::get('runs/{run}/results/{resultNo}', [RunController::class, 'result']);
        Route::get('runs/{run}/results/{resultNo}/contributors', [RunController::class, 'contributors']);
        Route::get('runs/{run}/results/{resultNo}/breakdown', [RunController::class, 'breakdown']);
        Route::get('runs/{run}/exclusions', [RunController::class, 'exclusions']);
        Route::get('runs/{run}/diagnostics', [RunController::class, 'diagnostics']);
        Route::get('runs/{run}/rows', [RunController::class, 'findRows']);
        Route::get('runs/{run}/rows/{row}/journey', [RunController::class, 'journey']);
    });
});
