<?php

namespace App\Modules\Datasets\Import;

use App\Modules\Support\Identifier;

final class CsvReader
{
    private const DELIMITERS = [',', ';', "\t", '|'];

    public function __construct(
        private readonly int $maxRows,
        private readonly int $maxColumns,
        private readonly int $maxBytes,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            (int) config('trace.limits.rows'),
            (int) config('trace.limits.columns'),
            (int) config('trace.limits.upload_kb') * 1024,
        );
    }

    public function readFile(string $path): ParsedCsv
    {
        if (! is_file($path) || ! is_readable($path)) {
            throw InvalidCsv::because('unreadable', 'Não foi possível ler o arquivo enviado.');
        }

        $size = (int) filesize($path);
        if ($size > $this->maxBytes) {
            throw InvalidCsv::because('too_large', 'O arquivo excede o tamanho máximo permitido.', [
                'max_bytes' => $this->maxBytes,
                'size_bytes' => $size,
            ]);
        }

        return $this->readString((string) file_get_contents($path));
    }

    private function leavesQuoteOpen(string $record, string $delimiter): bool
    {
        $quoted = false;
        $fieldStart = true;
        $length = strlen($record);

        for ($i = 0; $i < $length; $i++) {
            $char = $record[$i];

            if ($quoted) {
                if ($char === '"' && ($record[$i + 1] ?? '') === '"') {
                    $i++;
                } elseif ($char === '"') {
                    $quoted = false;
                }

                continue;
            }

            if ($char === '"' && $fieldStart) {
                $quoted = true;
                $fieldStart = false;
            } elseif ($char !== ' ' || $delimiter === ' ') {
                $fieldStart = $char === $delimiter || $char === "\n" || $char === "\r";
            }
        }

        return $quoted;
    }

    public function readString(string $raw): ParsedCsv
    {
        $checksum = hash('sha256', $raw);
        $size = strlen($raw);

        if (trim($raw) === '') {
            throw InvalidCsv::because('empty', 'O arquivo está vazio.');
        }

        [$content, $encoding] = $this->toUtf8($raw);

        if (str_contains($content, "\0")) {
            throw InvalidCsv::because('binary', 'O arquivo parece ser binário e não um CSV de texto.');
        }

        $oldMacLines = ! str_contains($content, "\n") && str_contains($content, "\r");
        if ($oldMacLines) {
            $content = str_replace("\r", "\n", $content);
        }

        $delimiter = $this->detectDelimiter($content);
        $warnings = [];
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $content);
        rewind($stream);

        $line = 1;
        $offset = 0;
        $labels = null;
        $records = [];
        $raggedLines = [];
        $raggedTotal = 0;
        $trimmedCells = 0;
        $separatorOnly = 0;

        while (($fields = fgetcsv($stream, null, $delimiter, '"', '')) !== false) {
            $startLine = $line;
            $position = ftell($stream);
            $breaks = substr_count($content, "\n", $offset, $position - $offset);
            if ($breaks > 1 && $this->leavesQuoteOpen(substr($content, $offset, $position - $offset), $delimiter)) {
                fclose($stream);
                throw InvalidCsv::because('unclosed_quote', "A linha {$startLine} abre aspas que não são fechadas: o resto do arquivo seria lido como uma única célula. Feche as aspas ou remova-as e envie de novo.", ['line' => $startLine]);
            }
            $line += $breaks;
            $offset = $position;

            if ($fields === [null] || $this->isBlank($fields)) {
                if ($labels !== null && count($fields) > 1) {
                    $separatorOnly++;
                }

                continue;
            }

            if ($labels === null) {
                $labels = $this->validateHeader($fields);

                continue;
            }

            if (count($fields) !== count($labels)) {
                if (count($raggedLines) < 5) {
                    $raggedLines[] = ['line' => $startLine, 'expected' => count($labels), 'found' => count($fields)];
                }
                $raggedTotal++;

                continue;
            }

            if (count($records) >= $this->maxRows) {
                fclose($stream);
                throw InvalidCsv::because('too_many_rows', "O arquivo excede o limite de {$this->maxRows} registros.", [
                    'max_rows' => $this->maxRows,
                ]);
            }

            $values = [];
            foreach ($fields as $field) {
                $field = (string) $field;
                $trimmed = trim($field);
                if ($trimmed !== $field) {
                    $trimmedCells++;
                }
                $values[] = $trimmed === '' ? null : $trimmed;
            }

            $records[] = ['line' => $startLine, 'values' => $values];
        }

        fclose($stream);

        if ($labels === null) {
            throw InvalidCsv::because('no_header', 'Não foi encontrada uma linha de cabeçalho.');
        }

        if ($raggedLines !== []) {
            throw InvalidCsv::because('ragged_rows', 'Algumas linhas não têm o mesmo número de colunas do cabeçalho.', [
                'total' => $raggedTotal,
                'examples' => $raggedLines,
            ]);
        }

        if ($records === []) {
            throw InvalidCsv::because('no_rows', 'O arquivo contém apenas o cabeçalho, sem registros.');
        }

        if ($oldMacLines) {
            $warnings[] = ['code' => 'line_endings_converted', 'message' => 'As linhas do arquivo terminavam só com retorno de carro (formato antigo do Mac) e foram lidas como quebras de linha.'];
        }

        if ($separatorOnly > 0) {
            $warnings[] = ['code' => 'separator_rows_skipped', 'message' => "{$separatorOnly} ".($separatorOnly === 1 ? 'linha tinha' : 'linhas tinham').' só separadores, sem nenhum valor, e '.($separatorOnly === 1 ? 'foi ignorada' : 'foram ignoradas').'.', 'count' => $separatorOnly];
        }

        if ($encoding !== 'UTF-8') {
            $warnings[] = ['code' => 'encoding_converted', 'message' => "Codificação {$encoding} convertida para UTF-8."];
        }

        $dataLike = array_keys(array_filter($labels, fn (string $label) => ValueParser::number($label) !== null || ValueParser::date($label) !== null || preg_match('/^[\d.\/-]{6,}$/', $label) === 1));
        if ($dataLike !== []) {
            $warnings[] = ['code' => 'header_looks_like_data', 'message' => 'Na primeira linha, '.(count($dataLike) === 1 ? 'a coluna '.($dataLike[0] + 1).' tem um nome que parece um dado' : 'as colunas '.implode(', ', array_map(fn (int $i) => $i + 1, $dataLike)).' têm nomes que parecem dados').' (número ou data). Se o arquivo não tem cabeçalho, o primeiro registro virou nome de coluna e ficou fora da contagem: acrescente uma linha com os nomes das colunas.', 'positions' => array_map(fn (int $i) => $i + 1, $dataLike)];
        }

        if ($trimmedCells > 0) {
            $warnings[] = ['code' => 'whitespace_trimmed', 'message' => "{$trimmedCells} células tinham espaços nas bordas, que foram removidos.", 'count' => $trimmedCells];
        }

        return new ParsedCsv($encoding, $delimiter, $labels, $this->keysFor($labels), $records, $warnings, $checksum, $size);
    }

    private function toUtf8(string $raw): array
    {
        if (str_starts_with($raw, "\xEF\xBB\xBF")) {
            return [substr($raw, 3), 'UTF-8'];
        }

        if (str_starts_with($raw, "\xFF\xFE")) {
            return [mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16LE'), 'UTF-16LE'];
        }

        if (str_starts_with($raw, "\xFE\xFF")) {
            return [mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16BE'), 'UTF-16BE'];
        }

        if (mb_check_encoding($raw, 'UTF-8')) {
            return [$raw, 'UTF-8'];
        }

        return [mb_convert_encoding($raw, 'UTF-8', 'Windows-1252'), 'Windows-1252'];
    }

    private function detectDelimiter(string $content): string
    {
        $lines = array_slice(array_values(array_filter(
            preg_split('/\r\n|\n|\r/', $content, 25) ?: [],
            fn (string $line) => trim($line) !== '',
        )), 0, 20);

        $best = ',';
        $bestScore = 0;

        foreach (self::DELIMITERS as $candidate) {
            $counts = array_map(fn (string $line) => count(str_getcsv($line, $candidate, '"', '')), $lines);
            $header = $counts[0] ?? 1;
            if ($header < 2) {
                continue;
            }
            $consistent = count(array_filter($counts, fn (int $count) => $count === $header));
            $score = $consistent * 100 + $header;
            if ($score > $bestScore) {
                $best = $candidate;
                $bestScore = $score;
            }
        }

        return $best;
    }

    private function validateHeader(array $fields): array
    {
        if (count($fields) > $this->maxColumns) {
            throw InvalidCsv::because('too_many_columns', "O arquivo excede o limite de {$this->maxColumns} colunas.", [
                'max_columns' => $this->maxColumns,
                'found' => count($fields),
            ]);
        }

        $labels = array_map(fn ($field) => trim((string) $field), $fields);
        $seen = [];

        foreach ($labels as $index => $label) {
            if ($label === '') {
                throw InvalidCsv::because('empty_header', 'Há uma coluna sem nome no cabeçalho.', ['position' => $index + 1]);
            }
            if (mb_strlen($label) > 120) {
                throw InvalidCsv::because('header_too_long', 'O nome da coluna '.($index + 1).' tem mais de 120 caracteres. Verifique se a primeira linha do arquivo é mesmo o cabeçalho.', ['position' => $index + 1]);
            }
            $normalized = mb_strtolower($label);
            if (isset($seen[$normalized])) {
                throw InvalidCsv::because('duplicate_header', "A coluna \"{$label}\" aparece mais de uma vez no cabeçalho.", ['column' => $label]);
            }
            $seen[$normalized] = true;
        }

        return $labels;
    }

    private function keysFor(array $labels): array
    {
        $keys = [];
        foreach ($labels as $index => $label) {
            $keys[] = Identifier::unique(Identifier::fromLabel($label, 'coluna_'.($index + 1)), $keys);
        }

        return $keys;
    }

    private function isBlank(array $fields): bool
    {
        foreach ($fields as $field) {
            if (trim((string) $field) !== '') {
                return false;
            }
        }

        return true;
    }
}
