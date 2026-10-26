<?php

namespace App\Modules\Comparisons;

use App\Modules\Runs\Engine\ExecutionBudget;
use App\Modules\Runs\Engine\ExecutionFailed;
use App\Modules\Runs\Engine\Pipeline;
use App\Modules\Runs\Lineage\RunLineage;
use App\Modules\Support\MemoryBudget;
use App\Modules\Workspaces\Workspace;

final class ComparisonPreview
{
    public function __construct(
        private readonly ComparisonPlanner $planner,
        private readonly Pipeline $pipeline,
        private readonly SideCollector $collector,
        private readonly ComparisonEngine $engine,
        private readonly RunLineage $lineage,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(Workspace $workspace, mixed $raw): array
    {
        $plan = $this->planner->plan($workspace, $raw);

        $payload = [
            'kind' => 'preview',
            'traceable' => false,
            'computed' => false,
            'reason' => null,
            'error' => null,
            'spec' => $plan->spec,
            'spec_key' => $plan->key,
            'sides' => ['a' => $plan->a->basis(), 'b' => $plan->b->basis()],
            'attribution' => $plan->attribution,
            'equivalence' => $plan->equivalence,
            'issues' => $plan->issues,
            'pending' => $plan->blockers(),
            'summary' => null,
            'samples' => null,
            'explained_samples' => null,
            'computed_at' => now()->toIso8601String(),
        ];

        if ($plan->stopsPreview()) {
            return ['reason' => 'blocked'] + $payload;
        }

        MemoryBudget::atLeast(512);
        $budget = ExecutionBudget::forPreview();

        try {
            [$a, $stepsA] = $this->collect($plan->a, $budget);
            [$b, $stepsB] = $this->collect($plan->b, $budget);
        } catch (ExecutionFailed $failure) {
            return ['reason' => 'failed', 'error' => $failure->toArray()] + $payload;
        }

        $result = $this->engine->compare($a, $b, $plan->rules, $plan->periods(), $plan->fields, ['a' => $stepsA, 'b' => $stepsB]);

        return [
            'computed' => true,
            'summary' => $result['summary'],
            'samples' => $this->engine->samples($result['identities']),
            'explained_samples' => $this->engine->explainedSamples($result['identities']),
            'issues' => array_merge($plan->issues, $result['caveats']),
        ] + $payload;
    }

    /**
     * @return array{0: SideSet, 1: list<array>}
     */
    private function collect(SidePlan $side, ExecutionBudget $budget): array
    {
        if ($side->run !== null) {
            return [$this->collector->fromRun($side->run, $side->source()), $this->lineage->steps($side->run)];
        }

        $outcome = $this->pipeline->execute($side->compiled->snapshot(null), (int) config('trace.limits.preview_tuples'), $budget);

        return [$this->collector->fromOutcome($outcome, $side->source()), $outcome->steps];
    }
}
