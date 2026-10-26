<?php

namespace App\Modules\Relationships;

final class RelationshipPresenter
{
    public static function present(Relationship $relationship, ?array $currentEvidence = null): array
    {
        $relationship->loadMissing('fromDataset.latestVersion', 'toDataset.latestVersion.columns', 'fromVersion', 'toVersion');
        $evidence = $currentEvidence ?? $relationship->evidence;
        $fromLatest = $relationship->fromDataset->latestVersion?->id;
        $toLatest = $relationship->toDataset->latestVersion?->id;

        return [
            'id' => $relationship->id,
            'status' => $relationship->status,
            'policy' => $relationship->policy,
            'standing' => RelationshipStanding::of($relationship),
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
            'decided_versions' => $relationship->status === Relationship::SUGGESTED ? null : [
                'from' => $relationship->fromVersion?->number,
                'to' => $relationship->toVersion?->number,
            ],
            'confirmed_at' => $relationship->confirmed_at?->toIso8601String(),
            'rejected_at' => $relationship->rejected_at?->toIso8601String(),
            'identity_declared_at' => $relationship->identityDeclared() ? $relationship->identity_declared_at?->toIso8601String() : null,
            'created_at' => $relationship->created_at?->toIso8601String(),
        ];
    }
}
