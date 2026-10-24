<?php

namespace App\Modules\Support;

use Illuminate\Support\Str;

final class Identifier
{
    public const PATTERN = '/^[a-z][a-z0-9_]{0,62}$/';

    public static function fromLabel(string $label, string $fallback): string
    {
        $ascii = Str::lower(Str::ascii($label));
        $key = trim((string) preg_replace('/[^a-z0-9]+/', '_', $ascii), '_');

        if ($key === '') {
            $key = $fallback;
        }

        if (! preg_match('/^[a-z]/', $key)) {
            $key = 'c_'.$key;
        }

        return substr($key, 0, 56);
    }

    public static function unique(string $key, array $taken): string
    {
        if (! in_array($key, $taken, true)) {
            return $key;
        }

        $suffix = 2;
        while (in_array("{$key}_{$suffix}", $taken, true)) {
            $suffix++;
        }

        return "{$key}_{$suffix}";
    }

    public static function isValid(mixed $value): bool
    {
        return is_string($value) && preg_match(self::PATTERN, $value) === 1;
    }
}
