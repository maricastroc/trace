<?php

namespace App\Modules\Relationships\Http;

use App\Modules\Relationships\Relationship;
use App\Modules\Relationships\RelationshipAnalyzer;
use App\Modules\Relationships\RelationshipDiscovery;
use App\Modules\Relationships\RelationshipPresenter;
use App\Modules\Relationships\RelationshipService;
use App\Modules\Support\DomainError;
use App\Modules\Support\Identifier;
use App\Modules\Support\Pagination;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class RelationshipController
{
    public function __construct(private readonly RelationshipService $service) {}

    public function index(Workspace $workspace): JsonResponse
    {
        $relationships = $workspace->relationships()
            ->with('fromDataset.latestVersion', 'toDataset.latestVersion.columns', 'fromVersion', 'toVersion')
            ->orderByRaw("CASE status WHEN 'confirmed' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END")
            ->orderByDesc('score')
            ->get();

        return response()->json(['data' => $relationships->map(fn (Relationship $r) => RelationshipPresenter::present($r))->all()]);
    }

    public function discover(Request $request, Workspace $workspace, RelationshipDiscovery $discovery): JsonResponse
    {
        $focus = is_string($request->input('dataset_id')) ? $workspace->datasets()->findOrFail($request->input('dataset_id'))->id : null;
        $result = $discovery->search($workspace, $focus, (float) config('trace.limits.discovery_seconds'));

        return response()->json([
            'data' => $result['relationships']->map(fn (Relationship $r) => RelationshipPresenter::present($r))->all(),
            'meta' => [
                'evaluated_at' => now()->toIso8601String(),
                'found' => $result['relationships']->count(),
                'complete' => $result['complete'],
                'evaluated_pairs' => $result['evaluated'],
                'total_pairs' => $result['total'],
            ],
        ]);
    }

    public function store(Request $request, Workspace $workspace): JsonResponse
    {
        $data = $this->validatedPair($request);
        $relationship = $this->service->createManual($workspace, $data['from_dataset_id'], $data['from_column'], $data['to_dataset_id'], $data['to_column']);

        return response()->json(['data' => RelationshipPresenter::present($relationship)], 201);
    }

    public function evaluate(Request $request, Workspace $workspace): JsonResponse
    {
        $data = $this->validatedPair($request);
        $draft = $this->service->evaluateDraft($workspace, $data['from_dataset_id'], $data['from_column'], $data['to_dataset_id'], $data['to_column']);
        $existing = $draft['existing'];

        return response()->json(['data' => [
            'evidence' => $draft['evidence'],
            'cardinality' => $draft['evidence']['cardinality'],
            'cardinality_label' => RelationshipAnalyzer::cardinalityLabel($draft['evidence']['cardinality']),
            'existing' => $existing === null ? null : ['id' => $existing->id, 'status' => $existing->status],
        ]]);
    }

    public function correct(Request $request, Workspace $workspace, string $relationship): JsonResponse
    {
        $original = $workspace->relationships()->findOrFail($relationship);
        $data = $this->validatedPair($request->merge(['from_dataset_id' => $original->from_dataset_id]));
        $corrected = $this->service->correct($workspace, $original, $data['from_column'], $data['to_dataset_id'], $data['to_column']);

        return response()->json([
            'data' => RelationshipPresenter::present($corrected),
            'replaced' => RelationshipPresenter::present($original->refresh()),
        ]);
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

    public function confirm(Request $request, Workspace $workspace, string $relationship): JsonResponse
    {
        $data = $request->validate(
            ['policy' => ['nullable', 'string', Rule::in([Relationship::ACCEPT_MULTIPLICITY])]],
            ['policy.in' => 'Política desconhecida. A única política disponível é accept_multiplicity.'],
        );
        $model = $this->service->confirm($workspace->relationships()->findOrFail($relationship), $data['policy'] ?? null);

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }

    public function reject(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $this->service->reject($workspace->relationships()->findOrFail($relationship));

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }

    public function reopen(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $this->service->reopen($workspace->relationships()->findOrFail($relationship));

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }

    public function declareIdentity(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $this->service->declareIdentity($workspace->relationships()->findOrFail($relationship));

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }

    public function retractIdentity(Workspace $workspace, string $relationship): JsonResponse
    {
        $model = $this->service->retractIdentity($workspace->relationships()->findOrFail($relationship));

        return response()->json(['data' => RelationshipPresenter::present($model)]);
    }

    /**
     * @return array{from_dataset_id: string, from_column: string, to_dataset_id: string, to_column: string}
     */
    private function validatedPair(Request $request): array
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

        return $data;
    }
}
