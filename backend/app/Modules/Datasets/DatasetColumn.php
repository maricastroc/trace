<?php

namespace App\Modules\Datasets;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DatasetColumn extends Model
{
    public $timestamps = false;

    protected $fillable = ['dataset_version_id', 'position', 'key', 'label', 'inferred_type', 'profile'];

    protected function casts(): array
    {
        return ['profile' => 'array'];
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(DatasetVersion::class, 'dataset_version_id');
    }
}
