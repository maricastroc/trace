<?php

namespace App\Modules\Support;

final class MemoryBudget
{
    public static function atLeast(int $megabytes): void
    {
        $current = (string) ini_get('memory_limit');

        if ($current !== '-1' && UploadLimit::bytes($current) < $megabytes * 1024 ** 2) {
            ini_set('memory_limit', "{$megabytes}M");
        }
    }
}
