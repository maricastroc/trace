<?php

namespace App\Modules\Recipes;

use App\Modules\Datasets\Dataset;
use App\Modules\Runs\Run;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Recipe extends Model
{
    use HasUlids;

    protected $fillable = ['workspace_id', 'name', 'description', 'base_dataset_id', 'steps', 'revision'];

    protected function casts(): array
    {
        return ['steps' => 'array'];
    }

    public function baseDataset(): BelongsTo
    {
        return $this->belongsTo(Dataset::class, 'base_dataset_id');
    }

    public function runs(): HasMany
    {
        return $this->hasMany(Run::class)->latest();
    }
}
