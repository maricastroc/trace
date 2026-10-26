<?php

namespace App\Modules\Datasets\Http;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetEraser;
use App\Modules\Datasets\DatasetPresenter;
use App\Modules\Datasets\Import\CsvImporter;
use App\Modules\Support\DomainError;
use App\Modules\Support\UploadLimit;
use App\Modules\Workspaces\Workspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class DatasetController
{
    public function __construct(private readonly CsvImporter $importer) {}

    public function index(Workspace $workspace): JsonResponse
    {
        $datasets = $workspace->datasets()->with('latestVersion')->orderBy('created_at')->orderBy('id')->get();

        return response()->json(['data' => $datasets->map(fn (Dataset $d) => DatasetPresenter::summary($d))->all()]);
    }

    public function preview(Request $request): JsonResponse
    {
        $file = $this->validatedFile($request);

        return response()->json(['data' => $this->importer->preview($file->getRealPath(), $this->filename($file))]);
    }

    public function store(Request $request, Workspace $workspace): JsonResponse
    {
        $file = $this->validatedFile($request);
        $request->validate(['name' => ['nullable', 'string', 'max:160']], [
            'name.max' => 'O nome pode ter no máximo 160 caracteres.',
        ]);

        $attributes = array_filter(['name' => $request->string('name')->trim()->value() ?: null]);
        $version = $this->importer->importFile($workspace, $file->getRealPath(), $this->filename($file), null, $attributes);
        $dataset = $workspace->datasets()->with('latestVersion.columns', 'versions')->findOrFail($version->dataset_id);

        return response()->json(['data' => DatasetPresenter::detail($dataset)], 201);
    }

    public function show(Workspace $workspace, string $dataset): JsonResponse
    {
        $model = $workspace->datasets()->with('latestVersion.columns', 'versions')->findOrFail($dataset);

        return response()->json(['data' => DatasetPresenter::detail($model)]);
    }

    public function storeVersion(Request $request, Workspace $workspace, string $dataset): JsonResponse
    {
        $model = $workspace->datasets()->findOrFail($dataset);
        $file = $this->validatedFile($request);

        $this->importer->importFile($workspace, $file->getRealPath(), $this->filename($file), $model);
        $model = $workspace->datasets()->with('latestVersion.columns', 'versions')->findOrFail($dataset);

        return response()->json(['data' => DatasetPresenter::detail($model)], 201);
    }

    public function declareValidity(Request $request, Workspace $workspace, string $dataset): JsonResponse
    {
        $model = $workspace->datasets()->with('latestVersion.columns', 'versions')->findOrFail($dataset);
        $data = $request->validate([
            'start_column' => ['required', 'string'],
            'end_column' => ['nullable', 'string', 'different:start_column'],
            'end_inclusive' => ['required', 'boolean'],
        ], [
            'start_column.required' => 'Escolha a coluna que marca o início da vigência.',
            'end_column.different' => 'Início e fim da vigência precisam ser colunas diferentes.',
            'end_inclusive.required' => 'Diga se o dia do fim ainda conta como vigente.',
        ]);

        $version = $model->latestVersion ?? throw new DomainError('dataset.no_version', "O conjunto {$model->key} não possui versões.");
        foreach (['start_column' => 'início', 'end_column' => 'fim'] as $field => $label) {
            $key = $data[$field] ?? null;
            if ($key === null) {
                continue;
            }
            $column = $version->column($key) ?? throw new DomainError('dataset.column_unknown', "A coluna {$key} não existe nesta versão.", 422, ['field' => $field]);
            if ($column->inferred_type !== 'date') {
                throw new DomainError('dataset.validity_not_date', "A coluna de {$label} da vigência precisa conter datas; {$key} não contém.", 422, ['field' => $field]);
            }
        }

        $model->fill([
            'validity_start_column' => $data['start_column'],
            'validity_end_column' => $data['end_column'] ?? null,
            'validity_end_inclusive' => (bool) $data['end_inclusive'],
            'validity_declared_at' => now(),
        ])->save();

        return response()->json(['data' => DatasetPresenter::detail($model)]);
    }

    public function clearValidity(Workspace $workspace, string $dataset): JsonResponse
    {
        $model = $workspace->datasets()->with('latestVersion.columns', 'versions')->findOrFail($dataset);
        $model->fill([
            'validity_start_column' => null,
            'validity_end_column' => null,
            'validity_end_inclusive' => null,
            'validity_declared_at' => null,
        ])->save();

        return response()->json(['data' => DatasetPresenter::detail($model)]);
    }

    public function dependents(Workspace $workspace, string $dataset, DatasetEraser $eraser): JsonResponse
    {
        $model = $workspace->datasets()->with('versions')->findOrFail($dataset);

        return response()->json(['data' => $eraser->dependents($workspace, $model)]);
    }

    public function erasures(Workspace $workspace): JsonResponse
    {
        $rows = DB::table('dataset_erasures')->where('workspace_id', $workspace->id)->orderByDesc('erased_at')->get();

        return response()->json(['data' => $rows->map(fn (object $row) => [
            'dataset_key' => $row->dataset_key,
            'dataset_name' => $row->dataset_name,
            'versions' => json_decode($row->versions, true),
            'removed' => json_decode($row->removed, true),
            'erased_at' => Carbon::parse($row->erased_at)->toIso8601String(),
        ])->all()]);
    }

    public function destroy(Request $request, Workspace $workspace, string $dataset, DatasetEraser $eraser): JsonResponse
    {
        $model = $workspace->datasets()->with('versions')->findOrFail($dataset);

        if (! $eraser->hasHistory($workspace, $model)) {
            $eraser->erase($workspace, $model);

            return response()->json(null, 204);
        }

        $dependents = $eraser->dependents($workspace, $model);

        if (! $request->boolean('with_history')) {
            throw new DomainError('dataset.in_use', 'Esta tabela foi usada em execuções, perguntas ou comparações. Para excluí-la, é preciso excluir também esse histórico.', 409, ['dependents' => $dependents]);
        }

        if ($request->input('confirm') !== $model->key) {
            throw new DomainError('dataset.confirmation_required', "Para excluir {$model->key} com o histórico que depende dela, digite o nome da tabela para confirmar.", 422, ['dependents' => $dependents]);
        }

        return response()->json(['data' => $eraser->erase($workspace, $model)]);
    }

    private function validatedFile(Request $request): UploadedFile
    {
        if (! config('trace.uploads_enabled')) {
            throw new DomainError('uploads.disabled', 'O envio de arquivos está desativado nesta demonstração pública. Explore os dados sintéticos.', 403);
        }

        $maxKb = UploadLimit::kilobytes();
        $request->validate([
            'file' => ['required', 'file', "max:{$maxKb}", 'extensions:csv,txt,tsv'],
        ], [
            'file.required' => 'Selecione um arquivo CSV.',
            'file.uploaded' => "O servidor não recebeu o arquivo inteiro. O limite de envio desta instalação é {$maxKb} KB.",
            'file.file' => 'O envio do arquivo falhou. Tente novamente.',
            'file.max' => "O arquivo excede o limite de {$maxKb} KB desta instalação.",
            'file.extensions' => 'Envie um arquivo .csv, .tsv ou .txt.',
        ]);

        return $request->file('file');
    }

    private function filename(UploadedFile $file): string
    {
        $name = basename($file->getClientOriginalName());

        return preg_replace('/[^\pL\pN._ -]+/u', '_', $name) ?: 'arquivo.csv';
    }
}
