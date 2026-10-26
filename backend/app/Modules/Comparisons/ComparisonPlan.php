<?php

namespace App\Modules\Comparisons;

final class ComparisonPlan
{
    /**
     * @param  array<string, mixed>  $spec
     * @param  list<string>  $rules
     * @param  list<array{a: string, b: string}>  $fields
     * @param  list<array<string, mixed>>  $issues
     * @param  array<string, mixed>  $attribution
     * @param  array<string, mixed>  $equivalence
     */
    public function __construct(
        public readonly array $spec,
        public readonly string $key,
        public readonly SidePlan $a,
        public readonly SidePlan $b,
        public readonly array $rules,
        public readonly array $fields,
        public readonly array $issues,
        public readonly array $attribution,
        public readonly array $equivalence,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function blockers(): array
    {
        return array_values(array_filter($this->issues, fn (array $issue) => $issue['severity'] === 'blocker'));
    }

    public function warnings(): array
    {
        return array_values(array_filter($this->issues, fn (array $issue) => $issue['severity'] === 'warning'));
    }

    /**
     * @return array{a: array{validity: array|null, other_period: array|null}, b: array{validity: array|null, other_period: array|null}}
     */
    public function periods(): array
    {
        return [
            'a' => ['validity' => $this->a->validity, 'other_period' => $this->b->period()],
            'b' => ['validity' => $this->b->validity, 'other_period' => $this->a->period()],
        ];
    }

    public function stopsPreview(): bool
    {
        foreach ($this->blockers() as $issue) {
            $details = (array) $issue['details'];
            if ($issue['code'] === 'comparison.equivalence_unconfirmed') {
                continue;
            }
            if (! ($issue['code'] === 'join.relationship_unconfirmed' && ($details['target_unique'] ?? false) === true)) {
                return true;
            }
        }

        return false;
    }
}
