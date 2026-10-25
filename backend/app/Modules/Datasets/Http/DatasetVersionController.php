<?php

namespace App\Modules\Datasets\Http;

use App\Modules\Datasets\DatasetPresenter;
use App\Modules\Datasets\DatasetVersion;
use App\Modules\Support\DomainError;
use App\Modules\Support\Pagination;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class DatasetVersionController
{
    public function show(Workspace $workspace, string $version): JsonResponse
    {
        return response()->json(['data' => DatasetPresenter::version($this->find($workspace, $version))]);
    }

    public function rows(Request $request, Workspace $workspace, string $version): JsonResponse
    {
        $model = $this->find($workspace, $version);
        $page = Pagination::fromRequest($request, 50, 200);
        $query = DB::table('source_rows')->where('dataset_version_id', $model->id);

        $column = $request->query('column');
        if (is_string($column) && $column !== '' && $request->query->has('value')) {
            if (! in_array($column, $model->columnKeys(), true)) {
                throw new DomainError('dataset.column_unknown', "A coluna {$column} não existe nesta versão.");
            }
            $value = $request->query('value');
            $value === null || $value === ''
                ? $query->whereRaw('("values"->>?) IS NULL', [$column])
                : $query->whereRaw('"values" @> jsonb_build_object(?::text, ?::text)', [$column, (string) $value]);
        }

        $total = (clone $query)->count();
        $rows = $query->orderBy('row_number')
            ->offset($page->offset())
            ->limit($page->perPage)
            ->get(['id', 'row_number', 'line_number', 'values']);

        return response()->json([
            'data' => $rows->map(fn (object $row) => DatasetPresenter::row($row))->all(),
            'meta' => $page->meta($total),
        ]);
    }

    private function find(Workspace $workspace, string $version): DatasetVersion
    {
        return DatasetVersion::query()
            ->with('columns', 'dataset')
            ->whereKey($version)
            ->whereHas('dataset', fn ($q) => $q->where('workspace_id', $workspace->id))
            ->firstOrFail();
    }
}
