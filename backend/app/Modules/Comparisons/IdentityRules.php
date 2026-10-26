<?php

namespace App\Modules\Comparisons;

final class IdentityRules
{
    public const LEADING_ZEROS = 'leading_zeros';

    public const CASE_AND_SPACING = 'case_and_spacing';

    public const SUPPORTED = [self::LEADING_ZEROS, self::CASE_AND_SPACING];

    public const LABELS = [
        self::LEADING_ZEROS => 'ignorar zeros à esquerda',
        self::CASE_AND_SPACING => 'ignorar maiúsculas e espaços',
    ];

    public static function isEmpty(?string $value): bool
    {
        return $value === null || trim($value) === '';
    }

    /**
     * @param  list<string>  $rules
     */
    public static function normalize(string $value, array $rules): string
    {
        if (in_array(self::CASE_AND_SPACING, $rules, true)) {
            $value = mb_strtolower((string) preg_replace('/\s+/u', ' ', trim($value)));
        }

        if (in_array(self::LEADING_ZEROS, $rules, true)) {
            $stripped = ltrim($value, '0');
            $value = $stripped === '' && $value !== '' ? '0' : $stripped;
        }

        return $value;
    }
}
