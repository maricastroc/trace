<?php

namespace App\Modules\Datasets\Import;

use App\Modules\Support\DomainError;

final class InvalidCsv extends DomainError
{
    public static function because(string $code, string $message, array $details = []): self
    {
        return new self("csv.{$code}", $message, 422, $details);
    }
}
