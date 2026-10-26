<?php

namespace App\Modules\Comparisons\Http;

use App\Modules\Comparisons\Comparison;
use App\Modules\Comparisons\ComparisonInvestigation;
use App\Modules\Comparisons\ComparisonLauncher;
use App\Modules\Comparisons\ComparisonPresenter;
use App\Modules\Comparisons\ComparisonPreview;
use App\Modules\Support\Pagination;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ComparisonController
{
    public function index(Workspace $workspace): JsonResponse
    {
        $comparisons = $workspace->comparisons()->latest('created_at')->get();

        return response()->json(['data' => $comparisons->map(fn (Comparison $c) => ComparisonPresenter::comparison($c))->all()]);
    }

    public function preview(Request $request, Workspace $workspace, ComparisonPreview $preview): JsonResponse
    {
        return response()->json(['data' => $preview->preview($workspace, $request->input('spec'))]);
    }

    public function trace(Request $request, Workspace $workspace, ComparisonLauncher $launcher): JsonResponse
    {
        $name = is_string($request->input('name')) ? $request->input('name') : null;
        $run = $launcher->trace($workspace, $request->input('spec'), $name);

        return response()->json(['data' => ComparisonPresenter::run($run)], 202);
    }

    public function runs(Request $request, Workspace $workspace): JsonResponse
    {
        $query = $workspace->comparisonRuns()->latest('created_at')->latest('id');
        if (is_string($request->query('comparison_id'))) {
            $query->where('comparison_id', $request->query('comparison_id'));
        }
        $page = Pagination::fromRequest($request, 20, 100);
        $total = (clone $query)->count();

        return response()->json([
            'data' => $query->offset($page->offset())->limit($page->perPage)->get()->map(fn ($run) => ComparisonPresenter::brief($run))->all(),
            'meta' => $page->meta($total),
        ]);
    }

    public function show(Workspace $workspace, string $run): JsonResponse
    {
        return response()->json(['data' => ComparisonPresenter::run($workspace->comparisonRuns()->findOrFail($run))]);
    }

    public function identities(Request $request, Workspace $workspace, string $run, ComparisonInvestigation $investigation): JsonResponse
    {
        $filters = array_filter([
            'category' => is_string($request->query('category')) ? $request->query('category') : null,
            'explanation' => is_string($request->query('explanation')) ? $request->query('explanation') : null,
            'repeated' => is_string($request->query('repeated')) ? $request->query('repeated') : null,
            'changed' => $request->boolean('changed') ?: null,
            'search' => is_string($request->query('search')) ? $request->query('search') : null,
        ], fn ($value) => $value !== null);

        return response()->json($investigation->identities($workspace->comparisonRuns()->findOrFail($run), $filters, Pagination::fromRequest($request, 25, 200)));
    }

    public function rows(Request $request, Workspace $workspace, string $run, ComparisonInvestigation $investigation): JsonResponse
    {
        return response()->json($investigation->rows(
            $workspace->comparisonRuns()->findOrFail($run),
            (string) $request->query('side', ''),
            is_string($request->query('identity')) ? $request->query('identity') : null,
            $request->boolean('empty'),
            (string) $request->query('state', 'selected'),
            Pagination::fromRequest($request, 20, 100),
        ));
    }
}
