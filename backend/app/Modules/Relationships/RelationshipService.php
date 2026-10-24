<?php

namespace App\Modules\Relationships;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetColumn;
use App\Modules\Datasets\DatasetPresenter;
use App\Modules\Datasets\DatasetVersion;
use App\Modules\Support\DomainError;
use App\Modules\Support\Pagination;
use App\Modules\Workspaces\Workspace;
use Illuminate\Support\Facades\DB;

final class RelationshipService
{
    public function __construct(private readonly RelationshipAnalyzer $analyzer) {}

    public function currentEvidence(Relationship $relationship): array
    {
        [$fromVersion, $toVersion] = $this->latestVersions($relationship);

        return $this->analyzer->evaluate(
            $fromVersion,
            $this->column($fromVersion, $relationship->from_column),
            $toVersion,
            $this->column($toVersion, $relationship->to_column),
        );
    }

    public function createManual(Workspace $workspace, string $fromDatasetId, string $fromColumn, string $toDatasetId, string $toColumn): Relationship
    {
        if ($fromDatasetId === $toDatasetId) {
            throw new DomainError('relationship.same_dataset', 'Escolha colunas de dois conjuntos de dados diferentes.');
        }

        $from = $workspace->datasets()->with('latestVersion.columns', 'latestVersion.dataset')->findOrFail($fromDatasetId);
        $to = $workspace->datasets()->with('latestVersion.columns', 'latestVersion.dataset')->findOrFail($toDatasetId);

        $evidence = $this->analyzer->evaluate(
            $from->latestVersion,
            $this->column($from->latestVersion, $fromColumn),
            $to->latestVersion,
            $this->column($to->latestVersion, $toColumn),
        );

        $relationship = Relationship::query()->firstOrNew([
            'workspace_id' => $workspace->id,
            'from_dataset_id' => $from->id,
            'from_column' => $fromColumn,
            'to_dataset_id' => $to->id,
            'to_column' => $toColumn,
        ]);

        if (! $relationship->exists || $relationship->status === Relationship::REJECTED) {
            $relationship->fill([
                'status' => Relationship::SUGGESTED,
                'origin' => $relationship->origin ?? 'manual',
                'rejected_at' => null,
            ]);
        }

        $relationship->fill([
            'score' => $evidence['score'],
            'evidence' => $evidence,
            'from_version_id' => $from->latestVersion->id,
            'to_version_id' => $to->latestVersion->id,
        ])->save();

        return $relationship;
    }

    public function confirm(Relationship $relationship): Relationship
    {
        $evidence = $this->currentEvidence($relationship);

        $relationship->fill([
            'status' => Relationship::CONFIRMED,
            'score' => $evidence['score'],
            'evidence' => $evidence,
            'from_version_id' => $evidence['from']['version_id'],
            'to_version_id' => $evidence['to']['version_id'],
            'confirmed_at' => now(),
            'rejected_at' => null,
        ])->save();

        return $relationship;
    }

    public function reject(Relationship $relationship): Relationship
    {
        $relationship->fill([
            'status' => Relationship::REJECTED,
            'rejected_at' => now(),
            'confirmed_at' => null,
        ])->save();

        return $relationship;
    }

    public function unmatchedRows(Relationship $relationship, string $side, Pagination $page): array
    {
        [$fromVersion, $toVersion] = $this->latestVersions($relationship);

        [$where, $bindings] = match ($side) {
            'from' => [
                'r.dataset_version_id = ? AND (r."values"->>?) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_rows b WHERE b.dataset_version_id = ? AND b."values" @> jsonb_build_object(?::text, r."values"->>?))',
                [$fromVersion->id, $relationship->from_column, $toVersion->id, $relationship->to_column, $relationship->from_column],
            ],
            'from_null' => [
                'r.dataset_version_id = ? AND (r."values"->>?) IS NULL',
                [$fromVersion->id, $relationship->from_column],
            ],
            'to' => [
                'r.dataset_version_id = ? AND (r."values"->>?) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_rows b WHERE b.dataset_version_id = ? AND b."values" @> jsonb_build_object(?::text, r."values"->>?))',
                [$toVersion->id, $relationship->to_column, $fromVersion->id, $relationship->from_column, $relationship->to_column],
            ],
            default => throw new DomainError('relationship.invalid_side', 'Lado inválido. Use from, from_null ou to.'),
        };

        $total = (int) DB::selectOne("SELECT count(*) AS n FROM source_rows r WHERE {$where}", $bindings)->n;
        $rows = DB::select(
            "SELECT r.id, r.row_number, r.line_number, r.\"values\" FROM source_rows r WHERE {$where} ORDER BY r.row_number LIMIT ? OFFSET ?",
            [...$bindings, $page->perPage, $page->offset()],
        );

        $version = $side === 'to' ? $toVersion : $fromVersion;

        return [
            'data' => array_map(fn (object $row) => DatasetPresenter::row($row), $rows),
            'meta' => $page->meta($total) + [
                'side' => $side,
                'dataset_key' => $version->dataset->key,
                'version_id' => $version->id,
            ],
        ];
    }

    private function latestVersions(Relationship $relationship): array
    {
        $relationship->loadMissing('fromDataset.latestVersion.columns', 'fromDataset.latestVersion.dataset', 'toDataset.latestVersion.columns', 'toDataset.latestVersion.dataset');

        return [
            $this->latest($relationship->fromDataset),
            $this->latest($relationship->toDataset),
        ];
    }

    private function latest(Dataset $dataset): DatasetVersion
    {
        return $dataset->latestVersion ?? throw new DomainError('dataset.no_version', "O conjunto {$dataset->key} não possui versões.");
    }

    private function column(DatasetVersion $version, string $key): DatasetColumn
    {
        return $version->column($key) ?? throw new DomainError(
            'relationship.column_missing',
            "A coluna {$key} não existe na versão {$version->number} de {$version->dataset->key}.",
            422,
            ['column' => $key, 'version_id' => $version->id],
        );
    }
}
