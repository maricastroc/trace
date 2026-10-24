<?php

namespace App\Modules\Runs;

use App\Modules\Recipes\Recipe;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Run extends Model
{
    use HasUlids;

    public const QUEUED = 'queued';

    public const RUNNING = 'running';

    public const SUCCEEDED = 'succeeded';

    public const FAILED = 'failed';

    protected $fillable = [
        'workspace_id', 'recipe_id', 'recipe_revision', 'recipe_snapshot', 'status', 'error', 'output_columns',
        'result_count', 'tuple_count', 'queued_at', 'started_at', 'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'recipe_snapshot' => 'array',
            'error' => 'array',
            'output_columns' => 'array',
            'queued_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function recipe(): BelongsTo
    {
        return $this->belongsTo(Recipe::class);
    }

    public function isFinished(): bool
    {
        return in_array($this->status, [self::SUCCEEDED, self::FAILED], true);
    }

    public function inputs(): array
    {
        return $this->recipe_snapshot['inputs'];
    }

    public function steps(): array
    {
        return $this->recipe_snapshot['steps'];
    }

    public function inputByAlias(string $alias): ?array
    {
        foreach ($this->inputs() as $input) {
            if ($input['alias'] === $alias) {
                return $input;
            }
        }

        return null;
    }

    public function inputPosition(string $alias): ?int
    {
        return $this->inputByAlias($alias)['position'] ?? null;
    }
}
