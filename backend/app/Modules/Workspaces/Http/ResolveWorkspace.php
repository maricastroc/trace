<?php

namespace App\Modules\Workspaces\Http;

use App\Modules\Workspaces\Workspace;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ResolveWorkspace
{
    public const HEADER = 'X-Trace-Workspace';

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->header(self::HEADER);

        if (! is_string($token) || preg_match('/^trw_[A-Za-z0-9]{48}$/', $token) !== 1) {
            return response()->json([
                'message' => 'Informe o token do espaço de trabalho no cabeçalho '.self::HEADER.'.',
                'code' => 'workspace.missing',
                'details' => new \stdClass,
            ], 401);
        }

        $workspace = Workspace::query()->where('token_hash', Workspace::hashToken($token))->first();

        if ($workspace === null) {
            return response()->json([
                'message' => 'Espaço de trabalho não encontrado. Ele pode ter expirado.',
                'code' => 'workspace.unknown',
                'details' => new \stdClass,
            ], 401);
        }

        if ($workspace->last_active_at === null || $workspace->last_active_at->lt(now()->subMinutes(5))) {
            Workspace::query()->whereKey($workspace->id)->update(['last_active_at' => now()]);
        }

        app()->instance(Workspace::class, $workspace);

        return $next($request);
    }
}
