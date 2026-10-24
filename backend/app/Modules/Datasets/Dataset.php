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

    protected $fillable = ['workspace_id', 'key', 'name', 'origin', 'is_synthetic'];

    protected function casts(): array
    {
        return ['is_synthetic' => 'boolean'];
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
