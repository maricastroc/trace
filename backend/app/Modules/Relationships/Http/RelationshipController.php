<?php

namespace App\Modules\Relationships\Http;

use App\Modules\Relationships\Relationship;
use App\Modules\Relationships\RelationshipDiscovery;
use App\Modules\Relationships\RelationshipPresenter;
use App\Modules\Relationships\RelationshipService;
use App\Modules\Support\DomainError;
use App\Modules\Support\Identifier;
use App\Modules\Support\Pagination;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class RelationshipController
{
    public function __construct(private readonly RelationshipService $service)
    {
    }

    public function index(Workspace $workspace): JsonResponse
    {
        $relationships = $workspace->relationships()
            ->with('fromDataset.latestVersion', 'toDataset.latestVersion')
            ->orderByRaw("CASE status WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END")
            ->orderByDesc('score')
            ->get();

        return response()->json(['data' => $relationships->map(fn (Relationship $r) => RelationshipPresenter::present($r))->all()]);
    }

    public function discover(Workspace $workspace, RelationshipDiscovery $discovery): JsonResponse
    {
        $found = $discovery->discover($workspace);

        return response()->json([
            'data' => $found->map(fn (Relationship $r) => RelationshipPresenter::present($r))->all(),
            'meta' => ['evaluated_at' => now()->toIso8601String(), 'found' => $found->count()],
        ]);
    }

    public function store(Request $request, Workspace $workspace): JsonResponse
    {
        $data = $request->validate([
            'from_dataset_id' => ['required', 'string'],
            'from_column' => ['required', 'string'],
            'to_dataset_id' => ['required', 'string'],
            'to_column' => ['required', 'string'],
        ], [
            '*.required' => 'Escolha os dois conjuntos e as colunas que devem se relacionar.',
        ]);

        foreach (['from_column', 'to_column'] as $field) {
            if (! Identifier::isValid($data[$field])) {
                throw new DomainError('relationship.column_invalid', 'Coluna inválida.', 422, ['field' => $field]);
            }
        }

        $relationship = $this->service->createManual($workspace, $data['from_dataset_id'], $data['from_column'], $data['to_dataset_id'], $data['to_column']);

        return response()->json(['data' => RelationshipPresenter::present($relationship)], 201);
    }

    public function show(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $workspace->relationships()->findOrFail($relationship);

        return response()->json(['data' => RelationshipPresenter::present($model, $this->service->currentEvidence($model))]);
    }

    public function unmatched(Request $request, Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $workspace->relationships()->findOrFail($relationship);
        $side = (string) $request->query('side', 'from');

        return response()->json($this->service->unmatchedRows($model, $side, Pagination::fromRequest($request)));
    }

    public function confirm(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $this->service->confirm($workspace->relationships()->findOrFail($relationship));

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }

    public function reject(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $this->service->reject($workspace->relationships()->findOrFail($relationship));

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }
}
