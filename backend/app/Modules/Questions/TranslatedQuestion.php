<?php

namespace App\Modules\Questions;

final class TranslatedQuestion
{
    /**
     * @param  array{base_dataset_id: string, measure: array, period: array|null, dimension: array|null}|null  $question
     * @param  list<array{code: string, message: string, path: string}>  $errors
     * @param  list<array<string, mixed>>  $steps
     */
    public function __construct(
        public readonly ?array $question,
        public readonly ?string $key,
        public readonly array $errors,
        public readonly bool $needsReading,
        public readonly ?string $baseDatasetId,
        public readonly array $steps,
    ) {}

    /**
     * @param  list<array{code: string, message: string, path: string}>  $errors
     */
    public static function invalid(array $errors): self
    {
        return new self(null, null, $errors, false, null, []);
    }

    public function isValid(): bool
    {
        return $this->errors === [];
    }
}
