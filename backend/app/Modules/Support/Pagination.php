<?php

namespace App\Modules\Support;

use Illuminate\Http\Request;

final class Pagination
{
    public function __construct(public readonly int $page, public readonly int $perPage) {}

    public static function fromRequest(Request $request, int $default = 25, int $max = 100): self
    {
        $page = max(1, (int) $request->query('page', 1));
        $perPage = (int) $request->query('per_page', $default);

        return new self($page, min(max(1, $perPage), $max));
    }

    public function offset(): int
    {
        return ($this->page - 1) * $this->perPage;
    }

    public function meta(int $total): array
    {
        return [
            'page' => $this->page,
            'per_page' => $this->perPage,
            'total' => $total,
            'last_page' => max(1, (int) ceil($total / $this->perPage)),
        ];
    }
}
