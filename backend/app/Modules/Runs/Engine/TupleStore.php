<?php

namespace App\Modules\Runs\Engine;

final class TupleStore
{
    public const ACTIVE = 'active';

    public const EXCLUDED = 'excluded';

    public const EXPANDED = 'expanded';

    public const INCLUDED = 'included';

    public array $parent = [];

    public array $born = [];

    public array $sources = [];

    public array $endStep = [];

    public array $fate = [];

    public array $exclusionCode = [];

    public array $exclusionDetail = [];

    public array $result = [];

    private int $next = 0;

    public function create(?int $parent, int $bornStep, array $sources): int
    {
        $no = ++$this->next;
        $this->parent[$no] = $parent;
        $this->born[$no] = $bornStep;
        $this->sources[$no] = $sources;
        $this->fate[$no] = self::ACTIVE;

        return $no;
    }

    public function exclude(int $no, int $step, string $code, array $detail): void
    {
        $this->fate[$no] = self::EXCLUDED;
        $this->endStep[$no] = $step;
        $this->exclusionCode[$no] = $code;
        $this->exclusionDetail[$no] = $detail;
    }

    public function expand(int $no, int $step): void
    {
        $this->fate[$no] = self::EXPANDED;
        $this->endStep[$no] = $step;
    }

    public function include(int $no, int $resultNo): void
    {
        $this->fate[$no] = self::INCLUDED;
        $this->result[$no] = $resultNo;
    }

    public function count(): int
    {
        return $this->next;
    }

    public function source(int $no, int $input): ?int
    {
        return $this->sources[$no][$input] ?? null;
    }
}
