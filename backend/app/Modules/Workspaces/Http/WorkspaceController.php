<?php

namespace App\Modules\Workspaces\Http;

use App\Modules\Workspaces\Workspace;
use App\Modules\Workspaces\WorkspaceProvisioner;
use Illuminate\Http\JsonResponse;

final class WorkspaceController
{
    public function meta(): JsonResponse
    {
        return response()->json(['data' => [
            'product' => 'Trace',
            'tagline' => 'Every number has a story.',
            'mode' => config('trace.mode'),
            'uploads_enabled' => (bool) config('trace.uploads_enabled'),
            'limits' => [
                'upload_kb' => (int) config('trace.limits.upload_kb'),
                'rows' => (int) config('trace.limits.rows'),
                'columns' => (int) config('trace.limits.columns'),
                'tuples' => (int) config('trace.limits.tuples'),
            ],
            'workspace_ttl_days' => (int) config('trace.workspace_ttl_days'),
            'demo_notice' => 'Os dados de demonstração são sintéticos, criados para ilustrar o Trace. Não são dados oficiais de nenhum programa.',
        ]]);
    }

    public function store(WorkspaceProvisioner $provisioner): JsonResponse
    {
        [$workspace, $token] = $provisioner->create();

        return response()->json(['data' => $this->present($workspace) + ['token' => $token]], 201);
    }

    public function show(Workspace $workspace): JsonResponse
    {
        return response()->json(['data' => $this->present($workspace)]);
    }

    private function present(Workspace $workspace): array
    {
        return [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'created_at' => $workspace->created_at?->toIso8601String(),
            'counts' => [
                'datasets' => $workspace->datasets()->count(),
                'relationships' => $workspace->relationships()->count(),
                'recipes' => $workspace->recipes()->count(),
                'runs' => $workspace->runs()->count(),
            ],
        ];
    }
}
