<?php

namespace App\Modules\Comparisons;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Comparison extends Model
{
    use HasUlids;

    protected $fillable = ['workspace_id', 'name', 'spec', 'spec_key'];

    protected function casts(): array
    {
        return ['spec' => 'array'];
    }

    public function runs(): HasMany
    {
        return $this->hasMany(ComparisonRun::class)->latest('created_at')->latest('id');
    }
}
