<?php

namespace App\Modules\Relationships;

final class RelationshipPresenter
{
    public static function present(Relationship $relationship, ?array $currentEvidence = null): array
    {
        $relationship->loadMissing('fromDataset.latestVersion', 'toDataset.latestVersion');
        $evidence = $currentEvidence ?? $relationship->evidence;
        $fromLatest = $relationship->fromDataset->latestVersion?->id;
        $toLatest = $relationship->toDataset->latestVersion?->id;

        return [
            'id' => $relationship->id,
            'status' => $relationship->status,
            'origin' => $relationship->origin,
            'score' => $evidence['score'] ?? $relationship->score,
            'from' => [
                'dataset_id' => $relationship->from_dataset_id,
                'dataset_key' => $relationship->fromDataset->key,
                'dataset_name' => $relationship->fromDataset->name,
                'column' => $relationship->from_column,
            ],
            'to' => [
                'dataset_id' => $relationship->to_dataset_id,
                'dataset_key' => $relationship->toDataset->key,
                'dataset_name' => $relationship->toDataset->name,
                'column' => $relationship->to_column,
            ],
            'cardinality' => $evidence['cardinality'] ?? null,
            'cardinality_label' => isset($evidence['cardinality']) ? RelationshipAnalyzer::cardinalityLabel($evidence['cardinality']) : null,
            'evidence' => $evidence,
            'evidence_is_current' => $currentEvidence !== null || ($relationship->from_version_id === $fromLatest && $relationship->to_version_id === $toLatest),
            'evaluated_versions' => [
                'from' => $evidence['from']['version_id'] ?? $relationship->from_version_id,
                'to' => $evidence['to']['version_id'] ?? $relationship->to_version_id,
            ],
            'confirmed_at' => $relationship->confirmed_at?->toIso8601String(),
            'rejected_at' => $relationship->rejected_at?->toIso8601String(),
            'created_at' => $relationship->created_at?->toIso8601String(),
        ];
    }
}
