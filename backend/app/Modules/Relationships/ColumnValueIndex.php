<?php

namespace App\Modules\Relationships;

use Illuminate\Support\Facades\DB;

final class ColumnValueIndex
{
    private array $cache = [];

    public function counts(string $versionId, string $column): array
    {
        return $this->load($versionId, $column)['counts'];
    }

    public function nulls(string $versionId, string $column): int
    {
        return $this->load($versionId, $column)['nulls'];
    }

    private function load(string $versionId, string $column): array
    {
        $cacheKey = "{$versionId}:{$column}";

        if (! isset($this->cache[$cacheKey])) {
            $rows = DB::select(
                'SELECT "values"->>? AS v, count(*) AS n FROM source_rows WHERE dataset_version_id = ? GROUP BY 1',
                [$column, $versionId],
            );

            $counts = [];
            $nulls = 0;
            foreach ($rows as $row) {
                if ($row->v === null) {
                    $nulls = (int) $row->n;
                } else {
                    $counts['v'.$row->v] = (int) $row->n;
                }
            }

            $this->cache[$cacheKey] = ['counts' => $counts, 'nulls' => $nulls];
        }

        return $this->cache[$cacheKey];
    }

    public static function value(string $key): string
    {
        return substr($key, 1);
    }
}
