<?php

namespace App\Modules\Workspaces;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class WorkspacePruner
{
    public function prune(int $inactiveDays): int
    {
        $pruned = 0;

        Workspace::query()
            ->where(fn ($q) => $q->where('last_active_at', '<', now()->subDays($inactiveDays))->orWhereNull('last_active_at'))
            ->orderBy('id')
            ->each(function (Workspace $workspace) use (&$pruned) {
                $this->delete($workspace);
                $pruned++;
            });

        return $pruned;
    }

    public function delete(Workspace $workspace): void
    {
        $paths = DB::table('dataset_versions')
            ->join('datasets', 'datasets.id', '=', 'dataset_versions.dataset_id')
            ->where('datasets.workspace_id', $workspace->id)
            ->pluck('dataset_versions.source_path')
            ->all();

        DB::transaction(function () use ($workspace) {
            $workspace->runs()->delete();
            $workspace->recipes()->delete();
            $workspace->delete();
        });
        Storage::disk('local')->delete($paths);
    }
}
