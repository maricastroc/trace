<?php

namespace App\Modules\Support\Http;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class LimitStatementTime
{
    public function handle(Request $request, Closure $next): Response
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('SET statement_timeout = '.max(1, (int) config('trace.limits.statement_seconds')) * 1000);
        }

        return $next($request);
    }
}
