<?php

namespace App\Modules\Datasets\Import;

final class ParsedCsv
{
    public function __construct(
        public readonly string $encoding,
        public readonly string $delimiter,
        public readonly array $labels,
        public readonly array $keys,
        public readonly array $records,
        public readonly array $warnings,
        public readonly string $checksum,
        public readonly int $sizeBytes,
    ) {
    }

    public function rowCount(): int
    {
        return count($this->records);
    }

    public function columnValues(int $index): array
    {
        return array_map(fn (array $record) => $record['values'][$index], $this->records);
    }

    public function associativeValues(array $record): array
    {
        return array_combine($this->keys, $record['values']);
    }
}
