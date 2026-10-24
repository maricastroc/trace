<?php

namespace App\Modules\Support;

final class Canonical
{
    public static function same(mixed $left, mixed $right): bool
    {
        return self::normalize($left) === self::normalize($right);
    }

    public static function normalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        $normalized = array_map(fn (mixed $item) => self::normalize($item), $value);

        if (! array_is_list($normalized)) {
            ksort($normalized, SORT_STRING);
        }

        return $normalized;
    }
}
