<?php

namespace App\Modules\Relationships;

use App\Modules\Datasets\Dataset;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Relationship extends Model
{
    use HasUlids;

    public const SUGGESTED = 'suggested';

    public const CONFIRMED = 'confirmed';

    public const REJECTED = 'rejected';

    public const ACCEPT_MULTIPLICITY = 'accept_multiplicity';

    protected $fillable = [
        'workspace_id', 'from_dataset_id', 'from_column', 'to_dataset_id', 'to_column', 'status', 'policy', 'origin',
        'score', 'evidence', 'from_version_id', 'to_version_id', 'confirmed_at', 'rejected_at',
    ];

    protected function casts(): array
    {
        return [
            'evidence' => 'array',
            'score' => 'float',
            'confirmed_at' => 'datetime',
            'rejected_at' => 'datetime',
        ];
    }

    public function fromDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'from_dataset_id');
    }

    public function toDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'to_dataset_id');
    }

    public function isConfirmed(): bool
    {
        return $this->status === self::CONFIRMED;
    }
}
