<?php

namespace App\Modules\Support;

final class UploadLimit
{
    public static function kilobytes(): int
    {
        $limits = [(int) config('trace.limits.upload_kb')];

        foreach (['upload_max_filesize', 'post_max_size'] as $setting) {
            $bytes = self::bytes((string) ini_get($setting));
            if ($bytes > 0) {
                $limits[] = intdiv($bytes, 1024);
            }
        }

        return max(1, min($limits));
    }

    public static function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || ! is_numeric(rtrim($value, 'kKmMgG'))) {
            return 0;
        }

        $number = (int) $value;

        return match (strtolower(substr($value, -1))) {
            'g' => $number * 1024 ** 3,
            'm' => $number * 1024 ** 2,
            'k' => $number * 1024,
            default => $number,
        };
    }
}
