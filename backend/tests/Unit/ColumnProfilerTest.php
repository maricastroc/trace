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

    public function test_a_dot_that_may_separate_thousands_is_not_read_as_a_decimal(): void
    {
        $profiler = new ColumnProfiler;

        $ambiguous = $profiler->profile(['1.234', '12.000', '567']);
        $this->assertSame('text', $ambiguous['type']);
        $this->assertTrue($ambiguous['profile']['decimal_ambiguous']);
        $this->assertStringContainsString('Valores como 1.234 podem usar o ponto para separar milhares ou decimais', $ambiguous['profile']['type_reason']);

        $decimals = $profiler->profile(['1.234', '0.5', '2.75']);
        $this->assertSame('number', $decimals['type'], 'other values show the dot is a decimal separator');
        $this->assertArrayNotHasKey('decimal_ambiguous', $decimals['profile']);

        $local = $profiler->profile(['1.234,56', '12,5', '7']);
        $this->assertSame('text', $local['type']);
        $this->assertStringContainsString('vírgula decimal', $local['profile']['type_reason']);
    }

    public function test_an_invalid_date_is_counted_and_shown_instead_of_hidden_as_text(): void
    {
        $result = (new ColumnProfiler)->profile(['2024-01-10', '31/02/2024', '2024-03-01', null]);

        $this->assertSame('text', $result['type']);
        $this->assertSame('1 de 3 valores não são datas válidas (por exemplo, 31/02/2024): a coluna fica como texto e não pode marcar vigência até que sejam corrigidos.', $result['profile']['type_reason']);
    }

    public function test_samples_keep_numeric_looking_values_as_strings(): void
    {
        $result = (new ColumnProfiler)->profile(['200', '200', '180']);

        $this->assertSame(['200', '180'], $result['profile']['samples']);
        $this->assertFalse($result['profile']['unique']);
    }
}
