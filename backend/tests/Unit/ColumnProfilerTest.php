<?php

namespace Tests\Unit;

use App\Modules\Datasets\Import\ColumnProfiler;
use PHPUnit\Framework\TestCase;

class ColumnProfilerTest extends TestCase
{
    public function test_identifiers_with_leading_zeros_are_not_numbers(): void
    {
        $result = (new ColumnProfiler)->profile(['0183', '0187', '0188']);

        $this->assertSame('identifier', $result['type']);
        $this->assertSame(4, $result['profile']['fixed_length']);
        $this->assertTrue($result['profile']['unique']);
    }

    public function test_numbers_dates_and_mixed_columns(): void
    {
        $profiler = new ColumnProfiler;

        $numbers = $profiler->profile(['200', '180', null, '1.5']);
        $this->assertSame('number', $numbers['type']);
        $this->assertSame('1.5', $numbers['profile']['min']);
        $this->assertSame('200', $numbers['profile']['max']);
        $this->assertSame(1, $numbers['profile']['nulls']);

        $this->assertSame('date', $profiler->profile(['2026-09-01', '01/10/2026'])['type']);
        $this->assertSame('text', $profiler->profile(['200', 'n/d'])['type']);
    }

    public function test_samples_keep_numeric_looking_values_as_strings(): void
    {
        $result = (new ColumnProfiler)->profile(['200', '200', '180']);

        $this->assertSame(['200', '180'], $result['profile']['samples']);
        $this->assertFalse($result['profile']['unique']);
    }
}
