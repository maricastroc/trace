<?php

namespace App\Modules\Comparisons;

use App\Modules\Comparisons\Jobs\ExecuteComparison;
use App\Modules\Runs\RunLauncher;
use App\Modules\Support\DomainError;
use App\Modules\Workspaces\Workspace;
use Illuminate\Support\Facades\DB;

final class ComparisonLauncher
{
    public function __construct(
        private readonly ComparisonPlanner $planner,
        private readonly RunLauncher $runs,
    ) {}

    public function trace(Workspace $workspace, mixed $raw, ?string $name): ComparisonRun
    {
        $plan = $this->planner->plan($workspace, $raw);

        if ($plan->blockers() !== []) {
            throw new DomainError('comparison.not_runnable', 'A comparação ainda depende de decisões antes de ser rastreada.', 422, ['issues' => $plan->blockers()]);
        }

        $name = $name !== null && trim($name) !== '' ? mb_substr(trim($name), 0, 160) : "{$plan->a->definition['label']} × {$plan->b->definition['label']}";

        $run = DB::transaction(function () use ($workspace, $plan, $name) {
            $comparison = Comparison::query()->where('workspace_id', $workspace->id)->where('spec_key', $plan->key)->lockForUpdate()->first()
                ?? Comparison::create(['workspace_id' => $workspace->id, 'name' => $name, 'spec' => $plan->spec, 'spec_key' => $plan->key]);
            $comparison->update(['name' => $name]);

            $sides = [];
            $runIds = [];
            foreach (['a' => $plan->a, 'b' => $plan->b] as $side => $sidePlan) {
                $runId = $sidePlan->run?->id ?? $this->runs->record($workspace, $sidePlan->compiled, null)->id;
                $runIds[$side] = $runId;
                $sides[$side] = $sidePlan->basis($runId) + [
                    'validity' => $sidePlan->validity,
                    'fields' => $sidePlan->fields,
                ];
            }

            return ComparisonRun::create([
                'workspace_id' => $workspace->id,
                'comparison_id' => $comparison->id,
                'spec' => $plan->spec,
                'run_a_id' => $runIds['a'],
                'run_b_id' => $runIds['b'],
                'sides' => $sides,
                'attribution' => $plan->attribution,
                'equivalence' => $plan->equivalence,
                'issues' => $plan->issues,
                'status' => ComparisonRun::QUEUED,
                'queued_at' => now(),
            ]);
        });

        ExecuteComparison::dispatch($run->id)->afterCommit();

        return $run->refresh();
    }
}
