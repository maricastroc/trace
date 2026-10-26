<?php

namespace App\Modules\Comparisons;

final class SideSource
{
    /**
     * @param  array{start_column: string, end_column: string|null, end_inclusive: bool}|null  $validity
     * @param  list<string>  $fields
     * @param  array<string, mixed>  $basis
     */
    public function __construct(
        public readonly string $versionId,
        public readonly string $key,
        public readonly ?array $validity,
        public readonly array $fields,
        public readonly array $basis,
    ) {}
}
