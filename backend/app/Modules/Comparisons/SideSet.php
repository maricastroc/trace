<?php

namespace App\Modules\Comparisons;

final class SideSet
{
    /**
     * @param  array<string, list<int>>  $identities  identity text => selected source row ids, in file order
     * @param  list<int>  $emptyRows  selected rows without an identifier
     * @param  array<string, array<string, int>>  $excluded  identity text => ["step|code" => rows] for source rows that never reached the selection
     * @param  array<int, array{0: string|null, 1: string|null}>  $validity  selected row id => [start, end], when the table declares validity
     * @param  array<int, array<string, string|null>>  $fields  selected row id => compared field values
     * @param  array<string, mixed>  $basis
     */
    public function __construct(
        public readonly array $identities,
        public readonly array $emptyRows,
        public readonly array $excluded,
        public readonly int $rows,
        public readonly array $validity,
        public readonly array $fields,
        public readonly array $basis,
    ) {}

    public function has(string $identity): bool
    {
        return isset($this->identities[$identity]);
    }

    /**
     * @return list<int>
     */
    public function rowsOf(string $identity): array
    {
        return $this->identities[$identity] ?? [];
    }

    /**
     * @return list<string>
     */
    public function keys(): array
    {
        return array_map('strval', array_keys($this->identities));
    }

    public function distinct(): int
    {
        return count($this->identities);
    }

    public function rowsWithKey(): int
    {
        return array_sum(array_map('count', $this->identities));
    }

    public function repeatedIdentities(): int
    {
        return count(array_filter($this->identities, fn (array $rows) => count($rows) > 1));
    }

    public function repeatedRows(): int
    {
        return $this->rowsWithKey() - $this->distinct();
    }

    /**
     * @return array{rows: int, rows_with_key: int, empty_rows: int, distinct: int, repeated_identities: int, repeated_rows: int}
     */
    public function counts(): array
    {
        return [
            'rows' => $this->rows,
            'rows_with_key' => $this->rowsWithKey(),
            'empty_rows' => count($this->emptyRows),
            'distinct' => $this->distinct(),
            'repeated_identities' => $this->repeatedIdentities(),
            'repeated_rows' => $this->repeatedRows(),
        ];
    }
}
