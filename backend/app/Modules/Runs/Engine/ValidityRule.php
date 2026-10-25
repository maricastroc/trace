<?php

namespace App\Modules\Runs\Engine;

use App\Modules\Datasets\Import\ValueParser;

final class ValidityRule
{
    public const READINGS = ['started', 'active_any', 'active_at_end'];

    public const OUT = 'validity_out';

    public const UNDETERMINED = 'validity_undetermined';

    /**
     * @param  array{reading: string, from: string, to: string, end_inclusive: bool}  $condition
     * @return array{0: string, 1: string}|null
     */
    public static function evaluate(array $condition, ?string $startRaw, ?string $endRaw): ?array
    {
        if ($startRaw === null) {
            return [self::UNDETERMINED, 'start_missing'];
        }

        $start = ValueParser::date($startRaw);
        if ($start === null) {
            return [self::UNDETERMINED, 'start_unconvertible'];
        }

        $end = null;
        if ($endRaw !== null) {
            $end = ValueParser::date($endRaw);
            if ($end === null) {
                return [self::UNDETERMINED, 'end_unconvertible'];
            }
            if ($end < $start) {
                return [self::UNDETERMINED, 'inverted'];
            }
        }

        $from = $condition['from'];
        $to = $condition['to'];
        $endedBefore = fn (string $day): bool => $end !== null && ($condition['end_inclusive'] ? $end < $day : $end <= $day);

        return match ($condition['reading']) {
            'started' => match (true) {
                $start < $from => [self::OUT, 'started_before'],
                $start > $to => [self::OUT, 'started_after'],
                default => null,
            },
            'active_any' => match (true) {
                $start > $to => [self::OUT, 'started_after'],
                $endedBefore($from) => [self::OUT, 'ended_before'],
                default => null,
            },
            'active_at_end' => match (true) {
                $start > $to => [self::OUT, 'started_after'],
                $endedBefore($from) => [self::OUT, 'ended_before'],
                $endedBefore($to) => [self::OUT, 'ended_during'],
                default => null,
            },
            default => [self::UNDETERMINED, 'reading_unknown'],
        };
    }
}
