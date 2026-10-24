<?php

namespace App\Modules\Datasets;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DatasetVersion extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'dataset_id', 'number', 'source_filename', 'source_path', 'checksum', 'size_bytes',
        'encoding', 'delimiter', 'row_count', 'column_count', 'import_report',
    ];

    protected function casts(): array
    {
        return ['import_report' => 'array'];
    }

    public function dataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class);
    }

    public function columns(): HasMany
    {
        return $this->hasMany(DatasetColumn::class)->orderBy('position');
    }

    public function column(string $key): ?DatasetColumn
    {
        return $this->columns->firstWhere('key', $key);
    }

    public function columnKeys(): array
    {
        return $this->columns->pluck('key')->all();
    }
}
