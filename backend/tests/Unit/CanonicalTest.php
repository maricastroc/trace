<?php

namespace Tests\Unit;

use App\Modules\Support\Canonical;
use PHPUnit\Framework\TestCase;

class CanonicalTest extends TestCase
{
    public function test_key_order_is_ignored_but_values_are_compared_strictly(): void
    {
        $this->assertTrue(Canonical::same(['a' => 1, 'b' => ['x' => '1', 'y' => '2']], ['b' => ['y' => '2', 'x' => '1'], 'a' => 1]));
        $this->assertFalse(Canonical::same(['value' => '0187'], ['value' => '187']));
        $this->assertFalse(Canonical::same([1, 2], [2, 1]));
        $this->assertFalse(Canonical::same(['value' => '1'], ['value' => 1]));
    }
}
