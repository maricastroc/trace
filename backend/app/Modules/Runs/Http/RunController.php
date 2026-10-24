<?php

namespace App\Modules\Runs\Http;

use App\Modules\Runs\Lineage\RowJourney;
use App\Modules\Runs\Lineage\RunLineage;
use App\Modules\Runs\Run;
use App\Modules\Runs\RunLauncher;
use App\Modules\Runs\RunPresenter;
use App\Modules\Support\DomainError;
use App\Modules\Support\Pagination;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class RunController
{
    public function __construct(private readonly RunLineage $lineage) {}

    public function store(Workspace $workspace, string $recipe, RunLauncher $launcher): JsonResponse
    {
        $run = $launcher->launch($workspace, $workspace->recipes()->findOrFail($recipe));

        return response()->json(['data' => $this->detail($run)], 202);
    }

    public function index(Request $request, Workspace $workspace): JsonResponse
    {
        $page = Pagination::fromRequest($request, 20, 100);
        $query = $workspace->runs()->latest('created_at')->latest('id');

        if (is_string($request->query('recipe_id'))) {
            $query->where('recipe_id', $request->query('recipe_id'));
        }

        $total = (clone $query)->count();
        $runs = $query->offset($page->offset())->limit($page->perPage)->get();

        return response()->json([
            'data' => $runs->map(fn (Run $run) => RunPresenter::summary($run))->all(),
            'meta' => $page->meta($total),
        ]);
    }

    public function show(Workspace $workspace, string $run): JsonResponse
    {
        return response()->json(['data' => $this->detail($this->find($workspace, $run))]);
    }

    public function results(Request $request, Workspace $workspace, string $run): JsonResponse
    {
        $model = $this->ready($workspace, $run);

        return response()->json($this->lineage->results($model, Pagination::fromRequest($request, 50, 200)) + [
            'columns' => $model->output_columns,
        ]);
    }

    public function flow(Request $request, Workspace $workspace, string $run): JsonResponse
    {
        $model = $this->ready($workspace, $run);
        $result = $request->query('result');

        return response()->json(['data' => $this->lineage->flow($model, is_numeric($result) ? (int) $result : null)]);
    }

    public function result(Workspace $workspace, string $run, int $resultNo): JsonResponse
    {
        return response()->json(['data' => $this->lineage->resultDetail($this->ready($workspace, $run), $resultNo)]);
    }

    public function contributors(Request $request, Workspace $workspace, string $run, int $resultNo): JsonResponse
    {
        return response()->json($this->lineage->contributors(
            $this->ready($workspace, $run),
            $resultNo,
            (int) $request->query('input', 0),
            Pagination::fromRequest($request),
            $this->optionalInt($request, 'via_input'),
            $this->optionalInt($request, 'via_row'),
        ));
    }

    public function breakdown(Request $request, Workspace $workspace, string $run, int $resultNo): JsonResponse
    {
        return response()->json($this->lineage->breakdown(
            $this->ready($workspace, $run),
            $resultNo,
            (int) $request->query('by', 0),
            Pagination::fromRequest($request),
        ));
    }

    public function exclusions(Request $request, Workspace $workspace, string $run): JsonResponse
    {
        return response()->json($this->lineage->exclusions(
            $this->ready($workspace, $run),
            array_filter([
                'step' => $this->optionalInt($request, 'step'),
                'code' => is_string($request->query('code')) ? $request->query('code') : null,
                'result' => $this->optionalInt($request, 'result'),
            ], fn ($value) => $value !== null),
            Pagination::fromRequest($request),
        ));
    }

    public function diagnostics(Request $request, Workspace $workspace, string $run): JsonResponse
    {
        return response()->json($this->lineage->diagnostics(
            $this->ready($workspace, $run),
            array_filter([
                'step' => $this->optionalInt($request, 'step'),
                'code' => is_string($request->query('code')) ? $request->query('code') : null,
                'severity' => is_string($request->query('severity')) ? $request->query('severity') : null,
            ], fn ($value) => $value !== null),
            Pagination::fromRequest($request),
        ));
    }

    public function journey(Request $request, Workspace $workspace, string $run, int $row, RowJourney $journey): JsonResponse
    {
        return response()->json(['data' => $journey->trace($this->ready($workspace, $run), $row, Pagination::fromRequest($request, 20, 100))]);
    }

    public function findRows(Request $request, Workspace $workspace, string $run): JsonResponse
    {
        $model = $this->ready($workspace, $run);
        $alias = $request->query('alias');
        if (! is_string($alias)) {
            throw new DomainError('run.search_invalid', 'Informe o conjunto (alias) a pesquisar.');
        }

        return response()->json(['data' => $this->lineage->findRows(
            $model,
            $alias,
            is_string($request->query('column')) ? $request->query('column') : null,
            is_string($request->query('value')) ? $request->query('value') : null,
            $this->optionalInt($request, 'row_number'),
        )]);
    }

    private function find(Workspace $workspace, string $run): Run
    {
        return $workspace->runs()->findOrFail($run);
    }

    private function ready(Workspace $workspace, string $run): Run
    {
        $model = $this->find($workspace, $run);

        if ($model->status !== Run::SUCCEEDED) {
            throw new DomainError('run.not_ready', 'Esta execução ainda não terminou com sucesso.', 409, ['status' => $model->status]);
        }

        return $model;
    }

    private function detail(Run $run): array
    {
        $currentRevision = $run->recipe_id ? DB::table('recipes')->where('id', $run->recipe_id)->value('revision') : null;
        $latest = DB::table('dataset_versions')
            ->whereIn('dataset_id', array_column($run->inputs(), 'dataset_id'))
            ->groupBy('dataset_id')
            ->selectRaw('dataset_id, max(number) AS number')
            ->pluck('number', 'dataset_id')
            ->map(fn ($n) => (int) $n)
            ->all();

        return RunPresenter::detail(
            $run,
            $run->status === Run::SUCCEEDED ? $this->lineage->steps($run) : $this->plannedSteps($run),
            $this->lineage->inputs($run),
            $currentRevision === null ? null : (int) $currentRevision,
            $latest,
        );
    }

    private function plannedSteps(Run $run): array
    {
        return array_map(fn (array $step) => [
            'position' => $step['position'],
            'id' => $step['id'],
            'type' => $step['type'],
            'title' => $step['title'],
            'summary' => $step['summary'],
            'input_count' => null,
            'output_count' => null,
            'excluded_count' => null,
            'duration_ms' => null,
            'stats' => null,
        ], $run->steps());
    }

    private function optionalInt(Request $request, string $key): ?int
    {
        $value = $request->query($key);

        return is_string($value) && preg_match('/^\d{1,9}$/', $value) === 1 ? (int) $value : null;
    }
}
