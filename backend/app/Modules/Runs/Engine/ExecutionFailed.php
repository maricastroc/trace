<?php

namespace App\Modules\Runs\Engine;

use RuntimeException;

final class ExecutionFailed extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?int $stepPosition = null,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public function toArray(): array
    {
        return [
            'code' => $this->errorCode,
            'message' => $this->getMessage(),
            'step_position' => $this->stepPosition,
            'details' => $this->details === [] ? new \stdClass : $this->details,
        ];
    }
}
