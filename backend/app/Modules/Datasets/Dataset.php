<?php

namespace App\Modules\Datasets;

use App\Modules\Workspaces\Workspace;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Dataset extends Model
{
    use HasUlids;

    protected $fillable = [
        'workspace_id', 'key', 'name', 'origin', 'is_synthetic',
        'validity_start_column', 'validity_end_column', 'validity_end_inclusive', 'validity_declared_at',
    ];

    protected function casts(): array
    {
        return [
            'is_synthetic' => 'boolean',
            'validity_end_inclusive' => 'boolean',
            'validity_declared_at' => 'datetime',
        ];
    }

    /**
     * @return array{start_column: string, end_column: string|null, end_inclusive: bool, declared_at: string|null}|null
     */
    public function validity(): ?array
    {
        if ($this->validity_start_column === null) {
            return null;
        }

        return [
            'start_column' => $this->validity_start_column,
            'end_column' => $this->validity_end_column,
            'end_inclusive' => (bool) $this->validity_end_inclusive,
            'declared_at' => $this->validity_declared_at?->toIso8601String(),
        ];
    }

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    public function versions(): HasMany
    {
        return $this->hasMany(DatasetVersion::class)->orderByDesc('number');
    }

    public function latestVersion(): HasOne
    {
        return $this->hasOne(DatasetVersion::class)->ofMany('number', 'max');
    }
}
