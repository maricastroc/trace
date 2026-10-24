<?php

namespace App\Modules\Support;

use RuntimeException;

class DomainError extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public function toResponseArray(): array
    {
        return [
            'message' => $this->getMessage(),
            'code' => $this->errorCode,
            'details' => $this->details === [] ? new \stdClass : $this->details,
        ];
    }
}
