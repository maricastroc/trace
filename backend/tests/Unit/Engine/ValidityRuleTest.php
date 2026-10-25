<?php

namespace Tests\Unit\Engine;

use App\Modules\Runs\Engine\ValidityRule;
use PHPUnit\Framework\TestCase;

class ValidityRuleTest extends TestCase
{
    private function rule(string $reading, bool $inclusive = true): array
    {
        return ['reading' => $reading, 'from' => '2025-01-01', 'to' => '2025-12-31', 'end_inclusive' => $inclusive];
    }

    public function test_started_keeps_only_records_that_began_inside_the_period(): void
    {
        $rule = $this->rule('started');

        $this->assertNull(ValidityRule::evaluate($rule, '2025-01-01', null));
        $this->assertNull(ValidityRule::evaluate($rule, '31/12/2025', '2026-03-01'));
        $this->assertSame([ValidityRule::OUT, 'started_before'], ValidityRule::evaluate($rule, '2024-12-31', null));
        $this->assertSame([ValidityRule::OUT, 'started_after'], ValidityRule::evaluate($rule, '2026-01-01', null));
    }

    public function test_active_any_overlaps_the_period_and_respects_the_end_day_choice(): void
    {
        $this->assertNull(ValidityRule::evaluate($this->rule('active_any'), '2020-05-01', null));
        $this->assertNull(ValidityRule::evaluate($this->rule('active_any'), '2020-05-01', '2025-01-01'));
        $this->assertSame([ValidityRule::OUT, 'ended_before'], ValidityRule::evaluate($this->rule('active_any', false), '2020-05-01', '2025-01-01'));
        $this->assertSame([ValidityRule::OUT, 'ended_before'], ValidityRule::evaluate($this->rule('active_any'), '2020-05-01', '2024-12-31'));
        $this->assertSame([ValidityRule::OUT, 'started_after'], ValidityRule::evaluate($this->rule('active_any'), '2026-01-01', null));
    }

    public function test_active_at_end_requires_validity_on_the_last_day(): void
    {
        $this->assertNull(ValidityRule::evaluate($this->rule('active_at_end'), '2023-01-01', null));
        $this->assertNull(ValidityRule::evaluate($this->rule('active_at_end'), '2023-01-01', '2025-12-31'));
        $this->assertSame([ValidityRule::OUT, 'ended_during'], ValidityRule::evaluate($this->rule('active_at_end', false), '2023-01-01', '2025-12-31'));
        $this->assertSame([ValidityRule::OUT, 'ended_during'], ValidityRule::evaluate($this->rule('active_at_end'), '2023-01-01', '2025-06-30'));
        $this->assertSame([ValidityRule::OUT, 'ended_before'], ValidityRule::evaluate($this->rule('active_at_end'), '2023-01-01', '2024-06-30'));
        $this->assertSame([ValidityRule::OUT, 'started_after'], ValidityRule::evaluate($this->rule('active_at_end'), '2026-02-01', null));
    }

    public function test_records_whose_validity_cannot_be_determined_are_not_guessed(): void
    {
        $rule = $this->rule('active_any');

        $this->assertSame([ValidityRule::UNDETERMINED, 'start_missing'], ValidityRule::evaluate($rule, null, null));
        $this->assertSame([ValidityRule::UNDETERMINED, 'start_unconvertible'], ValidityRule::evaluate($rule, '2025-13-01', null));
        $this->assertSame([ValidityRule::UNDETERMINED, 'end_unconvertible'], ValidityRule::evaluate($rule, '2025-01-10', 'em aberto'));
        $this->assertSame([ValidityRule::UNDETERMINED, 'inverted'], ValidityRule::evaluate($rule, '2025-05-10', '2025-05-09'));
    }
}
