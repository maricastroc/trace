<?php

namespace App\Modules\Relationships;

use App\Modules\Datasets\Dataset;
use App\Modules\Datasets\DatasetColumn;
use App\Modules\Datasets\DatasetVersion;
use App\Modules\Workspaces\Workspace;
use Illuminate\Support\Collection;

final class RelationshipDiscovery
{
    private const MIN_SCORE = 0.6;

    public function __construct(private readonly RelationshipAnalyzer $analyzer)
    {
    }

    public function discover(Workspace $workspace): Collection
    {
        $datasets = $workspace->datasets()->with('latestVersion.columns', 'latestVersion.dataset')->get()
            ->filter(fn (Dataset $dataset) => $dataset->latestVersion !== null)
            ->values();

        $candidates = [];

        foreach ($datasets as $fromDataset) {
            foreach ($datasets as $toDataset) {
                if ($fromDataset->id === $toDataset->id) {
                    continue;
                }

                foreach ($this->pairs($fromDataset->latestVersion, $toDataset->latestVersion) as $candidate) {
                    $candidates[] = $candidate;
                }
            }
        }

        $kept = $this->dropMirrors($candidates);

        return collect($kept)->map(fn (array $candidate) => $this->upsert($workspace, $candidate))
            ->sortByDesc('score')
            ->values();
    }

    private function pairs(DatasetVersion $fromVersion, DatasetVersion $toVersion): array
    {
        $found = [];

        foreach ($toVersion->columns as $toColumn) {
            if (! $this->isKeyCandidate($toColumn)) {
                continue;
            }

            $best = null;
            foreach ($fromVersion->columns as $fromColumn) {
                if (($fromColumn->profile['non_null'] ?? 0) === 0 || $fromColumn->inferred_type === 'date') {
                    continue;
                }

                $evidence = $this->analyzer->evaluate($fromVersion, $fromColumn, $toVersion, $toColumn);
                if (! $this->qualifies($evidence)) {
                    continue;
                }

                if ($best === null || $evidence['score'] > $best['evidence']['score']) {
                    $best = [
                        'from_version' => $fromVersion,
                        'from_column' => $fromColumn,
                        'to_version' => $toVersion,
                        'to_column' => $toColumn,
                        'evidence' => $evidence,
                    ];
                }
            }

            if ($best !== null) {
                $found[] = $best;
            }
        }

        return $found;
    }

    private function isKeyCandidate(DatasetColumn $column): bool
    {
        $profile = $column->profile;

        return $column->inferred_type !== 'date'
            && ($profile['non_null'] ?? 0) >= 2
            && ($profile['distinct'] ?? 0) >= 2
            && ($profile['unique'] ?? false) === true;
    }

    private function qualifies(array $evidence): bool
    {
        $match = $evidence['match'];

        if ($match['matched_distinct'] < 2 || $evidence['score'] < self::MIN_SCORE) {
            return false;
        }

        return $evidence['name']['matched'] || $match['match_ratio'] >= 0.8;
    }

    private function dropMirrors(array $candidates): array
    {
        $byPair = [];
        foreach ($candidates as $candidate) {
            $ends = [
                $candidate['from_version']->dataset_id.'.'.$candidate['from_column']->key,
                $candidate['to_version']->dataset_id.'.'.$candidate['to_column']->key,
            ];
            sort($ends);
            $pairKey = implode('|', $ends);

            if (! isset($byPair[$pairKey]) || $candidate['evidence']['score'] > $byPair[$pairKey]['evidence']['score']) {
                $byPair[$pairKey] = $candidate;
            }
        }

        return array_values($byPair);
    }

    private function upsert(Workspace $workspace, array $candidate): Relationship
    {
        $relationship = Relationship::query()->firstOrNew([
            'workspace_id' => $workspace->id,
            'from_dataset_id' => $candidate['from_version']->dataset_id,
            'from_column' => $candidate['from_column']->key,
            'to_dataset_id' => $candidate['to_version']->dataset_id,
            'to_column' => $candidate['to_column']->key,
        ]);

        if ($relationship->exists && $relationship->status !== Relationship::SUGGESTED) {
            return $relationship;
        }

        $relationship->fill([
            'status' => Relationship::SUGGESTED,
            'origin' => $relationship->origin ?? 'discovered',
            'score' => $candidate['evidence']['score'],
            'evidence' => $candidate['evidence'],
            'from_version_id' => $candidate['from_version']->id,
            'to_version_id' => $candidate['to_version']->id,
        ])->save();

        return $relationship;
    }
}
