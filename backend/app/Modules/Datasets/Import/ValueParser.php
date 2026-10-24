<?php

namespace App\Modules\Datasets\Import;

final class ValueParser
{
    private const NUMBER = '/^[+-]?\d+(\.\d+)?$/';

    public static function number(?string $value): ?string
    {
        if ($value === null || preg_match(self::NUMBER, $value) !== 1) {
            return null;
        }

        $negative = str_starts_with($value, '-');
        $unsigned = ltrim($value, '+-');
        [$integer, $fraction] = array_pad(explode('.', $unsigned, 2), 2, '');
        $integer = ltrim($integer, '0');
        $integer = $integer === '' ? '0' : $integer;
        $fraction = rtrim($fraction, '0');
        $normalized = $fraction === '' ? $integer : "{$integer}.{$fraction}";

        if ($normalized === '0') {
            return '0';
        }

        return $negative ? "-{$normalized}" : $normalized;
    }

    public static function date(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1) {
            [$year, $month, $day] = [(int) $m[1], (int) $m[2], (int) $m[3]];
        } elseif (preg_match('/^(\d{2})\/(\d{2})\/(\d{4})$/', $value, $m) === 1) {
            [$day, $month, $year] = [(int) $m[1], (int) $m[2], (int) $m[3]];
        } else {
            return null;
        }

        if (! checkdate($month, $day, $year)) {
            return null;
        }

        return sprintf('%04d-%02d-%02d', $year, $month, $day);
    }

    public static function hasLeadingZero(?string $value): bool
    {
        return $value !== null && preg_match('/^0\d+$/', $value) === 1;
    }

    public static function scale(string $number): int
    {
        $dot = strpos($number, '.');

        return $dot === false ? 0 : strlen($number) - $dot - 1;
    }

    public static function compareNumbers(string $left, string $right): int
    {
        $scale = max(self::scale($left), self::scale($right));

        return bccomp($left, $right, $scale);
    }

    public static function add(string $left, string $right): string
    {
        $scale = max(self::scale($left), self::scale($right));

        return self::number(bcadd($left, $right, $scale)) ?? '0';
    }

    public static function convert(?string $value, string $type): ?string
    {
        return match ($type) {
            'number' => self::number($value),
            'date' => self::date($value),
            default => $value,
        };
    }
}
