<?php

namespace Tests\Unit;

use App\Modules\Datasets\Import\ValueParser;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ValueParserTest extends TestCase
{
    public static function numbers(): array
    {
        return [
            ['200', '200'],
            ['0187', '187'],
            ['-2', '-2'],
            ['+3', '3'],
            ['1.50', '1.5'],
            ['0.0', '0'],
            ['-0', '0'],
            ['1e3', null],
            ['1,5', null],
            ['n/d', null],
            ['', null],
            [null, null],
        ];
    }

    #[DataProvider('numbers')]
    public function test_number_conversion_is_explicit_and_strict(?string $raw, ?string $expected): void
    {
        $this->assertSame($expected, ValueParser::number($raw));
    }

    public static function dates(): array
    {
        return [
            ['2026-09-01', '2026-09-01'],
            ['01/09/2026', '2026-09-01'],
            ['2026-02-30', null],
            ['31/04/2026', null],
            ['2026-9-1', null],
            ['setembro', null],
        ];
    }

    #[DataProvider('dates')]
    public function test_date_conversion_accepts_iso_and_brazilian_formats(string $raw, ?string $expected): void
    {
        $this->assertSame($expected, ValueParser::date($raw));
    }

    public function test_decimal_addition_has_no_floating_point_drift(): void
    {
        $total = '0';
        foreach (array_fill(0, 10, '0.1') as $value) {
            $total = ValueParser::add($total, $value);
        }

        $this->assertSame('1', $total);
        $this->assertSame('3.75', ValueParser::add('1.50', '2.25'));
    }

    public function test_numeric_comparison_ignores_leading_zeros_but_text_does_not(): void
    {
        $this->assertSame(0, ValueParser::compareNumbers('10', ValueParser::number('010')));
        $this->assertTrue(ValueParser::hasLeadingZero('0187'));
        $this->assertFalse(ValueParser::hasLeadingZero('0'));
        $this->assertFalse(ValueParser::hasLeadingZero('187'));
    }
}
