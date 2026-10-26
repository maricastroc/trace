<?php

namespace App\Modules\Comparisons;

use App\Modules\Runs\Run;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ComparisonRun extends Model
{
    use HasUlids;

    public const QUEUED = 'queued';

    public const RUNNING = 'running';

    public const SUCCEEDED = 'succeeded';

    public const FAILED = 'failed';

    protected $fillable = [
        'workspace_id', 'comparison_id', 'spec', 'run_a_id', 'run_b_id', 'sides', 'attribution', 'equivalence', 'issues',
        'status', 'summary', 'error', 'duration_ms', 'queued_at', 'started_at', 'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'spec' => 'array',
            'sides' => 'array',
            'attribution' => 'array',
            'equivalence' => 'array',
            'issues' => 'array',
            'summary' => 'array',
            'error' => 'array',
            'queued_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function comparison(): BelongsTo
    {
        return $this->belongsTo(Comparison::class);
    }

    public function sideRun(string $side): ?Run
    {
        $id = $this->sides[$side]['run_id'] ?? null;

        return $id === null ? null : Run::query()->find($id);
    }
}
