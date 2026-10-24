<?php

namespace App\Modules\Workspaces;

use App\Modules\Datasets\Dataset;
use App\Modules\Recipes\Recipe;
use App\Modules\Relationships\Relationship;
use App\Modules\Runs\Run;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Workspace extends Model
{
    use HasUlids;

    protected $fillable = ['name', 'token_hash', 'last_active_at'];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return ['last_active_at' => 'datetime'];
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public function datasets(): HasMany
    {
        return $this->hasMany(Dataset::class);
    }

    public function relationships(): HasMany
    {
        return $this->hasMany(Relationship::class);
    }

    public function recipes(): HasMany
    {
        return $this->hasMany(Recipe::class);
    }

    public function runs(): HasMany
    {
        return $this->hasMany(Run::class);
    }
}
