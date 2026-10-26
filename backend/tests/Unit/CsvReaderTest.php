<?php

namespace Tests\Unit;

use App\Modules\Datasets\Import\CsvReader;
use App\Modules\Datasets\Import\InvalidCsv;
use PHPUnit\Framework\TestCase;

class CsvReaderTest extends TestCase
{
    private function reader(int $rows = 1000, int $columns = 50): CsvReader
    {
        return new CsvReader($rows, $columns, 1024 * 1024);
    }

    private function assertInvalid(string $code, string $content, ?CsvReader $reader = null): InvalidCsv
    {
        try {
            ($reader ?? $this->reader())->readString($content);
        } catch (InvalidCsv $e) {
            $this->assertSame("csv.{$code}", $e->errorCode);

            return $e;
        }

        $this->fail("Expected csv.{$code}");
    }

    public function test_preserves_leading_zeros_and_raw_text(): void
    {
        $parsed = $this->reader()->readString("id,cozinha_id,quantidade\n000001,0183,200\n");

        $this->assertSame(['000001', '0183', '200'], $parsed->records[0]['values']);
        $this->assertSame(['id', 'cozinha_id', 'quantidade'], $parsed->keys);
    }

    public function test_detects_semicolon_with_quoted_fields_containing_commas(): void
    {
        $parsed = $this->reader()->readString("nome;municipio\n\"Cozinha, Centro\";Fortaleza\n");

        $this->assertSame(';', $parsed->delimiter);
        $this->assertSame(['Cozinha, Centro', 'Fortaleza'], $parsed->records[0]['values']);
    }

    public function test_detects_tab_delimiter(): void
    {
        $parsed = $this->reader()->readString("a\tb\n1\t2\n3\t4\n");

        $this->assertSame("\t", $parsed->delimiter);
        $this->assertCount(2, $parsed->records);
    }

    public function test_strips_utf8_bom(): void
    {
        $parsed = $this->reader()->readString("\xEF\xBB\xBFid,nome\n1,Ana\n");

        $this->assertSame(['id', 'nome'], $parsed->labels);
        $this->assertSame('UTF-8', $parsed->encoding);
    }

    public function test_converts_windows_1252_to_utf8_and_warns(): void
    {
        $parsed = $this->reader()->readString(mb_convert_encoding("município,situação\nCaucaia,ativa\n", 'Windows-1252', 'UTF-8'));

        $this->assertSame('Windows-1252', $parsed->encoding);
        $this->assertSame(['município', 'situação'], $parsed->labels);
        $this->assertSame(['municipio', 'situacao'], $parsed->keys);
        $this->assertSame('encoding_converted', $parsed->warnings[0]['code']);
    }

    public function test_trims_cells_and_turns_empty_into_null(): void
    {
        $parsed = $this->reader()->readString("a,b,c\n  x , ,\n");

        $this->assertSame(['x', null, null], $parsed->records[0]['values']);
        $this->assertSame('whitespace_trimmed', $parsed->warnings[0]['code']);
    }

    public function test_skips_blank_lines_and_tracks_physical_line_numbers(): void
    {
        $parsed = $this->reader()->readString("id,obs\n1,\"linha\nquebrada\"\n\n2,ok\n");

        $this->assertSame([2, 5], array_column($parsed->records, 'line'));
        $this->assertSame("linha\nquebrada", $parsed->records[0]['values'][1]);
    }

    public function test_rejects_ragged_rows_with_line_numbers(): void
    {
        $error = $this->assertInvalid('ragged_rows', "a,b\n1,2\n3\n4,5,6\n");

        $this->assertSame(2, $error->details['total']);
        $this->assertSame([3, 4], array_column($error->details['examples'], 'line'));
    }

    public function test_rejects_an_unclosed_quote_instead_of_swallowing_the_rest_of_the_file(): void
    {
        $last = $this->assertInvalid('unclosed_quote', "a,b,c\n1,2,\"x\n4,5,6\n7,8,9\n");
        $this->assertSame(2, $last->details['line']);

        $middle = $this->assertInvalid('unclosed_quote', "a,b,c\n1,\"x,3\n4,5,6\n");
        $this->assertSame(2, $middle->details['line'], 'the quote is named, not reported as rows with the wrong number of columns');

        $parsed = $this->reader()->readString("a,b\n1,\"dito \"\"assim\"\"\nem duas linhas\"\n2,ok\n");
        $this->assertCount(2, $parsed->records, 'escaped quotes and line breaks inside closed quotes are still fine');
    }

    public function test_reads_old_mac_line_endings_and_reports_rows_made_only_of_separators(): void
    {
        $parsed = $this->reader()->readString("id,nome\r1,Ana\r2,Bia\r");
        $this->assertCount(2, $parsed->records);
        $this->assertContains('line_endings_converted', array_column($parsed->warnings, 'code'));

        $skipped = $this->reader()->readString("id,nome\n1,Ana\n,\n2,Bia\n\n");
        $this->assertCount(2, $skipped->records);
        $warning = collect($skipped->warnings)->firstWhere('code', 'separator_rows_skipped');
        $this->assertSame(1, $warning['count'], 'a trailing blank line is not counted, a row of separators is');
    }

    public function test_rejects_duplicate_and_empty_headers(): void
    {
        $this->assertInvalid('duplicate_header', "id,Id\n1,2\n");
        $this->assertInvalid('empty_header', "id,,nome\n1,2,3\n");
    }

    public function test_rejects_empty_header_only_and_binary_files(): void
    {
        $this->assertInvalid('empty', "  \n\n");
        $this->assertInvalid('no_rows', "id,nome\n");
        $this->assertInvalid('binary', "id,nome\n1,\0\n");
    }

    public function test_enforces_row_and_column_limits(): void
    {
        $this->assertInvalid('too_many_rows', "a\n1\n2\n3\n", $this->reader(rows: 2));
        $this->assertInvalid('too_many_columns', "a,b,c\n1,2,3\n", $this->reader(columns: 2));
    }

    public function test_generates_unique_safe_column_keys(): void
    {
        $parsed = $this->reader()->readString("Município,municipio_,2024,Valor (R$)\n1,2,3,4\n");

        $this->assertSame(['municipio', 'municipio_2', 'c_2024', 'valor_r'], $parsed->keys);
    }
}
